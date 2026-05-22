import type { JSONOutput } from "curlconverter";
import { formatPythonValue } from "@/lib/curl-to-python";

interface EnhanceOptions {
  functionName: string;
  request: JSONOutput;
  proxy?: { enabled?: boolean; url?: string };
}

interface BatchEnhanceOptions {
  requests: Array<{ functionName: string; request: JSONOutput }>;
  proxy?: { enabled?: boolean; url?: string };
}

function pyString(value: string): string {
  return JSON.stringify(value);
}

function pyDict(value: Record<string, unknown>, indent = 4): string {
  return formatPythonValue(value, indent);
}

function parseJsonBody(value: unknown): unknown | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.replace(/\r/g, "\\r").replace(/\n/g, "\\n"));
    } catch {
      return null;
    }
  }
}

function headersContain(headers: JSONOutput["headers"], needle: string): boolean {
  if (!headers) return false;
  return Object.entries(headers).some(([key, value]) => {
    return key.toLowerCase() === "content-type" && String(value || "").toLowerCase().includes(needle);
  });
}

function cleanHeaders(headers: JSONOutput["headers"]): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );
}

function buildRequestFunction({ functionName, request, proxy }: EnhanceOptions): string {
  const lines: string[] = [];
  const method = (request.method || "get").toLowerCase();
  const headers = cleanHeaders(request.headers);
  const hasProxy = !!proxy?.enabled && !!proxy.url?.trim();
  const jsonBody = headersContain(request.headers, "application/json") && request.data && typeof request.data === "object"
    ? request.data
    : parseJsonBody(request.data);
  const isForm = headersContain(request.headers, "application/x-www-form-urlencoded") || (request.data && typeof request.data === "object" && !Array.isArray(request.data));

  lines.push(`def ${functionName}():`);
  lines.push(`    url = ${pyString(request.url || request.raw_url)}`);
  lines.push("");

  if (Object.keys(headers).length > 0) {
    lines.push(`    headers = ${pyDict(headers, 8)}`);
    lines.push("");
  }

  if (request.queries && Object.keys(request.queries).length > 0) {
    lines.push(`    params = ${pyDict(request.queries as Record<string, unknown>, 8)}`);
    lines.push("");
  }

  if (jsonBody !== null) {
    lines.push(`    json_data = ${formatPythonValue(jsonBody, 8)}`);
    lines.push("");
  } else if (request.data !== undefined && request.data !== null) {
    if (isForm && typeof request.data === "object" && !Array.isArray(request.data)) {
      lines.push(`    data = ${pyDict(request.data as Record<string, unknown>, 8)}`);
    } else {
      lines.push(`    data = ${pyString(String(request.data))}`);
    }
    lines.push("");
  }

  if (request.files && Object.keys(request.files).length > 0) {
    lines.push("    files = {");
    Object.entries(request.files).forEach(([key, value]) => {
      lines.push(`        ${pyString(key)}: open(${pyString(String(value))}, "rb"),`);
    });
    lines.push("    }");
    lines.push("");
  }

  if (request.auth?.user !== undefined) {
    lines.push(`    auth = (${pyString(request.auth.user)}, ${pyString(request.auth.password || "")})`);
    lines.push("");
  }

  if (hasProxy) {
    lines.push("    proxies = {");
    lines.push(`        "http": ${pyString(proxy.url.trim())},`);
    lines.push(`        "https": ${pyString(proxy.url.trim())},`);
    lines.push("    }");
    lines.push("");
  }

  lines.push(`    response = requests.${method}(`);
  lines.push("        url,");
  if (request.queries && Object.keys(request.queries).length > 0) lines.push("        params=params,");
  if (Object.keys(headers).length > 0) lines.push("        headers=headers,");
  if (jsonBody !== null) lines.push("        json=json_data,");
  else if (request.data !== undefined && request.data !== null) lines.push("        data=data,");
  if (request.files && Object.keys(request.files).length > 0) lines.push("        files=files,");
  if (request.auth?.user !== undefined) lines.push("        auth=auth,");
  if (hasProxy) lines.push("        proxies=proxies,");
  lines.push('        impersonate="chrome",');
  lines.push("        timeout=30,");
  lines.push("    )");
  lines.push("");
  lines.push("    response.raise_for_status()");
  lines.push(`    save_response(response, ${pyString(functionName)})`);
  lines.push(`    return ${functionName}_parser(response)`);
  return lines.join("\n");
}

function buildSaveResponseFunction(): string {
  return [
    "def save_response(response, request_name):",
    '    content_type = response.headers.get("content-type", "").lower()',
    '    response_folder = "pagesaves"',
    "    os.makedirs(response_folder, exist_ok=True)",
    "",
    '    if "application/json" in content_type:',
    '        response_file = os.path.join(response_folder, f"{request_name}_response.json")',
    '        with open(response_file, "w", encoding="utf-8") as f:',
    "            json.dump(response.json(), f, indent=2, ensure_ascii=False)",
    "    else:",
    '        response_file = os.path.join(response_folder, f"{request_name}_response.html")',
    '        with open(response_file, "w", encoding="utf-8") as f:',
    "            f.write(response.text)",
  ].join("\n");
}

export function enhanceCurlConverterPython(_curlconverterPython: string, options: EnhanceOptions): string {
  return buildCurlCraftScript({
    requests: [{ functionName: options.functionName, request: options.request }],
    proxy: options.proxy,
  });
}

export function buildCurlCraftScript({ requests, proxy }: BatchEnhanceOptions): string {
  const code: string[] = [
    "import json",
    "import os",
    "from curl_cffi import requests",
    "from parser import *",
    "",
  ];

  requests.forEach((entry) => {
    code.push(buildRequestFunction({ ...entry, proxy }));
    code.push("");
  });

  code.push(buildSaveResponseFunction());
  code.push("");
  code.push("def do_requests():");
  requests.forEach((entry) => {
    code.push(`    ${entry.functionName}()`);
  });
  code.push("");
  code.push('if __name__ == "__main__":');
  code.push("    do_requests()");
  code.push("");

  return code.join("\n");
}

export function buildParserStubs(functionNames: string[]): string {
  return functionNames.map((name) => [
    `def ${name}_parser(response):`,
    "    # TODO: Implement response parsing logic",
    '    content_type = response.headers.get("content-type", "")',
    '    if "application/json" in content_type.lower():',
    "        return response.json()",
    "    return response.text",
    "",
  ].join("\n")).join("\n");
}
