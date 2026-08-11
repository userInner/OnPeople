import { describe, expect, it } from "vitest";

import {
  matchingSlashCommands,
  slashCommands,
  slashQuery,
} from "./slashCommands";

describe("slash commands", () => {
  it("only activates for a single-line command token", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/review")).toBe("review");
    expect(slashQuery("hello /review")).toBeNull();
    expect(slashQuery("/review now")).toBeNull();
    expect(slashQuery("/review\nnext")).toBeNull();
  });

  it("prioritizes command-name prefixes", () => {
    const results = matchingSlashCommands("/m");
    expect(results[0]?.id).toBe("model");
    expect(results.map((command) => command.id)).toEqual(
      expect.arrayContaining(["model", "mcp"]),
    );
  });

  it("hides task-only commands before a task exists", () => {
    const ids = matchingSlashCommands("/", false).map((command) => command.id);
    expect(ids).not.toContain("compact");
    expect(ids).not.toContain("fork");
    expect(ids).not.toContain("archive");
    expect(ids).toContain("new");
  });

  it("keeps command identifiers unique", () => {
    const ids = slashCommands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
