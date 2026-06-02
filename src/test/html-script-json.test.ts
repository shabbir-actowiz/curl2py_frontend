import { describe, expect, it } from "vitest";
import { extractJsonSourcesFromHtml, isPythonCodeFile } from "@/pages/Index";

describe("HTML script JSON extraction", () => {
  it("finds selectable JSON blocks inside script tags and ignores scripts without JSON", () => {
    const sources = extractJsonSourcesFromHtml(`
      <html>
        <body>
          <script>console.log("plain script");</script>
          <script type="application/json" id="page-data">
            {"title":"Example","items":[{"id":1},{"id":2}]}
          </script>
          <script>
            window.__STATE__ = {"user":{"name":"Ada"}};
          </script>
        </body>
      </html>
    `);

    expect(sources).toHaveLength(2);
    expect(sources[0].title).toContain("Script 2");
    expect(sources[0].title).toContain("#page-data");
    expect(JSON.parse(sources[0].json)).toEqual({
      title: "Example",
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(JSON.parse(sources[1].json)).toEqual({
      user: { name: "Ada" },
    });
    expect(sources[0].standaloneExtractorCode).toContain("SCRIPT_XPATH = \"//script[@id='page-data']/text()\"");
    expect(sources[0].standaloneExtractorCode).toContain("return json.loads(script)");
    expect(sources[1].standaloneExtractorCode).toContain('SCRIPT_XPATH = "(//script)[3]/text()"');
    expect(sources[1].standaloneExtractorCode).toContain("assignment = re.compile");
    expect(sources[1].standaloneExtractorCode).toContain("return json.loads(converted)");
    expect(sources[1].standaloneExtractorCode).toContain("Path(args.output).write_text");
  });
});

describe("generated extraction code file rendering", () => {
  it("detects Python output files by extension or content type", () => {
    expect(isPythonCodeFile("request_1_extract_json_2.py", "text/x-python")).toBe(true);
    expect(isPythonCodeFile("request_1_extract_json_2.py")).toBe(true);
    expect(isPythonCodeFile("generated.txt", "text/x-python")).toBe(true);
    expect(isPythonCodeFile("request_1_extracted_json_2.json", "application/json")).toBe(false);
  });
});
