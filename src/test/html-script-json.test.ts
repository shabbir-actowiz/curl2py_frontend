import { describe, expect, it } from "vitest";
import { extractJsonSourcesFromHtml } from "@/pages/Index";

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
  });
});
