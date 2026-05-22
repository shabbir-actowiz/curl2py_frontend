// Generates merged scripts from multiple parsed curl requests.
import type { ParsedCurl } from "./curl-to-python";
import { formatPythonValue, normalize_shell_body, parse_json_body } from "./curl-to-python";

export interface MergeOptions {
  client: "requests" | "httpx";
  async: boolean;
}

function safeName(parsed: ParsedCurl, idx: number): string {
  const method = (parsed.method || "GET").toLowerCase();
  let path = "request";
  try {
    const u = new URL(parsed.url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length > 0) {
      path = segs[segs.length - 1].replace(/[^a-zA-Z0-9_]/g, "_") || "request";
    } else {
      path = u.host.split(".")[0] || "request";
    }
  } catch {
    /* noop */
  }
  // ensure starts with letter
  if (!/^[a-zA-Z_]/.test(path)) path = "r_" + path;
  return `${method}_${path}_${idx + 1}`.toLowerCase();
}

function pyStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
}

function pyDict(obj: Record<string, string>, indent = 8): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(indent);
  const lines = keys.map((k) => `${pad}${pyStr(k)}: ${pyStr(obj[k])},`);
  return "{\n" + lines.join("\n") + "\n" + " ".repeat(indent - 4) + "}";
}

function formatJson(raw: string, baseIndent = 8): string {
  try {
    const parsed = parse_json_body(raw);
    if (parsed === null) return pyStr(normalize_shell_body(raw));
    return formatPythonValue(parsed, baseIndent);
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
    } else if (pair) out[pair] = "";
  });
  return out;
}

function parseMultipartFields(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  normalize_shell_body(s).split("&").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx >= 0) out[part.slice(0, idx)] = part.slice(idx + 1);
  });
  return out;
}

export interface NamedRequest {
  fnName: string;
  parsed: ParsedCurl;
  index: number;
}

export function buildNamedRequests(blocks: ParsedCurl[], customNames?: (string | undefined)[]): NamedRequest[] {
  const used = new Set<string>();
  return blocks.map((parsed, index) => {
    const custom = customNames?.[index]?.trim();
    let name = custom && custom.length > 0 ? custom : safeName(parsed, index);
    let n = name;
    let i = 2;
    while (used.has(n)) { n = `${name}_${i++}`; }
    used.add(n);
    return { fnName: n, parsed, index };
  });
}

function buildRequestFunction(req: NamedRequest, opts: MergeOptions): string {
  const { parsed, fnName } = req;
  const { client, async: isAsync } = opts;
  const lines: string[] = [];

  if (parsed.error) {
    lines.push(`def ${fnName}():`);
    lines.push(`    # Skipped - invalid curl: ${parsed.error}`);
    lines.push(`    return None`);
    return lines.join("\n");
  }

  const headerKeys = Object.keys(parsed.headers);
  const method = parsed.method.toLowerCase();

  const sig = client === "httpx" && isAsync
    ? `async def ${fnName}(client):`
    : client === "httpx"
      ? `def ${fnName}(client):`
      : `def ${fnName}():`;
  lines.push(sig);

  lines.push(`    url = ${pyStr(parsed.url)}`);
  if (headerKeys.length > 0) {
    lines.push(`    headers = ${pyDict(parsed.headers, 8)}`);
  }

  let dataKwarg = "";
  if (parsed.data != null) {
    if (parsed.dataType === "JSON") {
      lines.push(`    json_data = ${formatJson(parsed.data, 8)}`);
      dataKwarg = "json=json_data";
    } else if (parsed.dataType === "Form") {
      const dict = parseFormString(parsed.data);
      lines.push(`    data = ${pyDict(dict, 8)}`);
      dataKwarg = "data=data";
    } else if (parsed.dataType === "Multipart") {
      const dict = parseMultipartFields(parsed.data);
      lines.push(`    files = ${pyDict(dict, 8)}`);
      dataKwarg = "files=files";
    } else {
      lines.push(`    data = ${pyStr(normalize_shell_body(parsed.data))}`);
      dataKwarg = "data=data";
    }
  }

  const args: string[] = ["url"];
  if (headerKeys.length > 0) args.push("headers=headers");
  if (dataKwarg) args.push(dataKwarg);

  if (client === "requests") {
    lines.push(`    response = requests.${method}(`);
    args.forEach((arg) => lines.push(`        ${arg},`));
    lines.push(`        impersonate="chrome",`);
    lines.push(`        timeout=30,`);
    lines.push(`    )`);
  } else if (!isAsync) {
    lines.push(`    response = client.${method}(${args.join(", ")})`);
  } else {
    lines.push(`    response = await client.${method}(${args.join(", ")})`);
  }
  lines.push(`    return response`);
  return lines.join("\n");
}

export function buildGeneratedScript(blocks: ParsedCurl[], opts: MergeOptions, customNames?: (string | undefined)[]): string {
  const reqs = buildNamedRequests(blocks, customNames);
  const { client, async: isAsync } = opts;
  const out: string[] = [];

  out.push(`# generated_script.py - combined requests from curl2py`);
  if (client === "requests") {
    out.push(`from curl_cffi import requests`);
  } else {
    if (isAsync) out.push(`import asyncio`);
    out.push(`import httpx`);
  }
  out.push(`from parser import ${reqs.map((r) => `${r.fnName}_parser`).join(", ")}`);
  out.push("");

  for (const r of reqs) {
    out.push(buildRequestFunction(r, opts));
    out.push("");
  }

  if (client === "requests") {
    out.push(`def main():`);
    for (const r of reqs) {
      out.push(`    response_${r.index + 1} = ${r.fnName}()`);
      out.push(`    ${r.fnName}_parser(response_${r.index + 1})`);
    }
    out.push("");
    out.push(`if __name__ == "__main__":`);
    out.push(`    main()`);
  } else if (!isAsync) {
    out.push(`def main():`);
    out.push(`    with httpx.Client() as client:`);
    for (const r of reqs) {
      out.push(`        response_${r.index + 1} = ${r.fnName}(client)`);
      out.push(`        ${r.fnName}_parser(response_${r.index + 1})`);
    }
    out.push("");
    out.push(`if __name__ == "__main__":`);
    out.push(`    main()`);
  } else {
    out.push(`async def main():`);
    out.push(`    async with httpx.AsyncClient() as client:`);
    for (const r of reqs) {
      out.push(`        response_${r.index + 1} = await ${r.fnName}(client)`);
      out.push(`        ${r.fnName}_parser(response_${r.index + 1})`);
    }
    out.push("");
    out.push(`if __name__ == "__main__":`);
    out.push(`    asyncio.run(main())`);
  }
  return out.join("\n");
}

export function buildParserStub(blocks: ParsedCurl[], customNames?: (string | undefined)[]): string {
  const reqs = buildNamedRequests(blocks, customNames);
  const out: string[] = [];
  out.push(`# parser.py - auto-generated parser stubs`);
  out.push(`# Fill in the body of each function to parse the response.`);
  out.push("");
  for (const r of reqs) {
    const dt = r.parsed.dataType;
    const domain = r.parsed.domain || "-";
    out.push(`def ${r.fnName}_parser(response):`);
    out.push(`    """Parse response from ${r.parsed.method.toUpperCase()} ${domain} (${dt})."""`);
    out.push(`    # TODO: implement parser`);
    out.push(`    pass`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
