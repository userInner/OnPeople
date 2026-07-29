"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("src/index.html");
const pet = read("src/pet.html");
const renderer = read("src/renderer.js");
const petRenderer = read("src/pet.js");
const controls = read("src/ui-controls.js");
const styles = read("src/ui-controls.css");

for (const html of [index, pet]) {
  assert.match(html, /ui-controls\.css/);
  assert.match(html, /ui-controls\.js/);
}
assert.doesNotMatch(renderer, /window\.(?:alert|confirm|prompt)\s*\(/);
assert.doesNotMatch(petRenderer, /window\.(?:alert|confirm|prompt)\s*\(/);
assert.match(renderer, /window\.OnPeopleUI\.confirm/);
assert.match(petRenderer, /window\.OnPeopleUI\.confirm/);
assert.match(renderer, /function closeCloudAccountManagement\(\)/);
assert.match(renderer, /if \(cloudAccountDialog\.open\) return/);
assert.match(renderer, /preserveSettings: true/);

assert.match(controls, /dialog\.showModal\(\)/);
assert.match(controls, /new MutationObserver/);
assert.match(controls, /select:not\(\[multiple\]\)/);
assert.match(controls, /dispatchEvent\(new Event\("change"/);
assert.match(controls, /event\.key === "Escape"/);
assert.match(controls, /"ArrowDown"/);
assert.match(controls, /returnFocus/);
assert.match(controls, /window\.OnPeopleUI/);

assert.match(styles, /\.op-dialog::backdrop/);
assert.match(styles, /\.op-select-popover/);
assert.match(styles, /\.permission-control \.op-select-trigger/);
assert.match(styles, /prefers-reduced-motion/);

console.log("Custom UI control checks passed.");
