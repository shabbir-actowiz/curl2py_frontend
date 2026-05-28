// Lightweight cURL parser -> structured request, then Python code generator.
// Supports multiple curl blocks separated by newlines/&&/;.

export interface ParsedCurl {
  method: string;
  url: string;
  domain: string;
  headers: Record<string, string>;
  data: string | null;
  dataType: "JSON" | "Form" | "Multipart" | "Text" | "None";
  raw: string;
  error?: string;
}

// Tokenize a shell-like command honoring quotes and backslash continuations.
function tokenize(input: string): string[] {
  // Collapse line-continuation: backslash + newline
  const cleaned = input.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let i = 0;
  const n = cleaned.length;
  while (i < n) {
    const c = cleaned[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let buf = "";
      while (i < n && cleaned[i] !== quote) {
        if (cleaned[i] === "\\" && quote === '"' && i + 1 < n) {
          const nextChar = cleaned[i + 1];
          if (nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`") {
            buf += nextChar;
          } else {
            buf += "\\" + nextChar;
          }
          i += 2;
        } else {
          buf += cleaned[i++];
        }
      }
      i++; // closing quote
      // concat with adjacent tokens (e.g. -H'X: Y')
      while (i < n && cleaned[i] !== " " && cleaned[i] !== "\t" && cleaned[i] !== "\n") {
        if (cleaned[i] === '"' || cleaned[i] === "'") {
          const q2 = cleaned[i++];
          while (i < n && cleaned[i] !== q2) {
            if (cleaned[i] === "\\" && q2 === '"' && i + 1 < n) {
              const nextChar = cleaned[i + 1];
              buf += nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`" ? nextChar : "\\" + nextChar;
              i += 2;
            }
            else buf += cleaned[i++];
          }
          i++;
        } else {
          buf += cleaned[i++];
        }
      }
      tokens.push(buf);
    } else {
      let buf = "";
      while (i < n && cleaned[i] !== " " && cleaned[i] !== "\t" && cleaned[i] !== "\n") {
        if (cleaned[i] === '"' || cleaned[i] === "'") {
          const q2 = cleaned[i++];
          while (i < n && cleaned[i] !== q2) {
            if (cleaned[i] === "\\" && q2 === '"' && i + 1 < n) {
              const nextChar = cleaned[i + 1];
              buf += nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`" ? nextChar : "\\" + nextChar;
              i += 2;
            }
            else buf += cleaned[i++];
          }
          i++;
        } else {
          buf += cleaned[i++];
        }
      }
      tokens.push(buf);
    }
  }
  return tokens;
}

export type BodyType = "json" | "form" | "multipart" | "text" | "none";

export function normalize_shell_body(rawBody: string): string {
  let body = rawBody.replace(/\\\r?\n/g, "");
  body = body.trim();

  if (body.length >= 2 && body[0] === "$" && (body[1] === "{" || body[1] === "[")) {
    body = body.slice(1);
  }

  if (body.length >= 3 && body[0] === "$" && (body[1] === "'" || body[1] === '"') && body[body.length - 1] === body[1]) {
    body = body.slice(2, -1);
  } else if (body.length >= 2 && ((body[0] === "'" && body[body.length - 1] === "'") || (body[0] === '"' && body[body.length - 1] === '"'))) {
    body = body.slice(1, -1);
  }

  return body;
}

export function parse_json_body(body: string): unknown | null {
  const normalized = normalize_shell_body(body);
  if (!normalized.trim()) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function getHeader(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

export function detect_body_type(headers: Record<string, string>, body: string | null, hasMultipart = false): BodyType {
  if (body == null) return "none";
  const contentType = getHeader(headers, "content-type").toLowerCase();
  if (hasMultipart || contentType.includes("multipart/form-data")) return "multipart";
  if (contentType.includes("application/x-www-form-urlencoded")) return "form";
  if (contentType.includes("application/json") && parse_json_body(body) !== null) return "json";
  if (parse_json_body(body) !== null) return "json";
  if (/^[\w%.\-+[\]]+=([^&]*)(&[\w%.\-+[\]]+=([^&]*))*$/.test(normalize_shell_body(body).trim())) return "form";
  return "text";
}

export function splitCurlBlocks(input: string): string[] {
  if (!input.trim()) return [];
  // Normalize line continuations first so curl statements stay as one block.
  const normalized = input.replace(/\\\r?\n/g, " ");
  // Split on occurrences of `curl ` that begin a statement.
  const parts: string[] = [];
  const regex = /(^|\n|;|&&)\s*(curl\b)/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(normalized)) !== null) {
    indices.push(m.index + (m[1] ? m[1].length : 0));
  }
  if (indices.length === 0) {
    return [normalized.trim()].filter(Boolean);
  }
  for (let k = 0; k < indices.length; k++) {
    const start = indices[k];
    const end = k + 1 < indices.length ? indices[k + 1] : normalized.length;
    let chunk = normalized.slice(start, end).trim();
    // Trim trailing separators
    chunk = chunk.replace(/[;&]+\s*$/g, "").trim();
    if (chunk) parts.push(chunk);
  }
  return parts;
}

export function parseCurl(raw: string): ParsedCurl {
  const result: ParsedCurl = {
    method: "GET",
    url: "",
    domain: "",
    headers: {},
    data: null,
    dataType: "None",
    raw,
  };

  try {
    const tokens = tokenize(raw);
    if (tokens.length === 0 || tokens[0] !== "curl") {
      throw new Error("Not a curl command");
    }

    let explicitMethod = false;
    let dataParts: string[] = [];
    let isForm = false;
    let isMultipart = false;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      const next = () => tokens[++i];

      if (t === "-X" || t === "--request") {
        result.method = (next() || "GET").toUpperCase();
        explicitMethod = true;
      } else if (t === "-H" || t === "--header") {
        const h = next() || "";
        const idx = h.indexOf(":");
        if (idx > 0) {
          const k = h.slice(0, idx).trim();
          const v = h.slice(idx + 1).trim();
          if (k) result.headers[k] = v;
        }
      } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary" || t === "--data-ascii") {
        dataParts.push(normalize_shell_body(next() || ""));
      } else if (t === "--data-urlencode") {
        dataParts.push(normalize_shell_body(next() || ""));
        isForm = true;
      } else if (t === "-F" || t === "--form") {
        dataParts.push(normalize_shell_body(next() || ""));
        isMultipart = true;
      } else if (t === "-u" || t === "--user") {
        const u = next() || "";
        result.headers["Authorization"] = `Basic ${btoa(u)}`;
      } else if (t === "-A" || t === "--user-agent") {
        result.headers["User-Agent"] = next() || "";
      } else if (t === "-e" || t === "--referer") {
        result.headers["Referer"] = next() || "";
      } else if (t === "-b" || t === "--cookie") {
        result.headers["Cookie"] = next() || "";
      } else if (
        t === "-I" || t === "--head"
      ) {
        result.method = "HEAD";
        explicitMethod = true;
      } else if (t === "-G" || t === "--get") {
        result.method = "GET";
        explicitMethod = true;
      } else if (
        t === "-L" || t === "--location" ||
        t === "-k" || t === "--insecure" ||
        t === "-s" || t === "--silent" ||
        t === "-v" || t === "--verbose" ||
        t === "--compressed" || t === "-i" || t === "--include" ||
        t === "-o" || t === "--output" || t === "-O" || t === "--remote-name"
      ) {
        // ignore (some take an arg)
        if (t === "-o" || t === "--output") next();
      } else if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("//")) {
        result.url = t;
      } else if (!t.startsWith("-") && !result.url) {
        result.url = t;
      }
    }

    if (!result.url) throw new Error("No URL found");

    // Data
    if (dataParts.length > 0) {
      const joined = dataParts.join("&");
      result.data = joined;
      if (!explicitMethod) result.method = "POST";
      const detected = detect_body_type(result.headers, joined, isMultipart);
      if (detected === "multipart") {
        result.dataType = "Multipart";
      } else if (isForm || detected === "form") {
        result.dataType = "Form";
      } else if (detected === "json") {
        result.dataType = "JSON";
      } else {
        result.dataType = detected === "text" ? "Text" : "None";
      }
    }

    // Domain
    try {
      const u = new URL(result.url);
      result.domain = u.host;
    } catch {
      result.domain = result.url.replace(/^https?:\/\//, "").split("/")[0];
    }
  } catch (e: any) {
    result.error = e?.message || "Invalid curl";
  }

  return result;
}

// Python generation

interface GenOptions {
  client: "requests" | "httpx";
  async: boolean;
}

function pyStr(s: string): string {
  // Use double-quoted string with escapes
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
}

function pyDict(obj: Record<string, string>, indent = 4): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(indent);
  const lines = keys.map((k) => `${pad}${pyStr(k)}: ${pyStr(obj[k])},`);
  return "{\n" + lines.join("\n") + "\n" + " ".repeat(indent - 4) + "}";
}

function pyValueString(value: string, key?: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  void key;
  return JSON.stringify(normalized);
}

export function formatPythonValue(value: unknown, indent = 4, key?: string): string {
  const pad = " ".repeat(indent);
  const closePad = " ".repeat(Math.max(0, indent - 4));

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${pad}${formatPythonValue(item, indent + 4)},`).join("\n")}\n${closePad}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([entryKey, entryValue]) => `${pad}${pyStr(entryKey)}: ${formatPythonValue(entryValue, indent + 4, entryKey)},`).join("\n")}\n${closePad}}`;
  }

  if (typeof value === "string") return pyValueString(value, key);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : pyStr(String(value));
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null) return "None";
  return pyStr(String(value));
}

function formatJson(raw: string, indent = 4): string {
  try {
    const parsed = parse_json_body(raw);
    if (parsed === null) return pyStr(normalize_shell_body(raw));
    return formatPythonValue(parsed, indent);
  } catch {
    return pyStr(normalize_shell_body(raw));
  }
}

function parseFormString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  normalize_shell_body(s).split("&").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx >= 0) {
      const k = decodeURIComponent(pair.slice(0, idx));
      const v = decodeURIComponent(pair.slice(idx + 1));
      out[k] = v;
    } else if (pair) {
      out[pair] = "";
    }
  });
  return out;
}

function parseMultipartFields(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  normalize_shell_body(s).split("&").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (value.startsWith("@")) {
      out[key] = value;
    } else {
      out[key] = value;
    }
  });
  return out;
}

export function toPython(req: ParsedCurl, opts: GenOptions): string {
  if (req.error) {
    return `# Could not parse curl: ${req.error}\n`;
  }
  const { client, async: isAsync } = opts;
  const lines: string[] = [];

  if (client === "requests") {
    lines.push("from curl_cffi import requests");
  } else {
    lines.push(isAsync ? "import asyncio" : "");
    lines.push("import httpx");
  }
  lines.push("");

  lines.push(`url = ${pyStr(req.url)}`);

  const headerKeys = Object.keys(req.headers);
  if (headerKeys.length > 0) {
    lines.push(`headers = ${pyDict(req.headers, 4)}`);
  }

  let dataKwarg = "";
  if (req.data != null) {
    if (req.dataType === "JSON") {
      lines.push(`json_data = ${formatJson(req.data, 4)}`);
      dataKwarg = "json=json_data";
    } else if (req.dataType === "Form") {
      const dict = parseFormString(req.data);
      lines.push(`data = ${pyDict(dict, 4)}`);
      dataKwarg = "data=data";
    } else if (req.dataType === "Multipart") {
      const dict = parseMultipartFields(req.data);
      lines.push(`files = ${pyDict(dict, 4)}`);
      dataKwarg = "files=files";
    } else {
      lines.push(`data = ${pyStr(normalize_shell_body(req.data))}`);
      dataKwarg = "data=data";
    }
  }

  const method = req.method.toLowerCase();
  const args: string[] = ["url"];
  if (headerKeys.length > 0) args.push("headers=headers");
  if (dataKwarg) args.push(dataKwarg);

  lines.push("");

  if (client === "requests") {
    lines.push(`response = requests.${method}(`);
    args.forEach((arg) => lines.push(`    ${arg},`));
    lines.push(`    impersonate="chrome",`);
    lines.push(`    timeout=30,`);
    lines.push(`)`);
    lines.push("");
    lines.push("print(response.status_code)");
    lines.push("print(response.text)");
  } else if (!isAsync) {
    lines.push(`with httpx.Client() as client:`);
    lines.push(`    response = client.${method}(${args.join(", ")})`);
    lines.push("");
    lines.push("print(response.status_code)");
    lines.push("print(response.text)");
  } else {
    lines.push("async def main():");
    lines.push("    async with httpx.AsyncClient() as client:");
    lines.push(`        response = await client.${method}(${args.join(", ")})`);
    lines.push("        print(response.status_code)");
    lines.push("        print(response.text)");
    lines.push("");
    lines.push("asyncio.run(main())");
  }

  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}
