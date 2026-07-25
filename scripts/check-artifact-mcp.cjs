const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-artifacts-test-"));
process.env.ONPEOPLE_WORKSPACE_ROOT = temporaryRoot;
const artifacts = require("../src/artifact-mcp.cjs");

async function run() {
  try {
    const sections = [{ heading: "概述", text: "OnPeople 产物测试。", bullets: ["本地", "可验证"] }];
    await artifacts.createDocument({ output: "report", title: "测试文档", sections });
    await artifacts.createPdf({ output: "report", title: "测试 PDF", sections });
    await artifacts.createSpreadsheet({ output: "data", sheets: [{ name: "数据", columns: [{ header: "名称", key: "name" }, { header: "数值", key: "value" }], rows: [{ name: "A", value: 1 }] }] });
    await artifacts.createPresentation({ output: "deck", title: "测试演示", slides: [{ title: "结论", bullets: ["已创建"] }] });
    artifacts.createTemplate({ output: "template", kind: "site", template: { title: "可复用站点", sections: [{ heading: "模板章节", text: "默认内容" }] } });
    await artifacts.applyTemplate({ template: "template.json", output: "from-template", values: { title: "套用后的站点" } });
    artifacts.createSite({ output: "site/index", title: "测试网站", sections });
    artifacts.createVisualization({ output: "chart", title: "测试图表", data: [{ label: "A", value: 10 }] });
    for (const file of ["report.docx", "report.pdf", "data.xlsx", "deck.pptx", "template.json", "from-template.html", "site/index.html", "chart.html"]) {
      const target = path.join(temporaryRoot, file);
      assert.ok(fs.existsSync(target), `${file} should exist`);
      assert.ok(fs.statSync(target).size > 20, `${file} should not be empty`);
    }
    const applied = await artifacts.inspectArtifact({ input: "from-template.html" });
    assert.match(applied.text, /套用后的站点/);
    const visualization = fs.readFileSync(path.join(temporaryRoot, "chart.html"), "utf8");
    assert.match(visualization, /id="filter"/);
    assert.match(visualization, /addEventListener\('input'/);
    assert.doesNotThrow(() => new Function(visualization.match(/<script>([\s\S]*?)<\/script>/)[1]));
    assert.equal((await artifacts.callTool("artifact_apply_template", { template: "template.json", output: "from-tool" })).kind, "site");
    for (const file of ["report.docx", "report.pdf", "data.xlsx", "deck.pptx", "site/index.html"]) {
      const inspected = await artifacts.inspectArtifact({ input: file });
      assert.equal(inspected.truncated, false);
      assert.ok(inspected.text.length > 0, `${file} should expose readable content`);
    }
    assert.throws(() => artifacts.safeOutput("../outside", ".txt"), /active workspace/);
    process.stdout.write("Artifact MCP checks passed.\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
