function fillBrowserElement(elementId, text) {
  const escaped = typeof CSS?.escape === "function" ? CSS.escape(String(elementId)) : String(elementId).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const snapshotElement = document.querySelector(`[data-internal-agent-id=${escaped}]`);
  if (!snapshotElement) throw new Error("Element is stale; take a new browser_snapshot.");
  const selector = 'input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]';
  const element = snapshotElement.matches(selector) ? snapshotElement : snapshotElement.querySelector(selector);
  if (!element) throw new Error("Element is not an editable field; take a new browser_snapshot.");
  if (element.disabled || element.getAttribute("aria-disabled") === "true") throw new Error("Element is disabled.");
  const value = String(text);
  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus();

  const dispatchInput = (inputType, data) => {
    let event;
    try { event = new InputEvent("input", { bubbles: true, composed: true, inputType, data }); }
    catch { event = new Event("input", { bubbles: true, composed: true }); }
    element.dispatchEvent(event);
  };

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    dispatchInput("insertText", value);
  } else {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges(); selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, value); } catch {}
    if (!inserted) {
      element.replaceChildren(document.createTextNode(value));
      dispatchInput("insertText", value);
    }
    selection.removeAllRanges();
  }
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  const actual = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : (element.innerText || element.textContent || "");
  return { filled: String(elementId), length: value.length, editable: element.isContentEditable ? "contenteditable" : element.tagName.toLowerCase(), actualLength: actual.length };
}

function buildBrowserFillScript(elementId, text) {
  return `(${fillBrowserElement.toString()})(${JSON.stringify(String(elementId))}, ${JSON.stringify(String(text))})`;
}

module.exports = { buildBrowserFillScript, fillBrowserElement };
