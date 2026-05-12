import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateParserCode } from "@/pages/Index";

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
  it("preserves exact indexed paths by default", () => {
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

    expect(code).toContain('_get_value(data, ["data", "presentation", "stayProductDetailPage", "sections", "sections", 0');
    expect(code).not.toContain("for section in");
    expect(runGeneratedParser(code, payload)).toEqual([
      { house_rules_subtitle: "House rules" },
      { check_in_check_out: "Checking in and out" },
      { "02_00": "Check-in after 2:00 pm" },
      { "10_00": "Checkout before 10:00 am" },
    ]);
  });

  it("skips all-None rows for missing single paths and dedupes exact paths", () => {
    const code = generateParserCode("test_request", [
      { path: "items[0].title", outputKey: "first_title" },
      { path: "items[0].missing", outputKey: "missing" },
      { path: "items[0].title", outputKey: "duplicate_title" },
    ]);

    expect(runGeneratedParser(code, { items: [{ title: "First" }] })).toEqual([
      { first_title: "First" },
    ]);
  });

  it("loops only when selection mode is loop", () => {
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

    expect(runGeneratedParser(singleCode, payload)).toEqual([{ title: "A" }]);
    expect(runGeneratedParser(loopCode, payload)).toEqual([{ title: "A" }, { title: "B" }]);
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

    expect(runGeneratedParser(code, payload)).toEqual([{ deep_title: "499:19" }]);
  });
});
