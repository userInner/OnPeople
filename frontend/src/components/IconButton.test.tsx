import { render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { describe, expect, it } from "vitest";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("exposes an accessible label and stable pressed state", () => {
    render(<IconButton icon={Settings} label="设置" active />);
    const button = screen.getByRole("button", { name: "设置" });
    expect(button).toHaveAttribute("title", "设置");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
