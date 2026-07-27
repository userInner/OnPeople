const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { resolveWorkspaceInput, resolveWorkspaceOutput } = require("./workspace-boundary.cjs");
// Document libraries load lazily inside each handler: this script is spawned as an
// MCP child per thread, so eager requires would delay initialize/tools/list and keep
// every format resident even when no artifact tool runs.
let pdfkitModule, exceljsModule, pptxgenModule, admZipModule, mammothModule, pdfParseModule, docxModule;
const getPdfDocument = () => (pdfkitModule ||= require("pdfkit"));
const getExcelJS = () => (exceljsModule ||= require("exceljs"));
const getPptxGenJS = () => (pptxgenModule ||= require("pptxgenjs"));
const getAdmZip = () => (admZipModule ||= require("adm-zip"));
const getMammoth = () => (mammothModule ||= require("mammoth"));
const getPdfParse = () => (pdfParseModule ||= require("pdf-parse"));
const getDocx = () => (docxModule ||= require("docx"));

const workspaceRoot = path.resolve(process.env.ONPEOPLE_WORKSPACE_ROOT || process.cwd());

function safeOutput(candidate, extension) {
  const requested = String(candidate || "").trim();
  if (!requested) throw new Error("output is required");
  const output = requested.toLowerCase().endsWith(extension) ? requested : `${requested}${extension}`;
  return resolveWorkspaceOutput(workspaceRoot, output);
}

function safeInput(candidate) {
  return resolveWorkspaceInput(workspaceRoot, candidate);
}

function sections(input = {}) {
  const values = Array.isArray(input.sections) ? input.sections : [];
  return values.slice(0, 200).map((section) => ({
    heading: String(section?.heading || "").slice(0, 300),
    text: String(section?.text || "").slice(0, 100_000),
    bullets: Array.isArray(section?.bullets) ? section.bullets.slice(0, 200).map((item) => String(item).slice(0, 2_000)) : [],
  }));
}

async function createDocument(input) {
  const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = getDocx();
  const output = safeOutput(input.output, ".docx");
  const children = [new Paragraph({ text: String(input.title || "Untitled document"), heading: HeadingLevel.TITLE })];
  for (const section of sections(input)) {
    if (section.heading) children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    for (const block of section.text.split(/\n\s*\n/).filter(Boolean)) children.push(new Paragraph({ children: [new TextRun(block)] }));
    for (const bullet of section.bullets) children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
  }
  for (const table of Array.isArray(input.tables) ? input.tables.slice(0, 30) : []) {
    const rows = Array.isArray(table.rows) ? table.rows.slice(0, 500) : [];
    if (rows.length) children.push(new Table({ rows: rows.map((row) => new TableRow({ children: (Array.isArray(row) ? row : []).slice(0, 30).map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ""))] })) })) }));
  }
  const document = new Document({ sections: [{ properties: {}, children }] });
  fs.writeFileSync(output, await Packer.toBuffer(document));
  return { output, format: "docx" };
}

function pdfFontCandidates() {
  const windowsRoot = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const packagedFont = process.resourcesPath
    ? path.join(process.resourcesPath, "assets", "fonts", "NotoSansCJKsc-Regular.otf")
    : null;
  return [
    process.env.ONPEOPLE_PDF_FONT
      ? { file: process.env.ONPEOPLE_PDF_FONT, face: process.env.ONPEOPLE_PDF_FONT_FACE || null, name: "Custom CJK font" }
      : null,
    packagedFont ? { file: packagedFont, name: "Noto Sans CJK SC" } : null,
    { file: "/System/Library/Fonts/Hiragino Sans GB.ttc", face: "HiraginoSansGB-W3", name: "Hiragino Sans GB" },
    { file: "/System/Library/Fonts/STHeiti Medium.ttc", face: "STHeitiSC-Medium", name: "Heiti SC" },
    { file: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", name: "Arial Unicode MS" },
    { file: path.join(windowsRoot, "Fonts", "msyh.ttc"), face: "MicrosoftYaHei", name: "Microsoft YaHei" },
    { file: path.join(windowsRoot, "Fonts", "msyh.ttc"), face: "MicrosoftYaHeiUI", name: "Microsoft YaHei UI" },
    { file: path.join(windowsRoot, "Fonts", "simhei.ttf"), name: "SimHei" },
    { file: path.join(windowsRoot, "Fonts", "simsun.ttc"), face: "SimSun", name: "SimSun" },
    { file: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", face: "NotoSansCJKsc-Regular", name: "Noto Sans CJK SC" },
    { file: "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", name: "Noto Sans CJK SC" },
    { file: "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", face: "WenQuanYiZenHei", name: "WenQuanYi Zen Hei" },
  ].filter(Boolean);
}

function pdfFont(document) {
  for (const candidate of pdfFontCandidates()) {
    if (!fs.existsSync(candidate.file)) continue;
    try {
      if (candidate.face) document.font(candidate.file, candidate.face);
      else document.font(candidate.file);
      return { ...candidate, supportsCjk: true };
    } catch {}
  }
  document.font("Helvetica");
  return { name: "Helvetica", supportsCjk: false };
}

function containsCjk(value) {
  return /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31bf\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(String(value || ""));
}

async function createPdf(input) {
  const output = safeOutput(input.output, ".pdf");
  const title = String(input.title || "Untitled document");
  const contentSections = sections(input);
  const needsCjk = containsCjk([
    title,
    ...contentSections.flatMap((section) => [section.heading, section.text, ...section.bullets]),
  ].join("\n"));
  let fontInfo = null;
  const PDFDocument = getPdfDocument();
  await new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 54, info: { Title: title || "OnPeople document" } });
    fontInfo = pdfFont(document);
    if (needsCjk && !fontInfo.supportsCjk) {
      document.end();
      reject(new Error("未找到可嵌入的中文字体。请安装 Microsoft YaHei、Hiragino Sans GB 或 Noto Sans CJK，或通过 ONPEOPLE_PDF_FONT 指定字体文件。"));
      return;
    }
    const stream = fs.createWriteStream(output, { mode: 0o600 });
    stream.on("finish", resolve); stream.on("error", reject); document.on("error", reject);
    document.pipe(stream);
    document.fontSize(22).fillColor("#20201e").text(title);
    document.moveDown(0.8);
    for (const section of contentSections) {
      if (section.heading) document.fontSize(15).fillColor("#20201e").text(section.heading).moveDown(0.35);
      if (section.text) document.fontSize(10.5).fillColor("#3f3f3b").text(section.text, { lineGap: 4 }).moveDown(0.7);
      for (const bullet of section.bullets) document.fontSize(10.5).text(`•  ${bullet}`, { indent: 8, lineGap: 3 });
      if (section.bullets.length) document.moveDown(0.6);
    }
    document.end();
  });
  return { output, format: "pdf", font: fontInfo.name, embeddedFont: fontInfo.supportsCjk };
}

async function createSpreadsheet(input) {
  const output = safeOutput(input.output, ".xlsx");
  const workbook = new (getExcelJS()).Workbook();
  workbook.creator = "OnPeople";
  const sheets = Array.isArray(input.sheets) && input.sheets.length ? input.sheets.slice(0, 50) : [{ name: "Sheet1", rows: [] }];
  for (const item of sheets) {
    const sheet = workbook.addWorksheet(String(item.name || "Sheet").slice(0, 31));
    const columns = Array.isArray(item.columns) ? item.columns.slice(0, 200).map((column) => ({ header: String(column.header || column.key || ""), key: String(column.key || column.header || "column"), width: Math.max(8, Math.min(60, Number(column.width) || 16)) })) : [];
    if (columns.length) sheet.columns = columns;
    for (const row of Array.isArray(item.rows) ? item.rows.slice(0, 50_000) : []) sheet.addRow(row);
    if (sheet.rowCount) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: "FF20201E" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F1ED" } };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, sheet.columnCount) } };
    }
  }
  await workbook.xlsx.writeFile(output);
  return { output, format: "xlsx", sheets: workbook.worksheets.length };
}

async function createPresentation(input) {
  const output = safeOutput(input.output, ".pptx");
  const PptxGenJS = getPptxGenJS();
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "OnPeople";
  presentation.subject = String(input.title || "OnPeople presentation");
  presentation.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "zh-CN" };
  const titleSlide = presentation.addSlide();
  titleSlide.background = { color: "F8F7F3" };
  titleSlide.addText(String(input.title || "Untitled presentation"), { x: 0.8, y: 2.35, w: 11.7, h: 0.8, fontFace: "Aptos Display", fontSize: 30, bold: true, color: "20201E", margin: 0 });
  if (input.subtitle) titleSlide.addText(String(input.subtitle), { x: 0.82, y: 3.2, w: 11, h: 0.5, fontSize: 14, color: "6D6D67", margin: 0 });
  for (const item of Array.isArray(input.slides) ? input.slides.slice(0, 100) : []) {
    const slide = presentation.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(String(item.title || ""), { x: 0.7, y: 0.55, w: 11.9, h: 0.55, fontSize: 24, bold: true, color: "20201E", margin: 0 });
    const bullets = Array.isArray(item.bullets) ? item.bullets.slice(0, 18) : [];
    if (bullets.length) slide.addText(bullets.map((bullet) => ({ text: String(bullet), options: { bullet: { indent: 18 }, breakLine: true } })), { x: 0.9, y: 1.45, w: 11.2, h: 5.2, fontSize: 18, color: "3F3F3B", breakLine: false, valign: "top", margin: 0.06 });
    else if (item.body) slide.addText(String(item.body), { x: 0.9, y: 1.45, w: 11.2, h: 5.2, fontSize: 18, color: "3F3F3B", valign: "top", margin: 0 });
    if (item.notes) slide.addNotes(String(item.notes));
  }
  await presentation.writeFile({ fileName: output });
  return { output, format: "pptx", slides: presentation._slides.length };
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function createSite(input) {
  const output = safeOutput(input.output || "site/index.html", ".html");
  const blocks = sections(input).map((section) => `<section><h2>${html(section.heading)}</h2><p>${html(section.text).replaceAll("\n", "<br>")}</p>${section.bullets.length ? `<ul>${section.bullets.map((item) => `<li>${html(item)}</li>`).join("")}</ul>` : ""}</section>`).join("\n");
  fs.writeFileSync(output, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(input.title || "OnPeople Site")}</title><style>:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20201e;background:#f7f6f2}*{box-sizing:border-box}body{margin:0}main{width:min(960px,calc(100% - 40px));margin:auto;padding:88px 0}header{padding-bottom:56px;border-bottom:1px solid #dcdad3}h1{max-width:800px;margin:0;font-size:clamp(44px,8vw,84px);line-height:.95;letter-spacing:-.055em}header p{max-width:640px;margin:24px 0 0;color:#6d6d67;font-size:18px;line-height:1.6}section{display:grid;grid-template-columns:minmax(180px,.55fr) 1fr;gap:40px;padding:42px 0;border-bottom:1px solid #dcdad3}h2{margin:0;font-size:24px}section p,li{margin-top:0;color:#484843;line-height:1.75}@media(max-width:640px){main{padding:48px 0}section{grid-template-columns:1fr;gap:12px}}</style></head><body><main><header><h1>${html(input.title || "OnPeople Site")}</h1><p>${html(input.subtitle || "")}</p></header>${blocks}</main></body></html>`);
  return { output, format: "html", previewUrl: `file://${output}` };
}

function createVisualization(input) {
  const output = safeOutput(input.output || "visualization.html", ".html");
  const data = (Array.isArray(input.data) ? input.data : []).slice(0, 100).map((item) => ({ label: String(item.label || ""), value: Number(item.value) || 0 }));
  const serialized = JSON.stringify(data).replaceAll("<", "\\u003c");
  fs.writeFileSync(output, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(input.title || "Visualization")}</title><style>body{margin:0;background:#f7f6f2;color:#20201e;font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(940px,calc(100% - 40px));margin:48px auto;padding:32px;border:1px solid #deddd8;border-radius:8px;background:#fff;box-shadow:0 18px 50px #2b2b2412}header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}h1{margin:0;font-size:30px}.controls{display:flex;gap:8px;flex-wrap:wrap}.controls input,.controls button{height:34px;border:1px solid #d6d5cf;border-radius:6px;background:#fff;color:#20201e;padding:0 10px;font:inherit}.controls button{cursor:pointer}.controls button:hover,.controls button:focus-visible{background:#f0efeb}.row{display:grid;grid-template-columns:150px 1fr 70px;align-items:center;gap:14px;padding:10px 0}.track{height:20px;border-radius:5px;background:#f0efeb;overflow:hidden}.track i{display:block;height:100%;border-radius:5px;background:#e76f3c;transition:width .18s ease}.row:hover .track i{background:#c95327}.row strong{text-align:right}.empty{color:#777771}@media(max-width:620px){.card{padding:20px}header{align-items:flex-start;flex-direction:column}.row{grid-template-columns:90px 1fr 50px}}</style></head><body><main class="card"><header><h1>${html(input.title || "Visualization")}</h1><div class="controls"><input id="filter" type="search" placeholder="筛选标签" aria-label="筛选标签"><button id="sort" type="button">数值降序</button><button id="reset" type="button">重置</button></div></header><div id="chart" aria-live="polite"></div></main><script>const source=${serialized};const chart=document.querySelector('#chart');const filter=document.querySelector('#filter');const sort=document.querySelector('#sort');let descending=true;const escapeHtml=value=>String(value).replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));function render(){const query=filter.value.trim().toLocaleLowerCase();const values=source.filter(item=>item.label.toLocaleLowerCase().includes(query)).sort((a,b)=>(b.value-a.value)*(descending?1:-1));const max=Math.max(1,...values.map(item=>Math.abs(item.value)));chart.innerHTML=values.length?values.map(item=>'<div class="row" title="'+escapeHtml(item.label)+': '+item.value+'"><span>'+escapeHtml(item.label)+'</span><div class="track"><i style="width:'+Math.max(1,Math.abs(item.value)/max*100)+'%"></i></div><strong>'+item.value+'</strong></div>').join(''):'<p class="empty">没有匹配的数据</p>';}filter.addEventListener('input',render);sort.addEventListener('click',()=>{descending=!descending;sort.textContent=descending?'数值降序':'数值升序';render()});document.querySelector('#reset').addEventListener('click',()=>{filter.value='';descending=true;sort.textContent='数值降序';render()});render();</script></body></html>`);
  return { output, format: "html", interactive: true, records: data.length, previewUrl: `file://${output}` };
}

function mergeTemplate(base, overrides) {
  if (Array.isArray(overrides)) return overrides.map((value) => mergeTemplate(undefined, value));
  if (!overrides || typeof overrides !== "object") return overrides === undefined ? base : overrides;
  const result = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (new Set(["__proto__", "prototype", "constructor"]).has(key)) continue;
    result[key] = mergeTemplate(result[key], value);
  }
  return result;
}

function createTemplate(input) {
  const kind = new Set(["document", "spreadsheet", "presentation", "site", "visualization"]).has(input.kind) ? input.kind : "document";
  const output = safeOutput(input.output || `templates/${kind}-template.json`, ".json");
  const presets = {
    document: { title: "文档标题", sections: [{ heading: "概述", text: "填写内容", bullets: [] }] },
    spreadsheet: { sheets: [{ name: "数据", columns: [{ header: "名称", key: "name" }, { header: "数值", key: "value" }], rows: [] }] },
    presentation: { title: "演示标题", subtitle: "副标题", slides: [{ title: "核心观点", bullets: ["第一点", "第二点"] }] },
    site: { title: "网站标题", subtitle: "一句清晰的价值主张", sections: [{ heading: "介绍", text: "填写内容" }] },
    visualization: { title: "数据可视化", data: [{ label: "示例", value: 1 }] },
  };
  const blueprint = mergeTemplate(presets[kind], input.template);
  fs.writeFileSync(output, `${JSON.stringify({ kind, ...blueprint }, null, 2)}\n`);
  return { output, kind, format: "json" };
}

async function applyTemplate(input) {
  const templatePath = safeInput(input.template);
  if (path.extname(templatePath).toLowerCase() !== ".json") throw new Error("template must be a JSON file");
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const kind = String(template.kind || "");
  const creators = {
    document: createDocument,
    spreadsheet: createSpreadsheet,
    presentation: createPresentation,
    site: createSite,
    visualization: createVisualization,
  };
  if (!creators[kind]) throw new Error(`unsupported template kind: ${kind || "unknown"}`);
  const values = mergeTemplate(template, input.values);
  delete values.kind;
  values.output = input.output;
  const result = await creators[kind](values);
  return { ...result, template: templatePath, kind };
}

function decodeXml(value) {
  return String(value).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function inspectArchiveSafety(target) {
  const AdmZip = getAdmZip();
  const archive = new AdmZip(target);
  const entries = archive.getEntries();
  if (entries.length > 10_000) throw new Error("artifact archive contains too many entries");
  let inflatedBytes = 0;
  for (const entry of entries) {
    const size = Number(entry.header?.size || 0);
    if (size > 64 * 1024 * 1024) throw new Error("artifact archive contains an oversized entry");
    inflatedBytes += size;
    if (inflatedBytes > 256 * 1024 * 1024) throw new Error("artifact archive expands beyond the 256 MB inspection limit");
  }
  return { archive, entries };
}

async function inspectArtifact(input) {
  const target = safeInput(input.input);
  const extension = path.extname(target).toLowerCase();
  const size = fs.statSync(target).size;
  if (size > 64 * 1024 * 1024) throw new Error("artifact exceeds the 64 MB inspection limit");
  const limit = Math.max(1_000, Math.min(100_000, Number(input.maxCharacters) || 30_000));
  let text = "";
  let metadata = {};
  const archiveSafety = new Set([".docx", ".xlsx", ".pptx"]).has(extension)
    ? inspectArchiveSafety(target)
    : null;
  if (extension === ".docx") {
    const result = await getMammoth().extractRawText({ path: target });
    text = result.value;
    metadata = { warnings: result.messages.length };
  } else if (extension === ".pdf") {
    const { PDFParse } = getPdfParse();
    const parser = new PDFParse({ data: fs.readFileSync(target) });
    try {
      const result = await parser.getText();
      text = result.text;
      metadata = { pages: result.total };
    } finally { await parser.destroy(); }
  } else if (extension === ".xlsx") {
    const workbook = new (getExcelJS()).Workbook();
    await workbook.xlsx.readFile(target);
    const summaries = [];
    for (const sheet of workbook.worksheets.slice(0, 50)) {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row, number) => { if (number <= 200) rows.push(row.values.slice(1)); });
      summaries.push({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, previewRows: rows });
    }
    text = JSON.stringify(summaries, null, 2);
    metadata = { sheets: workbook.worksheets.length };
  } else if (extension === ".pptx") {
    const { entries } = archiveSafety;
    const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    text = slides.map((entry, index) => {
      const xml = entry.getData().toString("utf8");
      const values = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1]));
      return `Slide ${index + 1}\n${values.join("\n")}`;
    }).join("\n\n");
    metadata = { slides: slides.length };
  } else if (new Set([".html", ".htm", ".json", ".md", ".txt", ".csv", ".tsv"]).has(extension)) {
    text = fs.readFileSync(target, "utf8");
  } else throw new Error(`unsupported artifact format: ${extension || "unknown"}`);
  return { input: target, format: extension.slice(1), size, metadata, text: text.slice(0, limit), truncated: text.length > limit };
}

const definitions = [
  ["artifact_create_document", "Create a DOCX document in the active workspace.", { output: { type: "string" }, title: { type: "string" }, sections: { type: "array" }, tables: { type: "array" } }],
  ["artifact_create_pdf", "Create a PDF document in the active workspace.", { output: { type: "string" }, title: { type: "string" }, sections: { type: "array" } }],
  ["artifact_create_spreadsheet", "Create an XLSX workbook in the active workspace.", { output: { type: "string" }, sheets: { type: "array" } }],
  ["artifact_create_presentation", "Create a PPTX presentation in the active workspace.", { output: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, slides: { type: "array" } }],
  ["artifact_create_template", "Create a reusable JSON template for an OnPeople artifact. Pass template to customize the reusable blueprint.", { output: { type: "string" }, kind: { type: "string", enum: ["document", "spreadsheet", "presentation", "site", "visualization"] }, template: { type: "object" } }],
  ["artifact_apply_template", "Apply a previously created JSON artifact template and produce a real DOCX, XLSX, PPTX, site, or visualization file.", { template: { type: "string" }, output: { type: "string" }, values: { type: "object" } }],
  ["artifact_create_site", "Create a responsive standalone website in the active workspace.", { output: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, sections: { type: "array" } }],
  ["artifact_create_visualization", "Create a responsive standalone HTML bar visualization.", { output: { type: "string" }, title: { type: "string" }, data: { type: "array" } }],
  ["artifact_inspect", "Read and verify text, metadata, and structure from DOCX, PDF, XLSX, PPTX, HTML, JSON, Markdown, or delimited-text artifacts in the active workspace.", { input: { type: "string" }, maxCharacters: { type: "integer", minimum: 1000, maximum: 100000 } }],
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: "object", properties, required: ["output"], additionalProperties: false } }));

definitions.find((tool) => tool.name === "artifact_inspect").inputSchema.required = ["input"];
definitions.find((tool) => tool.name === "artifact_apply_template").inputSchema.required = ["template", "output"];

const handlers = { artifact_create_document: createDocument, artifact_create_pdf: createPdf, artifact_create_spreadsheet: createSpreadsheet, artifact_create_presentation: createPresentation, artifact_create_template: createTemplate, artifact_apply_template: applyTemplate, artifact_create_site: createSite, artifact_create_visualization: createVisualization, artifact_inspect: inspectArtifact };

async function callTool(name, args) {
  if (!handlers[name]) throw new Error(`Unknown artifact tool: ${name}`);
  return handlers[name](args || {});
}

function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function handle(message) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  try {
    if (message.method === "initialize") return write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "onpeople-artifacts", version: "0.1.0" } } });
    if (message.method === "tools/list") return write({ jsonrpc: "2.0", id: message.id, result: { tools: definitions } });
    if (message.method === "tools/call") {
      const value = await callTool(message.params?.name, message.params?.arguments || {});
      return write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value } });
    }
    throw new Error(`Unsupported MCP method: ${message.method}`);
  } catch (error) { write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message || String(error) } }); }
}

if (require.main === module) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      void handle(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`Invalid MCP message: ${error.message}\n`);
    }
  });
}

module.exports = { applyTemplate, callTool, createDocument, createPdf, createPresentation, createSite, createSpreadsheet, createTemplate, createVisualization, definitions, inspectArtifact, mergeTemplate, safeInput, safeOutput };
