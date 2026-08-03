const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const artifacts = require("../src/artifact-mcp.cjs");
const { codexProviderName, imageGenerationCapability } = require("../src/provider-capabilities.cjs");

const artifactToolNames = new Set(artifacts.definitions.map((tool) => tool.name));
for (const name of [
  "artifact_create_document",
  "artifact_create_pdf",
  "artifact_create_spreadsheet",
  "artifact_create_presentation",
  "artifact_create_template",
  "artifact_apply_template",
  "artifact_create_site",
  "artifact_create_visualization",
  "artifact_inspect",
]) assert.equal(artifactToolNames.has(name), true, `${name} should be registered`);

const browserSource = fs.readFileSync(path.join(root, "src", "browser-mcp.cjs"), "utf8");
for (const name of ["browser_navigate", "browser_snapshot", "browser_visual_snapshot", "browser_click", "browser_fill", "browser_press_key", "browser_upload"]) {
  assert.match(browserSource, new RegExp(`name:\\s*["']${name}["']`), `${name} should be registered`);
}

assert.equal(imageGenerationCapability("openai", true).available, true);
assert.equal(imageGenerationCapability("compatible", true).available, true);
assert.equal(imageGenerationCapability("deepseek", true).available, false);
assert.equal(imageGenerationCapability("kimi", true).available, false);
assert.equal(imageGenerationCapability("minimax", true).available, false);
assert.equal(imageGenerationCapability("openai", false).available, false);
assert.equal(codexProviderName("openai", "openai", "OpenAI"), "OpenAI");
assert.equal(codexProviderName("onpeople", "openai", "OnPeople"), "OpenAI");
assert.equal(codexProviderName("onpeople", "grok", "OnPeople"), "OnPeople via OnPeople");

for (const dependency of ["docx", "pdfkit", "exceljs", "pptxgenjs", "mammoth", "pdf-parse", "adm-zip"]) {
  assert.doesNotThrow(() => require.resolve(dependency), `${dependency} should be a production dependency`);
}

const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
for (const capability of ["documents", "pdf", "spreadsheets", "presentations", "imagegen", "templates", "sites", "browser", "computer", "visualize", "default-templates"]) {
  assert.match(html, new RegExp(`data-capability=["']${capability}["']`));
  assert.equal(main.includes(`${capability}:`) || main.includes(`"${capability}":`), true, `${capability} should have a runtime instruction`);
}
assert.match(renderer, /capability:\s*selectedCapability/);
assert.match(main, /CAPABILITY_INSTRUCTIONS\[payload\.capability\]/);
assert.match(main, /imageGenerationCapability\(providerSettings\.type/);
assert.match(renderer, /computerButton\.disabled = !computerCapability\.available/);
assert.match(renderer, /selectToolView\("extensions"\)/);

console.log("embedded capability checks passed");
