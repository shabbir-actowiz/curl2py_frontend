import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonTreeNode } from "@/pages/Index";

describe("JSON tree renderer", () => {
  it("renders array items directly without object-style index keys", () => {
    const payload = {
      docs: [
        {
          id: "9376943",
          b_id: [9376943],
          b_bid_number: ["GEM/2026/R/672595"],
        },
      ],
    };

    const { container } = render(
      <JsonTreeNode
        value={payload}
        path={[]}
        onSelect={vi.fn()}
      />
    );
    const renderedText = container.textContent ?? "";

    expect(screen.getByText('"docs":')).toBeInTheDocument();
    expect(screen.getByText('"b_id":')).toBeInTheDocument();
    expect(screen.getByText("9376943")).toBeInTheDocument();
    expect(screen.getByText('"GEM/2026/R/672595"')).toBeInTheDocument();
    expect(renderedText).not.toContain('"0":');
  });
});
