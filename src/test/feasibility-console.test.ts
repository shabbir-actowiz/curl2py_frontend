import { describe, expect, it } from "vitest";

import { getLogSeverity, metricClass } from "@/components/feasibility/console-severity";

describe("Feasibility console severity", () => {
  it("keeps healthy progress logs neutral when final failed is zero", () => {
    expect(
      getLogSeverity("[17:59:29] Direct Backend: stage progress 50/500; final success 50, retry recovered 0, final failed 0"),
    ).toBe("info");
  });

  it("marks failed stages red and successful stages green", () => {
    expect(getLogSeverity("Direct Backend: 50-worker stage failed: 8500/10000 success")).toBe("error");
    expect(getLogSeverity("Direct Backend: 20-worker stage passed: 4000/4000 success")).toBe("success");
  });

  it("colors metric values independently", () => {
    expect(metricClass("success", 50)).toBe("text-success");
    expect(metricClass("retry recovered", 2)).toBe("text-amber-400");
    expect(metricClass("final failed", 1)).toBe("text-destructive");
    expect(metricClass("final failed", 0)).toBe("text-muted-foreground");
  });
});
