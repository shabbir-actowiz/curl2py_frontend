// Lightweight cURL parser → structured request, then Python code generator.
// Supports multiple curl blocks separated by newlines/&&/;.

export interface ParsedCurl {
  method: string;
  url: string;
  domain: string;
  headers: Record<string, string>;
  data: string | null;
  dataType: "JSON" | "Form" | "Text" | "None";
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
          buf += cleaned[i + 1];
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
            if (cleaned[i] === "\\" && q2 === '"' && i + 1 < n) { buf += cleaned[i + 1]; i += 2; }
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
            if (cleaned[i] === "\\" && q2 === '"' && i + 1 < n) { buf += cleaned[i + 1]; i += 2; }
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
        dataParts.push(next() || "");
      } else if (t === "--data-urlencode") {
        dataParts.push(next() || "");
        isForm = true;
      } else if (t === "-F" || t === "--form") {
        dataParts.push(next() || "");
        isForm = true;
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
      if (isForm) {
        result.dataType = "Form";
      } else {
        const trimmed = joined.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try { JSON.parse(trimmed); result.dataType = "JSON"; }
          catch { result.dataType = "Text"; }
        } else if (/^[\w%.\-+]+=([^&]*)(&[\w%.\-+]+=([^&]*))*$/.test(trimmed)) {
          result.dataType = "Form";
        } else {
          result.dataType = "Text";
        }
      }
      // Heuristic: if Content-Type header says json, treat as JSON
      const ct = Object.entries(result.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";
      if (/json/i.test(ct)) result.dataType = "JSON";
      else if (/x-www-form-urlencoded/i.test(ct)) result.dataType = "Form";
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

// ───────────────────── Python generation ─────────────────────

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

function formatJson(raw: string, indent = 4): string {
  try {
    const parsed = JSON.parse(raw);
    const json = JSON.stringify(parsed, null, 4);
    // Convert JSON to Python-ish dict (replace true/false/null)
    const pyish = json
      .replace(/: true\b/g, ": True")
      .replace(/: false\b/g, ": False")
      .replace(/: null\b/g, ": None");
    // re-indent
    return pyish.split("\n").map((l, i) => i === 0 ? l : " ".repeat(indent - 4) + l).join("\n");
  } catch {
    return pyStr(raw);
  }
}

function parseFormString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  s.split("&").forEach((pair) => {
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

export function toPython(req: ParsedCurl, opts: GenOptions): string {
  if (req.error) {
    return `# Could not parse curl: ${req.error}\n`;
  }
  const { client, async: isAsync } = opts;
  const lines: string[] = [];

  if (client === "requests") {
    lines.push("import requests");
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
      lines.push(`payload = ${formatJson(req.data, 4)}`);
      dataKwarg = "json=payload";
    } else if (req.dataType === "Form") {
      const dict = parseFormString(req.data);
      lines.push(`data = ${pyDict(dict, 4)}`);
      dataKwarg = "data=data";
    } else {
      lines.push(`data = ${pyStr(req.data)}`);
      dataKwarg = "data=data";
    }
  }

  const method = req.method.toLowerCase();
  const args: string[] = ["url"];
  if (headerKeys.length > 0) args.push("headers=headers");
  if (dataKwarg) args.push(dataKwarg);

  lines.push("");

  if (client === "requests") {
    lines.push(`response = requests.${method}(${args.join(", ")})`);
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
