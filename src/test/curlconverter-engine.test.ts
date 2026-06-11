import { describe, expect, it } from "vitest";
import { convertCurlLocally, CurlConverterError } from "@/services/curlConverterEngine";
import { buildMergedScript, enhanceCurlConverterPython, repairPythonPipelinePlaceholders } from "@/services/curlCraftEnhancer";

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
    expect(code).not.toContain("pipeline_utils");
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

  it("compiles parser output references through pipeline_context", () => {
    const request1 = convertCurlLocally("curl 'https://example.com/bootstrap'").request;
    const request2 = convertCurlLocally(
      "curl 'https://example.com/stores?lat={{request_1.coordinates[0]}}&lng={{request_1.coordinates[1]}}&store={request_1.store_id}' -H 'Authorization: Bearer {request_1.token}'"
    ).request;

    const code = enhanceCurlConverterPython("", {
      functionName: "request_2",
      request: request2,
    });
    expect(code).toContain("def request_2(pipeline_context=None):");
    expect(code).toContain('get_pipeline_value("request_1", ".coordinates[0]", pipeline_context)');
    expect(code).toContain('get_pipeline_value("request_1", ".coordinates[1]", pipeline_context)');
    expect(code).toContain('get_pipeline_value("request_1", ".store_id", pipeline_context)');
    expect(code).toContain('get_pipeline_value("request_1", ".token", pipeline_context)');
    expect(code).not.toContain("{{request_1.");
    expect(code).not.toContain("{request_1.");
    expect(code).toContain("if pipeline_context is None:");
    expect(code).toContain('raise ValueError("pipeline_context is required for request_2; standalone defaults are used only by do_requests()")');
    expect(code).toContain("request_2(pipeline_context=DEFAULT_PIPELINE_CONTEXT)");
    expect(code).toContain('"coordinates": [');
    expect(code).toContain("12.9716");
    expect(code).toContain('"store_id": "12345"');
    expect(code).toContain('"token": "abc123"');

    const merged = buildMergedScript({
      requests: [
        { functionName: "request_1", request: request1 },
        { functionName: "request_2", request: request2 },
      ],
      parserFunctionNames: ["request_1_parser"],
    });
    expect(merged).toContain("pipeline_context = {}");
    expect(merged).toContain("response_request_1 = request_1()");
    expect(merged).not.toContain("response_request_1 = request_1(pipeline_context=pipeline_context)");
    expect(merged).toContain("response_request_2 = request_2(pipeline_context=pipeline_context)");
    expect(merged).toContain('pipeline_context["request_1"] = request_1_parser(response_request_1)');
  });

  it("does not leave query placeholders in standalone request files", () => {
    const request1 = convertCurlLocally("curl 'https://example.com/bootstrap'").request;
    const request2 = convertCurlLocally("curl 'https://example.com/search?searchTerm={{request_1.suggestion_word}}'").request;

    const code = enhanceCurlConverterPython("", {
      functionName: "request_2",
      request: request2,
      contextRequests: [
        { functionName: "request_1", request: request1 },
        { functionName: "request_2", request: request2 },
      ],
    });

    expect(code).toContain('DEFAULT_PIPELINE_CONTEXT = {');
    expect(code).toContain('"suggestion_word": "mock_suggestion_word"');
    expect(code).toContain('"searchTerm": get_pipeline_value("request_1", ".suggestion_word", pipeline_context)');
    expect(code).toContain("params = resolve_pipeline_placeholders(params, pipeline_context)");
    expect(code).not.toContain("{{request_1.");
    expect(code).not.toContain("{request_1.");
  });

  it("repairs manually edited request.py files with raw pipeline placeholders", () => {
    const broken = `import json
import os
from curl_cffi import requests

def request_2():
    url = "https://www.nykaafashion.com/rest/appapi/V2/categories/products"
    params = {
        "searchTerm": "{{request_1.suggestion_word}}",
    }
    response = requests.get(
        url,
        params=params,
        impersonate="chrome",
        timeout=30,
    )
    return response

def do_requests():
    pipeline_context = {}
    request_2()
`;

    const repaired = repairPythonPipelinePlaceholders(broken);
    expect(repaired).toContain("from pipeline_utils import get_pipeline_value, resolve_pipeline_placeholders");
    expect(repaired).toContain("DEFAULT_PIPELINE_CONTEXT = {");
    expect(repaired).toContain("def request_2(pipeline_context=None):");
    expect(repaired).toContain("if pipeline_context is None:");
    expect(repaired).toContain('raise ValueError("pipeline_context is required for request_2; standalone defaults are used only by do_requests()")');
    expect(repaired).toContain('"searchTerm": get_pipeline_value("request_1", ".suggestion_word", pipeline_context)');
    expect(repaired).toContain("params = resolve_pipeline_placeholders(params, pipeline_context)");
    expect(repaired).toContain("request_2(pipeline_context=DEFAULT_PIPELINE_CONTEXT)");
    expect(repaired).not.toContain("{{request_1.suggestion_word}}");
  });

  it("preserves selected pipeline value types and merges standalone defaults", () => {
    const request2 = convertCurlLocally(
      "curl 'https://example.com/stores?lat={{request_1.lat|float}}&lng={{request_1.lng|float}}&pincode={{request_1.pincode|string}}&product={{request_1.product_id|int}}'"
    ).request;

    const code = enhanceCurlConverterPython("", {
      functionName: "request_2",
      request: request2,
    });

    expect(code).toContain('get_pipeline_value("request_1", ".lat", pipeline_context, "float")');
    expect(code).toContain('get_pipeline_value("request_1", ".lng", pipeline_context, "float")');
    expect(code).toContain('get_pipeline_value("request_1", ".pincode", pipeline_context, "string")');
    expect(code).toContain('get_pipeline_value("request_1", ".product_id", pipeline_context, "int")');
    expect(code).toContain('"lat": 12.9716');
    expect(code).toContain('"lng": 77.5946');
    expect(code).toContain('"pincode": "110001"');
    expect(code).toContain('"product_id": 12345');
  });

  it("merges real pipeline defaults from metadata for lat and lon together", () => {
    const repaired = repairPythonPipelinePlaceholders(`import json
from curl_cffi import requests
# curl2py-pipeline-defaults: {"info":{"lat":"28.413333","lon":"77.072833"}}

DEFAULT_PIPELINE_CONTEXT = {
    "info": {
        "lat": "mock_lat",
    },
}

def request_2(pipeline_context=None):
    params = {
        "lat": get_pipeline_value("info", ".lat", pipeline_context, "string"),
        "lng": "{{info.lon|string}}",
    }
    return params
`);

    expect(repaired).toContain('"lat": "28.413333"');
    expect(repaired).toContain('"lon": "77.072833"');
    expect(repaired).toContain('"lng": get_pipeline_value("info", ".lon", pipeline_context, "string")');
    expect(repaired).not.toContain("mock_lat");
    expect(repaired).not.toContain("mock_lon");
  });

  it("keeps 3+ real pipeline defaults with string int and float types", () => {
    const repaired = repairPythonPipelinePlaceholders(`from curl_cffi import requests
# curl2py-pipeline-defaults: {"info":{"lat":28.413333,"product_id":12345,"pincode":"110001"}}

def request_2():
    params = {
        "lat": "{{info.lat|float}}",
        "product": "{{info.product_id|int}}",
        "pin": "{{info.pincode|string}}",
    }
    return params
`);

    expect(repaired).toContain('"lat": 28.413333');
    expect(repaired).toContain('"product_id": 12345');
    expect(repaired).toContain('"pincode": "110001"');
    expect(repaired).toContain('get_pipeline_value("info", ".lat", pipeline_context, "float")');
    expect(repaired).toContain('get_pipeline_value("info", ".product_id", pipeline_context, "int")');
    expect(repaired).toContain('get_pipeline_value("info", ".pincode", pipeline_context, "string")');
  });

  it("preserves existing real defaults when rebuilding compiled pipeline context", () => {
    const repaired = repairPythonPipelinePlaceholders(`from curl_cffi import requests

DEFAULT_PIPELINE_CONTEXT = {
    "info": {
        "lat": "28.413333",
    },
}

def request_2(pipeline_context=None):
    params = {
        "lat": get_pipeline_value("info", ".lat", pipeline_context, "string"),
        "lng": "{{info.lon|string}}",
    }
    return params
`);

    expect(repaired).toContain('"lat": "28.413333"');
    expect(repaired).toContain('"lon": "mock_lon"');
    expect(repaired).not.toContain('"lat": "mock_lat"');
  });

  it("passes pipeline_context in merged script when edited request code depends on pipeline", () => {
    const request1 = convertCurlLocally("curl 'https://example.com/bootstrap'").request;
    const request2 = convertCurlLocally("curl 'https://example.com/products?searchTerm=placeholder'").request;
    const editedRequest2 = repairPythonPipelinePlaceholders(`def request_2():
    params = {
        "searchTerm": "{{request_1.suggestion_word}}",
    }
    return None
`);

    const merged = buildMergedScript({
      requests: [
        { functionName: "request_1", request: request1 },
        { functionName: "request_2", request: request2, code: editedRequest2 },
      ],
      parserFunctionNames: ["request_1_parser"],
    });

    expect(merged).toContain('pipeline_context["request_1"] = request_1_parser(response_request_1)');
    expect(merged).toContain("response_request_1 = request_1()");
    expect(merged).not.toContain("response_request_1 = request_1(pipeline_context=pipeline_context)");
    expect(merged).toContain("response_request_2 = request_2(pipeline_context=pipeline_context)");
  });
});
