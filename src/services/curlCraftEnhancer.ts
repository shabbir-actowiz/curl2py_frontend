import type { JSONOutput } from "curlconverter";
import { formatPythonValue } from "@/lib/curl-to-python";

interface EnhanceOptions {
  functionName: string;
  request: JSONOutput;
  proxy?: { enabled?: boolean; url?: string };
  contextRequests?: Array<{ functionName: string; request: JSONOutput }>;
}

interface BatchEnhanceOptions {
  requests: Array<{ functionName: string; request: JSONOutput; code?: string }>;
  proxy?: { enabled?: boolean; url?: string };
  parserFunctionNames?: string[];
}

const PIPELINE_PLACEHOLDER_PATTERN = /\{\{?\s*[A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+)|\[\d+\])+(?:\|(?:string|int|float|bool))?\s*\}\}?/;
const PIPELINE_REFERENCE_PATTERN = /\{\{?\s*([A-Za-z_][A-Za-z0-9_]*)((?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+)|\[\d+\])+)(?:\|(string|int|float|bool))?\s*\}\}?/g;
const PIPELINE_FULL_REFERENCE_PATTERN = /^\{\{?\s*([A-Za-z_][A-Za-z0-9_]*)((?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+)|\[\d+\])+)(?:\|(string|int|float|bool))?\s*\}\}?$/;
const PIPELINE_CALL_PATTERN = /get_pipeline_value\(\s*("[^"]+")\s*,\s*("[^"]+")\s*,\s*pipeline_context(?:\s*,\s*("(?:string|int|float|bool)"))?\s*\)/g;
const PIPELINE_DEFAULTS_PREFIX = "# curl2py-pipeline-defaults: ";
const PIPELINE_PATH_TOKEN_PATTERN = /\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[(\d+)\]/g;

export const PIPELINE_UTILS_CODE = `import re

_PATTERN = re.compile(r"\\{\\{?\\s*([A-Za-z_][A-Za-z0-9_]*)((?:\\.(?:[A-Za-z_][A-Za-z0-9_]*|\\d+)|\\[\\d+\\])+)(?:\\|(string|int|float|bool))?\\s*\\}\\}?")
_PATH_TOKEN_PATTERN = re.compile(r"\\.([A-Za-z_][A-Za-z0-9_]*|\\d+)|\\[(\\d+)\\]")

def _path_tokens(path):
    tokens = []
    pos = 0
    for match in _PATH_TOKEN_PATTERN.finditer(path):
        if match.start() != pos:
            raise ValueError(f"Invalid pipeline path {path}")
        raw_dot_token = match.group(1)
        tokens.append(int(raw_dot_token) if raw_dot_token and raw_dot_token.isdigit() else raw_dot_token if raw_dot_token is not None else int(match.group(2)))
        pos = match.end()
    if pos != len(path):
        raise ValueError(f"Invalid pipeline path {path}")
    return tokens

def _lookup_pipeline_value(request_name, path, pipeline_context):
    if request_name not in pipeline_context:
        raise ValueError(f"Missing pipeline value: {request_name}{path}")

    value = pipeline_context[request_name]
    for token in _path_tokens(path):
        if isinstance(token, str) and isinstance(value, dict) and token in value:
            value = value[token]
            continue
        if isinstance(token, int) and isinstance(value, list) and 0 <= token < len(value):
            value = value[token]
            continue
        raise ValueError(f"Missing pipeline value: {request_name}{path}")
    return value

def convert_pipeline_value(value, expected_type, request_name=None, path=None):
    if expected_type in (None, "any"):
        return value
    label = f"{request_name}{path}" if request_name and path else "pipeline value"
    try:
        if expected_type == "string":
            return str(value)
        if expected_type == "int":
            if isinstance(value, bool):
                raise ValueError("boolean is not a valid int")
            return int(value)
        if expected_type == "float":
            if isinstance(value, bool):
                raise ValueError("boolean is not a valid float")
            return float(value)
        if expected_type == "bool":
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized in ("true", "1", "yes", "y", "on"):
                    return True
                if normalized in ("false", "0", "no", "n", "off"):
                    return False
            if isinstance(value, (int, float)) and value in (0, 1):
                return bool(value)
            raise ValueError("expected true/false, 1/0, yes/no, or on/off")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Cannot convert {label}={value!r} to {expected_type}: {exc}") from exc
    raise ValueError(f"Unsupported pipeline type: {expected_type}")

def get_pipeline_value(request_name, path, pipeline_context, expected_type=None):
    value = _lookup_pipeline_value(request_name, path, pipeline_context)
    return convert_pipeline_value(value, expected_type, request_name, path)

def resolve_pipeline_placeholders(value, pipeline_context):
    if isinstance(value, dict):
        return {k: resolve_pipeline_placeholders(v, pipeline_context) for k, v in value.items()}

    if isinstance(value, list):
        return [resolve_pipeline_placeholders(v, pipeline_context) for v in value]

    if not isinstance(value, str):
        return value

    full = _PATTERN.fullmatch(value)
    if full:
        return get_pipeline_value(full.group(1), full.group(2), pipeline_context, full.group(3))

    def replace(match):
        resolved = get_pipeline_value(match.group(1), match.group(2), pipeline_context, match.group(3))
        return str(resolved)

    return _PATTERN.sub(replace, value)
`;

function pyString(value: string): string {
  return JSON.stringify(value);
}

function pyDict(value: Record<string, unknown>, indent = 4): string {
  return formatPythonPipelineValue(value, indent);
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

function splitUrlAndQueries(rawUrl: string, queries: JSONOutput["queries"]): { url: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  let url = rawUrl;

  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    parsed.search = "";
    url = parsed.toString();
  } catch {
    const queryIndex = rawUrl.indexOf("?");
    if (queryIndex >= 0) {
      url = rawUrl.slice(0, queryIndex);
      new URLSearchParams(rawUrl.slice(queryIndex + 1)).forEach((value, key) => {
        params[key] = value;
      });
    }
  }

  if (queries && typeof queries === "object") {
    Object.entries(queries).forEach(([key, value]) => {
      params[key] = value as unknown;
    });
  }

  return { url, params };
}

function pipelineAccessExpression(requestName: string, path: string, expectedType?: string): string {
  return `get_pipeline_value(${pyString(requestName)}, ${pyString(path)}, pipeline_context${expectedType ? `, ${pyString(expectedType)}` : ""})`;
}

function pyPipelineString(value: string): string {
  const full = PIPELINE_FULL_REFERENCE_PATTERN.exec(value);
  if (full) return pipelineAccessExpression(full[1], full[2], full[3]);

  const parts: string[] = [];
  let pos = 0;
  for (const match of value.matchAll(PIPELINE_REFERENCE_PATTERN)) {
    if (match.index > pos) parts.push(pyString(value.slice(pos, match.index)));
    parts.push(`str(${pipelineAccessExpression(match[1], match[2], match[3])})`);
    pos = match.index + match[0].length;
  }
  if (pos < value.length) parts.push(pyString(value.slice(pos)));
  return parts.length > 0 ? parts.join(" + ") : pyString(value);
}

function formatPythonPipelineValue(value: unknown, indent = 4): string {
  const pad = " ".repeat(indent);
  const closePad = " ".repeat(Math.max(0, indent - 4));

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${pad}${formatPythonPipelineValue(item, indent + 4)},`).join("\n")}\n${closePad}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([entryKey, entryValue]) => `${pad}${pyString(entryKey)}: ${formatPythonPipelineValue(entryValue, indent + 4)},`).join("\n")}\n${closePad}}`;
  }

  if (typeof value === "string") return valueHasPipelinePlaceholder(value) ? pyPipelineString(value) : formatPythonValue(value, indent);
  return formatPythonValue(value, indent);
}

function valueHasPipelinePlaceholder(value: unknown): boolean {
  if (typeof value === "string") return PIPELINE_PLACEHOLDER_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(valueHasPipelinePlaceholder);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(valueHasPipelinePlaceholder);
  return false;
}

function requestUsesPipeline(request: JSONOutput): boolean {
  return [
    request.url || request.raw_url,
    request.headers,
    request.queries,
    request.data,
    request.files,
    request.auth,
  ].some(valueHasPipelinePlaceholder);
}

function pipelineReferences(value: unknown): Array<{ requestName: string; path: string; expectedType?: string }> {
  const refs: Array<{ requestName: string; path: string; expectedType?: string }> = [];
  const seen = new Set<string>();

  const visit = (item: unknown) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(PIPELINE_REFERENCE_PATTERN)) {
        const requestName = match[1];
        const path = match[2];
        const expectedType = match[3];
        const key = `${requestName}:${path}:${expectedType || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({ requestName, path, expectedType });
        }
      }
      for (const match of item.matchAll(PIPELINE_CALL_PATTERN)) {
        try {
          const requestName = JSON.parse(match[1]) as string;
          const path = JSON.parse(match[2]) as string;
          const expectedType = match[3] ? JSON.parse(match[3]) as string : undefined;
          const key = `${requestName}:${path}:${expectedType || ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ requestName, path, expectedType });
          }
        } catch {
          // Ignore hand-edited calls that are not simple generated string literals.
        }
      }
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (item && typeof item === "object") {
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  };

  visit(value);
  return refs;
}

function pipelinePathTokens(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  PIPELINE_PATH_TOKEN_PATTERN.lastIndex = 0;
  let pos = 0;
  for (const match of path.matchAll(PIPELINE_PATH_TOKEN_PATTERN)) {
    if (match.index !== pos) return [];
    tokens.push(match[1] !== undefined ? (/^\d+$/.test(match[1]) ? Number(match[1]) : match[1]) : Number(match[2]));
    pos = match.index + match[0].length;
  }
  return pos === path.length ? tokens : [];
}

function mockPipelineValue(key: string, expectedType?: string): unknown {
  if (expectedType === "string") return key.toLowerCase().includes("pincode") || key.toLowerCase().includes("pin") ? "110001" : `mock_${key}`;
  if (expectedType === "int") return 12345;
  if (expectedType === "float") return key.toLowerCase().includes("lng") || key.toLowerCase().includes("lon") ? 77.5946 : 12.9716;
  if (expectedType === "bool") return true;
  const lowered = key.toLowerCase();
  if (lowered.includes("coordinate") || ["coords", "location", "latlng", "lnglat"].includes(lowered)) return [12.9716, 77.5946];
  if (["lat", "latitude"].includes(lowered)) return 12.9716;
  if (["lng", "lon", "longitude"].includes(lowered)) return 77.5946;
  if (lowered.includes("token")) return "abc123";
  if (lowered.endsWith("_id") || lowered === "id" || lowered.includes("store_id")) return "12345";
  if (lowered.includes("count") || lowered.includes("total") || lowered.includes("page")) return 1;
  if (lowered.startsWith("is_") || lowered.startsWith("has_") || ["active", "enabled"].includes(lowered)) return true;
  return `mock_${key}`;
}

function assertNoUnresolvedPipelinePlaceholders(code: string): void {
  if (/\{\{?\s*request_[A-Za-z0-9_]*(?:\.|\[)/.test(code)) {
    throw new Error("Generated request code contains unresolved pipeline placeholders");
  }
}

function buildDefaultContextFromCode(code: string): Record<string, unknown> {
  const context: Record<string, unknown> = extractExistingDefaultContext(code) ?? {};
  pipelineReferences(code).forEach(({ requestName, path, expectedType }) => assignDefaultContextPath(context, requestName, path, expectedType));
  mergePipelineDefaultMetadata(context, code);
  return context;
}

function extractExistingDefaultContext(code: string): Record<string, unknown> | null {
  const lines = code.split("\n");
  const range = findDefaultContextRange(lines);
  if (!range) return null;
  const assignment = lines.slice(range.start, range.end + 1).join("\n");
  const literal = assignment.replace(/^DEFAULT_PIPELINE_CONTEXT\s*=\s*/, "");
  try {
    const jsonish = literal
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    const parsed = JSON.parse(jsonish) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function mergePlainObject(target: Record<string, unknown>, source: Record<string, unknown>): void {
  Object.entries(source).forEach(([key, value]) => {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && target[key]
      && typeof target[key] === "object"
      && !Array.isArray(target[key])
    ) {
      mergePlainObject(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      return;
    }
    target[key] = value;
  });
}

function mergePipelineDefaultMetadata(context: Record<string, unknown>, code: string): void {
  code.split("\n").forEach((line) => {
    if (!line.startsWith(PIPELINE_DEFAULTS_PREFIX)) return;
    try {
      const defaults = JSON.parse(line.slice(PIPELINE_DEFAULTS_PREFIX.length)) as Record<string, unknown>;
      mergePlainObject(context, defaults);
    } catch {
      // Ignore malformed metadata; placeholder references will still get safe fallbacks.
    }
  });
}

function insertLineAfterImports(code: string, line: string): string {
  if (code.includes(line)) return code;
  const lines = code.split("\n");
  let insertAt = 0;
  while (insertAt < lines.length && /^(import |from )/.test(lines[insertAt])) insertAt += 1;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

function insertDefaultContext(code: string, context: Record<string, unknown>): string {
  const lines = removeDefaultContext(code).split("\n");
  let insertAt = 0;
  while (insertAt < lines.length && (/^(import |from )/.test(lines[insertAt]) || lines[insertAt].trim() === "")) insertAt += 1;
  lines.splice(insertAt, 0, `DEFAULT_PIPELINE_CONTEXT = ${formatPythonValue(context, 4)}`, "");
  return lines.join("\n");
}

function removeDefaultContext(code: string): string {
  const lines = code.split("\n");
  const range = findDefaultContextRange(lines);
  if (!range) return code;
  const start = range.start;
  const end = range.end;
  lines.splice(start, end - start + 1);
  while (start < lines.length && lines[start]?.trim() === "" && lines[start - 1]?.trim() === "") {
    lines.splice(start, 1);
  }
  return lines.join("\n");
}

function findDefaultContextRange(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => /^DEFAULT_PIPELINE_CONTEXT\s*=/.test(line));
  if (start < 0) return null;
  let end = start;
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{" || char === "[") depth += 1;
      if (char === "}" || char === "]") depth -= 1;
    }
    end = index;
    if (depth <= 0 && (index > start || /[}\]]/.test(lines[index]) || !/[{\[]/.test(lines[index]))) break;
  }
  return { start, end };
}

function replacePlaceholderLiterals(code: string): string {
  return code.replace(/(["'])\{\{?\s*([A-Za-z_][A-Za-z0-9_]*)((?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+)|\[\d+\])+)(?:\|(string|int|float|bool))?\s*\}\}?\1/g, (_match, _quote, requestName, path, expectedType) => {
    return pipelineAccessExpression(requestName, path, expectedType);
  });
}

function addPipelineArgAndDefault(code: string): string {
  const lines = code.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^def\s+(request_\d+|[A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\):\s*$/);
    if (!match) continue;
    if (!match[2].includes("pipeline_context")) {
      const args = match[2].trim();
      lines[index] = `def ${match[1]}(${args ? `${args}, ` : ""}pipeline_context=None):`;
    }
    const nextLine = lines[index + 1] ?? "";
    if (nextLine.includes("pipeline_context = pipeline_context or DEFAULT_PIPELINE_CONTEXT")) {
      lines.splice(index + 1, 1, "    if pipeline_context is None:", `        raise ValueError("pipeline_context is required for ${match[1]}; standalone defaults are used only by do_requests()")`);
    } else if (!nextLine.includes("if pipeline_context is None:")) {
      lines.splice(index + 1, 0, "    if pipeline_context is None:", `        raise ValueError("pipeline_context is required for ${match[1]}; standalone defaults are used only by do_requests()")`, "");
    }
    break;
  }
  return lines.join("\n");
}

function insertResolverAfterAssignment(code: string, variableName: string): string {
  if (code.includes(`${variableName} = resolve_pipeline_placeholders(${variableName}, pipeline_context)`)) return code;
  const lines = code.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`^\\s*${variableName}\\s*=\\s*[\\{\\[]`).test(lines[index])) continue;
    const indent = lines[index].match(/^\s*/)?.[0] ?? "";
    let depth = 0;
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      for (const char of lines[cursor]) {
        if (char === "{" || char === "[") depth += 1;
        if (char === "}" || char === "]") depth -= 1;
      }
      if (cursor > index && depth <= 0) {
        lines.splice(cursor + 1, 0, `${indent}${variableName} = resolve_pipeline_placeholders(${variableName}, pipeline_context)`);
        return lines.join("\n");
      }
    }
  }
  return code;
}

function passContextInDoRequests(code: string): string {
  return code.replace(/^(\s*)request_(\d+)\(\)$/gm, "$1request_$2(pipeline_context=DEFAULT_PIPELINE_CONTEXT)");
}

export function repairPythonPipelinePlaceholders(code: string): string {
  if (!valueHasPipelinePlaceholder(code) && !code.includes("get_pipeline_value(") && !code.includes(PIPELINE_DEFAULTS_PREFIX)) return code;
  const context = buildDefaultContextFromCode(code);
  let next = code;
  next = insertLineAfterImports(next, "from pipeline_utils import get_pipeline_value, resolve_pipeline_placeholders");
  next = insertDefaultContext(next, context);
  next = replacePlaceholderLiterals(next);
  next = addPipelineArgAndDefault(next);
  ["params", "headers", "json_data", "data", "url"].forEach((variableName) => {
    next = insertResolverAfterAssignment(next, variableName);
  });
  next = passContextInDoRequests(next);
  assertNoUnresolvedPipelinePlaceholders(next);
  return next;
}

function mockPipelineIndexedValue(key: string, index: number, expectedType?: string): unknown {
  const value = mockPipelineValue(key, expectedType);
  if (Array.isArray(value) && value.length > 0) return index < value.length ? value[index] : value[value.length - 1];
  return value;
}

function assignDefaultContextPath(root: Record<string, unknown>, requestName: string, path: string, expectedType?: string): void {
  const tokens = pipelinePathTokens(path);
  if (tokens.length === 0) return;
  let current: unknown = root[requestName] ?? {};
  root[requestName] = current;

  tokens.forEach((token, index) => {
    const last = index === tokens.length - 1;
    const nextToken = tokens[index + 1];

    if (typeof token === "string") {
      if (!current || typeof current !== "object" || Array.isArray(current)) return;
      const obj = current as Record<string, unknown>;
      if (last) {
        if (!(token in obj)) obj[token] = mockPipelineValue(token, expectedType);
        return;
      }
      if (!(token in obj)) obj[token] = typeof nextToken === "number" ? [] : {};
      current = obj[token];
      return;
    }

    if (!Array.isArray(current)) return;
    while (current.length <= token) {
      const key = String(tokens[index - 1] ?? "value");
      current.push(typeof nextToken === "string" ? {} : mockPipelineIndexedValue(key, current.length, expectedType));
    }
    if (last) {
      if (current[token] && typeof current[token] === "object") current[token] = mockPipelineIndexedValue(String(tokens[index - 1] ?? "value"), token, expectedType);
      return;
    }
    current = current[token];
  });
}

function buildDefaultPipelineContext(requests: BatchEnhanceOptions["requests"]): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  requests.forEach(({ request }) => {
    [
      request.url || request.raw_url,
      request.headers,
      request.queries,
      request.data,
      request.files,
      request.auth,
    ].forEach((value) => {
      pipelineReferences(value).forEach(({ requestName, path, expectedType }) => assignDefaultContextPath(context, requestName, path, expectedType));
    });
  });
  return context;
}

function buildRequestFunction({ functionName, request, proxy }: EnhanceOptions): string {
  const lines: string[] = [];
  const method = (request.method || "get").toLowerCase();
  const { url, params } = splitUrlAndQueries(request.url || request.raw_url, request.queries);
  const headers = cleanHeaders(request.headers);
  const hasHeaders = Object.keys(headers).length > 0;
  const hasParams = Object.keys(params).length > 0;
  const hasProxy = !!proxy?.enabled && !!proxy.url?.trim();
  const jsonBody = headersContain(request.headers, "application/json") && request.data && typeof request.data === "object"
    ? request.data
    : parseJsonBody(request.data);
  const isForm = headersContain(request.headers, "application/x-www-form-urlencoded") || (request.data && typeof request.data === "object" && !Array.isArray(request.data));
  const hasPipeline = requestUsesPipeline(request);
  const resolveVars: string[] = [];

  lines.push(hasPipeline ? `def ${functionName}(pipeline_context=None):` : `def ${functionName}():`);
  if (hasPipeline) {
    lines.push("    if pipeline_context is None:");
    lines.push(`        raise ValueError("pipeline_context is required for ${functionName}; standalone defaults are used only by do_requests()")`);
    lines.push("");
  }
  lines.push(`    url = ${pyPipelineString(url)}`);
  if (valueHasPipelinePlaceholder(url)) {
    lines.push("    url = resolve_pipeline_placeholders(url, pipeline_context)");
  }
  lines.push("");

  if (hasHeaders) {
    lines.push(`    headers = ${pyDict(headers, 8)}`);
    if (valueHasPipelinePlaceholder(headers)) resolveVars.push("headers");
    lines.push("");
  }

  if (hasParams) {
    lines.push(`    params = ${pyDict(params, 8)}`);
    if (valueHasPipelinePlaceholder(params)) resolveVars.push("params");
    lines.push("");
  }

  if (jsonBody !== null) {
    lines.push(`    json_data = ${formatPythonPipelineValue(jsonBody, 8)}`);
    if (valueHasPipelinePlaceholder(jsonBody)) resolveVars.push("json_data");
    lines.push("");
  } else if (request.data !== undefined && request.data !== null) {
    if (isForm && typeof request.data === "object" && !Array.isArray(request.data)) {
      lines.push(`    data = ${pyDict(request.data as Record<string, unknown>, 8)}`);
    } else {
      lines.push(`    data = ${pyPipelineString(String(request.data))}`);
    }
    if (valueHasPipelinePlaceholder(request.data)) resolveVars.push("data");
    lines.push("");
  }

  if (request.files && Object.keys(request.files).length > 0) {
    lines.push("    files = {");
    Object.entries(request.files).forEach(([key, value]) => {
      lines.push(`        ${pyString(key)}: open(${pyPipelineString(String(value))}, "rb"),`);
    });
    lines.push("    }");
    if (valueHasPipelinePlaceholder(request.files)) resolveVars.push("files");
    lines.push("");
  }

  if (request.auth?.user !== undefined) {
    lines.push(`    auth = (${pyPipelineString(request.auth.user)}, ${pyPipelineString(request.auth.password || "")})`);
    if (valueHasPipelinePlaceholder(request.auth)) resolveVars.push("auth");
    lines.push("");
  }

  if (hasProxy) {
    lines.push("    proxies = {");
    lines.push(`        "http": ${pyString(proxy.url.trim())},`);
    lines.push(`        "https": ${pyString(proxy.url.trim())},`);
    lines.push("    }");
    lines.push("");
  }

  resolveVars.forEach((name) => {
    lines.push(`    ${name} = resolve_pipeline_placeholders(${name}, pipeline_context)`);
  });
  if (resolveVars.length > 0) lines.push("");

  lines.push(`    response = requests.${method}(`);
  lines.push("        url,");
  if (hasParams) lines.push("        params=params,");
  if (hasHeaders) lines.push("        headers=headers,");
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
  lines.push("    return response");
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
    requests: options.contextRequests ?? [{ functionName: options.functionName, request: options.request }],
    targetFunctionName: options.functionName,
    proxy: options.proxy,
  });
}

export function buildCurlCraftScript({ requests, proxy, targetFunctionName }: BatchEnhanceOptions & { targetFunctionName?: string }): string {
  const renderedRequests = targetFunctionName
    ? requests.filter((entry) => entry.functionName === targetFunctionName)
    : requests;
  const hasPipeline = renderedRequests.some((entry) => requestUsesPipeline(entry.request));
  const code: string[] = [
    "import json",
    "import os",
    "from curl_cffi import requests",
  ];
  if (hasPipeline) code.push("from pipeline_utils import get_pipeline_value, resolve_pipeline_placeholders");
  code.push("");
  if (hasPipeline) {
    code.push(`DEFAULT_PIPELINE_CONTEXT = ${formatPythonValue(buildDefaultPipelineContext(requests), 4)}`);
    code.push("");
  }

  renderedRequests.forEach((entry) => {
    code.push(buildRequestFunction({ ...entry, proxy }));
    code.push("");
  });

  code.push(buildSaveResponseFunction());
  code.push("");
  code.push("def do_requests():");
  code.push("    pipeline_context = {}");
  renderedRequests.forEach((entry) => {
    const args = requestUsesPipeline(entry.request) ? "pipeline_context=DEFAULT_PIPELINE_CONTEXT" : "";
    code.push(`    ${entry.functionName}(${args})`);
  });
  code.push("");
  code.push('if __name__ == "__main__":');
  code.push("    do_requests()");
  code.push("");

  const generated = code.join("\n");
  assertNoUnresolvedPipelinePlaceholders(generated);
  return generated;
}

export function buildMergedScript({ requests, parserFunctionNames = [] }: BatchEnhanceOptions): string {
  const parserSet = new Set(parserFunctionNames);
  const code: string[] = [];

  requests.forEach((entry) => code.push(`from ${entry.functionName} import ${entry.functionName}`));
  requests.forEach((entry) => {
    const parserName = `${entry.functionName}_parser`;
    if (parserSet.has(parserName)) code.push(`from ${entry.functionName}_parser import ${parserName}`);
  });
  code.push("");
  code.push("def main():");
  code.push("    pipeline_context = {}");
  code.push("");
  requests.forEach((entry) => {
    const parserName = `${entry.functionName}_parser`;
    const args = requestUsesPipeline(entry.request) || (entry.code ? scriptNeedsPipelineContext(entry.code) : false) ? "pipeline_context=pipeline_context" : "";
    code.push(`    response_${entry.functionName} = ${entry.functionName}(${args})`);
    if (parserSet.has(parserName)) {
      code.push(`    pipeline_context[${pyString(entry.functionName)}] = ${parserName}(response_${entry.functionName})`);
    }
    code.push("");
  });
  code.push('if __name__ == "__main__":');
  code.push("    main()");
  return code.join("\n");
}

export function scriptUsesPipeline(code: string): boolean {
  return scriptNeedsPipelineContext(code) || code.includes("pipeline_utils");
}

export function scriptNeedsPipelineContext(code: string): boolean {
  return PIPELINE_PLACEHOLDER_PATTERN.test(code)
    || code.includes("get_pipeline_value(")
    || code.includes("resolve_pipeline_placeholders(");
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
