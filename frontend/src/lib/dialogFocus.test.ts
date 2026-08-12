import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureDialogReturnFocus,
  focusableDialogElements,
  trapDialogTabKey,
} from "./dialogFocus";

describe("dialog focus contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("cycles Tab and Shift+Tab within the dialog", () => {
    document.body.innerHTML = `
      <div id="dialog"><button id="first">First</button><button disabled>Skip</button><input id="last" /></div>
    `;
    const dialog = document.getElementById("dialog")!;
    const first = document.getElementById("first")!;
    const last = document.getElementById("last")!;
    expect(focusableDialogElements(dialog)).toEqual([first, last]);

    last.focus();
    const forward = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    trapDialogTabKey(forward, dialog);
    expect(forward.preventDefault).toHaveBeenCalled();
    expect(first).toHaveFocus();

    const backward = { key: "Tab", shiftKey: true, preventDefault: vi.fn() };
    trapDialogTabKey(backward, dialog);
    expect(backward.preventDefault).toHaveBeenCalled();
    expect(last).toHaveFocus();
  });

  it("restores focus to the control that opened the dialog", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const restore = captureDialogReturnFocus();
    document.body.append(document.createElement("input"));
    (document.body.lastElementChild as HTMLElement).focus();

    restore();

    expect(trigger).toHaveFocus();
  });
});
