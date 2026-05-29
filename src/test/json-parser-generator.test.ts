import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateParserCode, getJsonLoopParentPath, getJsonLoopSourcePaths, getParserPathWarning, getValueByPath, parseJsonPath, preserveValidatedJsonSource } from "@/pages/Index";

function runGeneratedParser(code: string, payload: unknown) {
  const script = [
    code,
    "",
    "import json",
    `payload = ${JSON.stringify(JSON.stringify(payload))}`,
    "print(json.dumps(test_request_parser(json.loads(payload))))",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "curl2py-parser-test-"));
  try {
    const scriptPath = join(dir, "parser_test.py");
    writeFileSync(scriptPath, script, "utf8");
    const output = execFileSync("python", [scriptPath], { encoding: "utf8" });
    return JSON.parse(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("JSON parser generator", () => {
  it("returns root fields and loop rows as an object with a named array", () => {
    const payload = {
      response: {
        response: {
          numFoundExact: true,
          docs: [
            {
              id: "1",
              b_id: [101],
              b_bid_number: ["BID-101"],
              b_status: [1],
            },
            {
              id: "2",
              b_id: [102],
              b_bid_number: ["BID-102"],
              b_status: [1],
            },
          ],
        },
      },
    };
    const code = generateParserCode("test_request", [
      { path: "response.response.numFoundExact", outputKey: "num_found_exact" },
      { path: "response.response.docs[0].id", outputKey: "id" },
      { path: "response.response.docs[0].b_id[0]", outputKey: "b_id" },
      { path: "response.response.docs[0].b_bid_number[0]", outputKey: "b_bid_number" },
      { path: "response.response.docs[0].b_status", outputKey: "b_status" },
    ]);

    expect(code).toContain("result = {}");
    expect(code).toContain('result["docs"] = []');
    expect(code).toContain('result["num_found_exact"] = num_found_exact');
    expect(code).not.toContain("results = []");
    expect(runGeneratedParser(code, payload)).toEqual({
      num_found_exact: true,
      docs: [
        { id: "1", b_id: 101, b_bid_number: "BID-101", b_status: [1] },
        { id: "2", b_id: 102, b_bid_number: "BID-102", b_status: [1] },
      ],
    });
  });

  it("groups fields that share the same array parent into one row per item", () => {
    const payload = {
      response: {
        response: {
          docs: [
            {
              id: "1",
              b_id: [101],
              b_bid_number: ["BID-101"],
            },
            {
              id: "2",
              b_id: [102],
              b_bid_number: ["BID-102"],
            },
          ],
        },
      },
    };
    const code = generateParserCode("test_request", [
      { path: "response.response.docs[0].id", outputKey: "id" },
      { path: "response.response.docs[0].b_id[0]", outputKey: "b_id" },
      { path: "response.response.docs[0].b_bid_number[0]", outputKey: "b_bid_number" },
    ]);

    expect(getJsonLoopParentPath("response.response.docs[0].b_id[0]")).toBe("response.response.docs");
    expect(code).toContain('_get_value(data, ["response", "response", "docs"])');
    expect(code).toContain('"id": _get_value(item, ["id"])');
    expect(code).toContain('"b_id": _get_value(item, ["b_id", 0])');
    expect(code).not.toContain('row = {\n        "id"');
    expect(runGeneratedParser(code, payload)).toEqual({
      docs: [
        { id: "1", b_id: 101, b_bid_number: "BID-101" },
        { id: "2", b_id: 102, b_bid_number: "BID-102" },
      ],
    });
  });

  it("keeps array fields whole or indexed inside grouped rows", () => {
    const payload = {
      response: {
        response: {
          docs: [
            { id: "1", b_id: [101] },
          ],
        },
      },
    };
    const arrayCode = generateParserCode("test_request", [
      { path: "response.response.docs[0].id", outputKey: "id" },
      { path: "response.response.docs[0].b_id", outputKey: "b_id" },
    ]);
    const itemCode = generateParserCode("test_request", [
      { path: "response.response.docs[0].id", outputKey: "id" },
      { path: "response.response.docs[0].b_id[0]", outputKey: "b_id" },
    ]);

    expect(runGeneratedParser(arrayCode, payload)).toEqual({ docs: [{ id: "1", b_id: [101] }] });
    expect(runGeneratedParser(itemCode, payload)).toEqual({ docs: [{ id: "1", b_id: 101 }] });
  });

  it("validates and extracts final array index paths", () => {
    const payload = {
      response: {
        response: {
          docs: [
            {
              id: "9382948",
              b_id: [9382948],
              b_bid_number: ["GEM/2026/R/673215"],
            },
          ],
        },
      },
    };

    expect(parseJsonPath("response.response.docs[0].b_id[0]")).toEqual([
      "response",
      "response",
      "docs",
      0,
      "b_id",
      0,
    ]);

    [
      "response.response.docs",
      "response.response.docs[0]",
      "response.response.docs[0].b_id",
      "response.response.docs[0].b_id[0]",
      "response.response.docs[0].b_bid_number[0]",
    ].forEach((path) => expect(getParserPathWarning(path)).toBe(""));

    expect(Array.isArray(getValueByPath(payload, "response.response.docs"))).toBe(true);
    expect(getValueByPath(payload, "response.response.docs[0]")).toEqual(payload.response.response.docs[0]);
    expect(getValueByPath(payload, "response.response.docs[0].b_id")).toEqual([9382948]);
    expect(getValueByPath(payload, "response.response.docs[0].b_id[0]")).toBe(9382948);
    expect(getValueByPath(payload, "response.response.docs[0].b_bid_number[0]")).toBe("GEM/2026/R/673215");

    const code = generateParserCode("test_request", [
      { path: "response.response.docs", outputKey: "docs" },
      { path: "response.response.docs[0]", outputKey: "doc" },
      { path: "response.response.docs[0].b_id", outputKey: "b_id" },
      { path: "response.response.docs[0].b_id[0]", outputKey: "b_id_first" },
      { path: "response.response.docs[0].b_bid_number[0]", outputKey: "bid_number_first" },
    ]);

    expect(code).toContain('_get_value(item, ["b_id", 0])');
    expect(runGeneratedParser(code, payload)).toEqual({
      doc: payload.response.response.docs[0],
      docs: payload.response.response.docs,
      docs_2: [
        {
          b_id: [9382948],
          b_id_first: 9382948,
          bid_number_first: "GEM/2026/R/673215",
        },
      ],
    });
  });

  it("preserves pasted JSON array structure through source validation and parser output", () => {
    const source = `{
      "b_id": [9379993],
      "b_bid_number": ["GEM/2026/R/672917"],
      "nested": [{"x": [1, 2, 3]}]
    }`;
    const savedSource = preserveValidatedJsonSource(source);
    const parsed = JSON.parse(savedSource);
    const sourceView = JSON.stringify(parsed, null, 2);
    const code = generateParserCode("test_request", [
      { path: "b_id", outputKey: "b_id" },
      { path: "b_bid_number", outputKey: "b_bid_number" },
      { path: "nested[0].x", outputKey: "x" },
    ]);
    const output = runGeneratedParser(code, parsed);
    const outputJson = JSON.stringify(output, null, 2);

    expect(Array.isArray(parsed.b_id)).toBe(true);
    expect(parsed.b_id[0]).toBe(9379993);
    expect(Array.isArray(parsed.b_bid_number)).toBe(true);
    expect(Array.isArray(parsed.nested[0].x)).toBe(true);
    expect(sourceView).not.toMatch(/"b_id"\s*:\s*\{\s*"0"\s*:/);
    expect(output).toEqual({
      b_id: [9379993],
      b_bid_number: ["GEM/2026/R/672917"],
      x: [1, 2, 3],
    });
    expect(outputJson).not.toMatch(/"b_id"\s*:\s*\{\s*"0"\s*:/);
  });

  it("groups exact indexed paths by common array parent", () => {
    const payload = {
      data: {
        presentation: {
          stayProductDetailPage: {
            sections: {
              sections: [
                {
                  section: {
                    houseRulesSubtitle: "House rules",
                    houseRulesSections: [
                      {
                        title: "Checking in and out",
                        items: [
                          { title: "Check-in after 2:00 pm" },
                          { title: "Checkout before 10:00 am" },
                        ],
                      },
                    ],
                  },
                },
                {
                  section: {
                    houseRulesSubtitle: "Wrong section",
                    houseRulesSections: [
                      {
                        title: "Wrong group",
                        items: [
                          { title: "Wrong first item" },
                          { title: "Wrong second item" },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const code = generateParserCode("test_request", [
      { path: "data.presentation.stayProductDetailPage.sections.sections[0].section.houseRulesSubtitle", outputKey: "house_rules_subtitle" },
      { path: "data.presentation.stayProductDetailPage.sections.sections[0].section.houseRulesSections[0].title", outputKey: "check_in_check_out" },
      { path: "data.presentation.stayProductDetailPage.sections.sections[0].section.houseRulesSections[0].items[0].title", outputKey: "02_00" },
      { path: "data.presentation.stayProductDetailPage.sections.sections[0].section.houseRulesSections[0].items[1].title", outputKey: "10_00" },
    ]);

    expect(code).toContain('_get_value(data, ["data", "presentation", "stayProductDetailPage", "sections", "sections"])');
    expect(runGeneratedParser(code, payload)).toEqual({
      sections: [
        {
        house_rules_subtitle: "House rules",
        check_in_check_out: "Checking in and out",
        "02_00": "Check-in after 2:00 pm",
        "10_00": "Checkout before 10:00 am",
        },
        {
        house_rules_subtitle: "Wrong section",
        check_in_check_out: "Wrong group",
        "02_00": "Wrong first item",
        "10_00": "Wrong second item",
        },
      ],
    });
  });

  it("skips all-None rows for missing single paths and dedupes exact paths", () => {
    const code = generateParserCode("test_request", [
      { path: "items[0].title", outputKey: "first_title" },
      { path: "items[0].missing", outputKey: "missing" },
      { path: "items[0].title", outputKey: "duplicate_title" },
    ]);

    expect(runGeneratedParser(code, { items: [{ title: "First" }] })).toEqual({
      items: [{ first_title: "First" }],
    });
  });

  it("loops over the first array parent when selection mode is loop", () => {
    const payload = {
      groups: [
        { items: [{ title: "A" }, { title: "B" }] },
        { items: [{ title: "C" }] },
      ],
    };
    const singleCode = generateParserCode("test_request", [
      { path: "groups[0].items[0].title", outputKey: "title" },
    ]);
    const loopCode = generateParserCode("test_request", [
      { path: "groups[0].items[0].title", outputKey: "title", selectionMode: "loop" },
    ]);

    expect(runGeneratedParser(singleCode, payload)).toEqual({ title: "A" });
    expect(runGeneratedParser(loopCode, payload)).toEqual({ groups: [{ title: "A" }, { title: "C" }] });
  });

  it("detects every array parent in nested JSON paths", () => {
    expect(getJsonLoopSourcePaths("response.snippets[1].data.media_container.items[0].image.url")).toEqual([
      "response.snippets",
      "response.snippets[].data.media_container.items",
    ]);
    expect(getJsonLoopSourcePaths("response.snippets[1].data.variant_list[0].data.media_container.items[0].image.url")).toEqual([
      "response.snippets",
      "response.snippets[].data.variant_list",
      "response.snippets[].data.variant_list[].data.media_container.items",
    ]);
  });

  it("supports outer, inner, and nested loop selections while preserving fixed indexes", () => {
    const payload = {
      response: {
        snippets: [
          {
            tracking: { common_attributes: { product_id: "p1", name: "One", price: 10 } },
            data: { media_container: { items: [{ image: { url: "p1-a" } }, { image: { url: "p1-b" } }] } },
          },
          {
            tracking: { common_attributes: { product_id: "p2", name: "Two", price: 20 } },
            data: { media_container: { items: [{ image: { url: "p2-a" } }, { image: { url: "p2-b" } }] } },
          },
        ],
      },
    };
    const path = "response.snippets[1].data.media_container.items[0].image.url";

    // 1. single mode = exact fixed indexes only
    const singleCode = generateParserCode("test_request", [
      { path, outputKey: "image_url", selectionMode: "single" },
    ]);
    expect(runGeneratedParser(singleCode, payload)).toEqual({
      image_url: "p2-a"
    });

    // 2. loop snippets only = items[0] only (preserving other fixed indexes)
    const outerCode = generateParserCode("test_request", [
      { path, outputKey: "image_url", loopPaths: ["response.snippets"] },
    ]);
    expect(runGeneratedParser(outerCode, payload)).toEqual({
      snippets: [{ image_url: "p1-a" }, { image_url: "p2-a" }],
    });

    // 3. loop snippets + items = image_url array/list
    const nestedCode = generateParserCode("test_request", [
      { path: "response.snippets[1].tracking.common_attributes.product_id", outputKey: "product_id", loopPaths: ["response.snippets"] },
      { path: "response.snippets[1].tracking.common_attributes.name", outputKey: "name", loopPaths: ["response.snippets"] },
      { path: "response.snippets[1].tracking.common_attributes.price", outputKey: "price", loopPaths: ["response.snippets"] },
      { path, outputKey: "image_url", loopPaths: ["response.snippets", "response.snippets[].data.media_container.items"] },
    ]);
    expect(runGeneratedParser(nestedCode, payload)).toEqual({
      items: [
        { product_id: "p1", name: "One", price: 10, image_url: ["p1-a", "p1-b"] },
        { product_id: "p2", name: "Two", price: 20, image_url: ["p2-a", "p2-b"] },
      ],
    });
  });

  it("supports three levels of parent-child nested loop selections (snippets -> variant_list -> items)", () => {
    const payload = {
      response: {
        snippets: [
          {
            tracking: { common_attributes: { product_id: "p1", name: "One" } },
            data: {
              variant_list: [
                {
                  data: {
                    media_container: {
                      items: [
                        { image: { url: "p1-v1-a" } },
                        { image: { url: "p1-v1-b" } }
                      ]
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    };
    const path = "response.snippets[1].data.variant_list[0].data.media_container.items[0].image.url";
    const code = generateParserCode("test_request", [
      { path: "response.snippets[1].tracking.common_attributes.product_id", outputKey: "product_id", loopPaths: ["response.snippets"] },
      { path, outputKey: "image_url", loopPaths: ["response.snippets", "response.snippets[].data.variant_list", "response.snippets[].data.variant_list[].data.media_container.items"] },
    ]);
    expect(runGeneratedParser(code, payload)).toEqual({
      items: [
        { product_id: "p1", image_url: ["p1-v1-a", "p1-v1-b"] }
      ]
    });
  });

  it("does not group sibling/unrelated loops and generates separate flat outputs", () => {
    const payload = {
      products: [
        { product_id: "p1" },
        { product_id: "p2" },
      ],
      categories: [
        { cat_id: "c1" },
        { cat_id: "c2" },
      ]
    };
    const code = generateParserCode("test_request", [
      { path: "products[0].product_id", outputKey: "product_id", loopPaths: ["products"] },
      { path: "categories[0].cat_id", outputKey: "cat_id", loopPaths: ["categories"] },
    ]);
    expect(runGeneratedParser(code, payload)).toEqual({
      products: [
        { product_id: "p1" },
        { product_id: "p2" },
      ],
      categories: [
        { cat_id: "c1" },
        { cat_id: "c2" },
      ]
    });
  });

  it("handles large nested JSON without automatic broad loops", () => {
    const payload = {
      data: {
        sections: Array.from({ length: 500 }, (_, index) => ({
          items: Array.from({ length: 20 }, (_, itemIndex) => ({ title: `${index}:${itemIndex}` })),
        })),
      },
    };
    const code = generateParserCode("test_request", [
      { path: "data.sections[499].items[19].title", outputKey: "deep_title" },
    ]);

    expect(runGeneratedParser(code, payload)).toEqual({ deep_title: "499:19" });
  });
});
