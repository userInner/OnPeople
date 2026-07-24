const assert = require("node:assert/strict");
const vm = require("node:vm");
const { buildBrowserFillScript } = require("../src/browser-fill.cjs");

class FakeEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
class FakeInputEvent extends FakeEvent {}
class FakeInput {
  constructor() { this._value = ""; this.tagName = "INPUT"; this.disabled = false; this.events = []; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
  matches() { return true; } querySelector() { return null; } getAttribute() { return null; }
  scrollIntoView() {} focus() {} dispatchEvent(event) { this.events.push(event.type); return true; }
}
class FakeTextarea extends FakeInput { constructor() { super(); this.tagName = "TEXTAREA"; } }

function contextFor(element, execCommand = () => false) {
  return {
    CSS: { escape: (value) => value }, HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextarea,
    InputEvent: FakeInputEvent, Event: FakeEvent,
    document: {
      querySelector: () => element, createRange: () => ({ selectNodeContents() {} }), execCommand,
      createTextNode: (text) => ({ text }),
    },
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
}

const input = new FakeInput();
const inputResult = vm.runInNewContext(buildBrowserFillScript("ia-1", "hello"), contextFor(input));
assert.equal(input.value, "hello"); assert.equal(inputResult.editable, "input"); assert.deepEqual(input.events, ["input", "change"]);

const editor = {
  tagName: "DIV", disabled: false, isContentEditable: true, innerText: "", textContent: "", events: [],
  matches: () => true, querySelector: () => null, getAttribute: () => null, scrollIntoView() {}, focus() {},
  dispatchEvent(event) { this.events.push(event.type); return true; },
  replaceChildren(node) { this.innerText = node.text; this.textContent = node.text; },
};
const richText = "one\n\ntwo ' quoted";
const editorResult = vm.runInNewContext(buildBrowserFillScript("ia-4", richText), contextFor(editor));
assert.equal(editor.innerText, richText); assert.equal(editorResult.editable, "contenteditable"); assert.deepEqual(editor.events, ["input", "change"]);

console.log("browser fill checks passed");
