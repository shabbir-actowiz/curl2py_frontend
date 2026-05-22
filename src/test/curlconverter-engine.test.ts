import { describe, expect, it } from "vitest";
import { convertCurlLocally, CurlConverterError } from "@/services/curlConverterEngine";
import { enhanceCurlConverterPython } from "@/services/curlCraftEnhancer";

function generate(curl: string, functionName = "request_1") {
  const converted = convertCurlLocally(curl);
  return enhanceCurlConverterPython(converted.pythonCode, {
    functionName,
    request: converted.request,
  });
}

describe("frontend curlconverter pipeline", () => {
  it("converts simple GET locally", () => {
    const code = generate("curl 'https://example.com/api?q=milk'");
    expect(code).toContain("from curl_cffi import requests");
    expect(code).toContain("def request_1():");
    expect(code).toContain("response = requests.get(");
    expect(code).toContain('timeout=30');
  });

  it("converts POST JSON to json_data", () => {
    const code = generate(`curl 'https://example.com/api' -H 'content-type: application/json' --data '{"key":"value"}'`);
    expect(code).toContain("json_data = {");
    expect(code).toContain('"key": "value"');
    expect(code).toContain("json=json_data");
  });

  it("converts bash $ quoted JSON without backend help", () => {
    const code = generate(`curl 'https://example.com/api' -H 'content-type: application/json' --data-raw $'{"key":"value"}'`);
    expect(code).toContain("json_data = {");
    expect(code).not.toContain("$'{");
  });

  it("keeps GraphQL query compact as a single escaped string", () => {
    const code = generate(`curl 'https://example.com/graphql' -H 'content-type: application/json' --data-raw $'{"operationName":"getSearchProducts","variables":{"searchPayload":{"searchText":"64782","suggestedSearchText":"36135"},"cityId":16,"page":{"page":1,"limit":20}},"query":"query getSearchProducts {\\\\n  products {\\\\n    ...ProductDossierFragment\\\\n  }\\\\n}"}'`);
    expect(code).toContain('"searchText": "64782"');
    expect(code).toContain('"suggestedSearchText": "36135"');
    expect(code).toContain('"cityId": 16');
    expect(code).toContain('"limit": 20');
    expect(code).toContain(String.raw`"query": "query getSearchProducts {\n  products {\n    ...ProductDossierFragment\n  }\n}"`);
    expect(code).not.toContain('"""');
  });

  it("converts form-urlencoded and multiple -d values", () => {
    const code = generate(`curl 'https://example.com/form' -H 'content-type: application/x-www-form-urlencoded' -d 'a=1' -d 'b=2'`);
    expect(code).toContain("data = {");
    expect(code).toContain('"a": "1"');
    expect(code).toContain('"b": "2"');
    expect(code).toContain("data=data");
  });

  it("converts multipart form data", () => {
    const code = generate(`curl 'https://example.com/upload' -F 'name=test' -F 'file=@test.txt'`);
    expect(code).toContain("files = {");
    expect(code).toContain('open("test.txt", "rb")');
    expect(code).toContain("files=files");
  });

  it("keeps browser headers", () => {
    const code = generate(`curl 'https://example.com/api' -H 'accept: */*' -H 'user-agent: Mozilla/5.0' -H 'sec-fetch-site: same-origin'`);
    expect(code).toContain('"accept": "*/*"');
    expect(code).toContain('"user-agent": "Mozilla/5.0"');
    expect(code).toContain('"sec-fetch-site": "same-origin"');
  });

  it("throws a frontend conversion error for invalid cURL", () => {
    expect(() => convertCurlLocally("not a curl")).toThrow(CurlConverterError);
  });
});
