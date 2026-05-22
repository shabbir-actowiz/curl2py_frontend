import { describe, expect, it } from "vitest";
import { parseCurl, toPython } from "@/lib/curl-to-python";

const python = (curl: string) => toPython(parseCurl(curl), { client: "requests", async: false });

describe("curl-to-python conversion", () => {
  it("converts a simple GET curl", () => {
    const parsed = parseCurl("curl 'https://example.com/api?q=milk'");
    expect(parsed.error).toBeUndefined();
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://example.com/api?q=milk");
    expect(python("curl 'https://example.com/api?q=milk'")).toContain("response = requests.get(");
    expect(python("curl 'https://example.com/api?q=milk'")).toContain('timeout=30');
  });

  it("converts POST JSON curl using json=json_data", () => {
    const code = python(`curl 'https://example.com/api' -H 'content-type: application/json' --data '{"key":"value"}'`);
    expect(code).toContain("json_data = {");
    expect(code).toContain('"key": "value"');
    expect(code).toContain("json=json_data");
  });

  it("strips bash ANSI-C $ prefix from --data-raw JSON", () => {
    const code = python(`curl 'https://example.com/graphql' -H 'content-type: application/json' --data-raw $'{"operationName":"getSearchProducts","query":"query X {\\\\n id \\\\n}"}'`);
    expect(code).not.toContain("json_data = '$");
    expect(code).toContain('"operationName": "getSearchProducts"');
    expect(code).toContain("json=json_data");
  });

  it("normalizes GraphQL JSON payload escapes", () => {
    const code = python(`curl 'https://example.com/graphql' --data-raw $'{"query":"query X {\\\\n title\\\\u0021 \\\\n}"}'`);
    expect(code).toContain(String.raw`"query": "query X {\n title! \n}"`);
    expect(code).not.toContain('"""');
    expect(code).not.toContain("\\\\\\\\n");
  });

  it("converts form-urlencoded body", () => {
    const code = python(`curl 'https://example.com/form' -H 'content-type: application/x-www-form-urlencoded' -d 'a=1&b=two'`);
    expect(code).toContain("data = {");
    expect(code).toContain('"a": "1"');
    expect(code).toContain("data=data");
  });

  it("joins multiple -d values as form fields", () => {
    const code = python(`curl 'https://example.com/form' -d 'a=1' -d 'b=2'`);
    expect(code).toContain('"a": "1"');
    expect(code).toContain('"b": "2"');
  });

  it("handles body wrapped in single quotes", () => {
    const code = python(`curl 'https://example.com/api' --data-raw '{"single":"quote"}'`);
    expect(code).toContain('"single": "quote"');
    expect(code).toContain("json=json_data");
  });

  it("handles body wrapped in double quotes", () => {
    const code = python(`curl "https://example.com/api" --data-raw "{\\"double\\":\\"quote\\"}"`);
    expect(code).toContain('"double": "quote"');
    expect(code).toContain("json=json_data");
  });

  it("keeps explicit POST with no body bodyless", () => {
    const code = python(`curl 'https://example.com/api' -X POST`);
    expect(code).toContain("response = requests.post(");
    expect(code).not.toContain("data=");
    expect(code).not.toContain("json=");
  });

  it("falls back invalid JSON to data=payload without crashing", () => {
    const code = python(`curl 'https://example.com/api' -H 'content-type: application/json' --data-raw '{"bad":'`);
    expect(code).toContain('data = "{\\"bad\\":"');
    expect(code).toContain("data=data");
  });
});
