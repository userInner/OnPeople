use std::{
    env,
    fs::File,
    io::{self, BufRead, Read as IoRead, Write},
    path::{Path, PathBuf},
};

use base64::Engine;
use calamine::{Reader, open_workbook_auto};
use docx_rs::{Docx, Paragraph, Run, Table, TableCell, TableRow};
use lopdf::Document as PdfDocument;
use pptx_rs::{Inches, Presentation};
use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument as PrintPdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions,
    Point, Pt, TextItem,
};
use rust_xlsxwriter::Workbook;
use serde_json::{Map, Value, json};

const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServerKind {
    Artifacts,
    ImageGeneration,
    ComputerUse,
    ResearchSources,
}

impl ServerKind {
    fn from_arg(value: &str) -> Option<Self> {
        match value {
            "artifacts" | "workspace_artifacts" => Some(Self::Artifacts),
            "image-generation" | "image_generation" => Some(Self::ImageGeneration),
            "computer-use" | "computer_use" => Some(Self::ComputerUse),
            "research-sources" | "research_sources" => Some(Self::ResearchSources),
            _ => None,
        }
    }

    fn server_name(self) -> &'static str {
        match self {
            Self::Artifacts => "workspace_artifacts",
            Self::ImageGeneration => "image_generation",
            Self::ComputerUse => "computer_use",
            Self::ResearchSources => "research_sources",
        }
    }
}

fn main() {
    let kind = env::args()
        .nth(1)
        .and_then(|value| ServerKind::from_arg(&value));
    let Some(kind) = kind else {
        eprintln!(
            "usage: onpeople-mcp-host <artifacts|image-generation|computer-use|research-sources>"
        );
        std::process::exit(2);
    };

    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(error) => {
                write_response(
                    &mut stdout,
                    json_rpc_error(Value::Null, -32700, &format!("invalid JSON: {error}")),
                );
                continue;
            }
        };
        let response = handle_request(kind, &request);
        if response.get("id").is_some() {
            write_response(&mut stdout, response);
        }
    }
}

fn write_response(stdout: &mut impl Write, value: Value) {
    if serde_json::to_writer(&mut *stdout, &value).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn handle_request(kind: ServerKind, request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match method {
        "initialize" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": kind.server_name(), "version": env!("CARGO_PKG_VERSION") },
            }
        }),
        "notifications/initialized" | "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "tools/list" => {
            json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tool_definitions(kind) } })
        }
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call_tool(kind, name, &arguments) {
                Ok(content) => {
                    json!({ "jsonrpc": "2.0", "id": id, "result": { "content": content, "isError": false } })
                }
                Err(message) => {
                    json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": message }], "isError": true } })
                }
            }
        }
        _ => json_rpc_error(id, -32601, &format!("method not found: {method}")),
    }
}

fn tool_definitions(kind: ServerKind) -> Vec<Value> {
    match kind {
        ServerKind::Artifacts => vec![
            tool(
                "artifact_create_document",
                "Create a DOCX-compatible document artifact.",
                schema(&[
                    ("output", "string", true),
                    ("title", "string", false),
                    ("sections", "array", false),
                    ("tables", "array", false),
                ]),
            ),
            tool(
                "artifact_create_pdf",
                "Create a PDF artifact.",
                schema(&[
                    ("output", "string", true),
                    ("title", "string", false),
                    ("sections", "array", false),
                ]),
            ),
            tool(
                "artifact_create_spreadsheet",
                "Create an XLSX-compatible workbook artifact.",
                schema(&[("output", "string", true), ("sheets", "array", false)]),
            ),
            tool(
                "artifact_create_presentation",
                "Create a PPTX-compatible presentation artifact.",
                schema(&[
                    ("output", "string", true),
                    ("title", "string", false),
                    ("subtitle", "string", false),
                    ("slides", "array", false),
                ]),
            ),
            tool(
                "artifact_create_template",
                "Create a reusable artifact template.",
                schema(&[
                    ("output", "string", true),
                    ("kind", "string", true),
                    ("template", "object", true),
                ]),
            ),
            tool(
                "artifact_apply_template",
                "Apply a reusable artifact template.",
                schema(&[
                    ("template", "string", true),
                    ("output", "string", true),
                    ("values", "object", false),
                ]),
            ),
            tool(
                "artifact_create_site",
                "Create a standalone HTML site.",
                schema(&[
                    ("output", "string", true),
                    ("title", "string", false),
                    ("subtitle", "string", false),
                    ("sections", "array", false),
                    ("accent", "string", false),
                ]),
            ),
            tool(
                "artifact_create_visualization",
                "Create a standalone HTML visualization.",
                schema(&[
                    ("output", "string", true),
                    ("title", "string", false),
                    ("data", "array", false),
                    ("chartType", "string", false),
                ]),
            ),
            tool(
                "artifact_inspect",
                "Inspect an artifact without exposing secrets.",
                schema(&[
                    ("input", "string", true),
                    ("maxCharacters", "integer", false),
                ]),
            ),
        ],
        ServerKind::ImageGeneration => vec![tool(
            "image_generate",
            "Generate an image through the configured OnPeople image gateway.",
            schema(&[
                ("prompt", "string", true),
                ("output", "string", true),
                ("count", "integer", false),
                ("size", "string", false),
            ]),
        )],
        ServerKind::ComputerUse => vec![
            tool(
                "check_permissions",
                "Check native computer-use permissions.",
                schema(&[]),
            ),
            tool(
                "start_session",
                "Start a named native computer-use session.",
                schema(&[("name", "string", true)]),
            ),
            tool(
                "end_session",
                "End a native computer-use session.",
                schema(&[("sessionId", "string", true)]),
            ),
            tool(
                "get_session_state",
                "Read a native computer-use session.",
                schema(&[("sessionId", "string", true)]),
            ),
            tool(
                "get_accessibility_tree",
                "Read the accessibility tree for a session.",
                schema(&[("sessionId", "string", true)]),
            ),
            tool(
                "click",
                "Click a native UI coordinate.",
                schema(&[
                    ("sessionId", "string", true),
                    ("x", "number", true),
                    ("y", "number", true),
                ]),
            ),
            tool(
                "type_text",
                "Type text into the focused native control.",
                schema(&[("sessionId", "string", true), ("text", "string", true)]),
            ),
            tool(
                "press_key",
                "Press a native key.",
                schema(&[("sessionId", "string", true), ("key", "string", true)]),
            ),
            tool(
                "hotkey",
                "Press a native key chord.",
                schema(&[("sessionId", "string", true), ("keys", "array", true)]),
            ),
            tool(
                "scroll",
                "Scroll a native window.",
                schema(&[
                    ("sessionId", "string", true),
                    ("x", "number", false),
                    ("y", "number", false),
                ]),
            ),
        ],
        ServerKind::ResearchSources => vec![
            tool(
                "research_search",
                "Search a public source endpoint and return cited results.",
                schema(&[("query", "string", true), ("limit", "integer", false)]),
            ),
            tool(
                "research_fetch",
                "Fetch a public HTTPS source as sanitized text.",
                schema(&[("url", "string", true), ("maxCharacters", "integer", false)]),
            ),
            tool(
                "research_source_status",
                "Check the research source service status.",
                schema(&[]),
            ),
        ],
    }
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({ "name": name, "description": description, "inputSchema": input_schema })
}

fn schema(fields: &[(&str, &str, bool)]) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();
    for (name, kind, is_required) in fields {
        properties.insert((*name).to_owned(), json!({ "type": kind }));
        if *is_required {
            required.push(Value::String((*name).to_owned()));
        }
    }
    json!({ "type": "object", "properties": properties, "required": required, "additionalProperties": false })
}

fn call_tool(kind: ServerKind, name: &str, arguments: &Value) -> Result<Vec<Value>, String> {
    match kind {
        ServerKind::Artifacts => call_artifact(name, arguments),
        ServerKind::ImageGeneration => call_image_generation(name, arguments),
        ServerKind::ComputerUse => call_computer_use(name, arguments),
        ServerKind::ResearchSources => call_research(name, arguments),
    }
}

fn call_artifact(name: &str, args: &Value) -> Result<Vec<Value>, String> {
    let output = args.get("output").and_then(Value::as_str);
    if name != "artifact_inspect" && name != "artifact_apply_template" && output.is_none() {
        return Err("output is required".to_owned());
    }
    match name {
        "artifact_inspect" => inspect_artifact(args),
        "artifact_apply_template" => apply_template(args),
        "artifact_create_template" => create_template(args),
        "artifact_create_site" => create_site(args),
        "artifact_create_visualization" => create_visualization(args),
        "artifact_create_document" => create_document(args),
        "artifact_create_pdf" => create_pdf(args),
        "artifact_create_spreadsheet" => create_spreadsheet(args),
        "artifact_create_presentation" => create_presentation(args),
        _ => Err(format!("unknown artifact tool: {name}")),
    }
}

fn workspace_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let root = env::var_os("INTERNAL_AGENT_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let path = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    let parent = path
        .parent()
        .ok_or_else(|| "artifact path has no parent".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !parent.starts_with(&root) {
        return Err("artifact path is outside the active workspace".to_owned());
    }
    Ok(path)
}

fn create_document(args: &Value) -> Result<Vec<Value>, String> {
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("OnPeople artifact");
    let output = ensure_extension(output, "docx");
    let mut document =
        Docx::new().add_paragraph(Paragraph::new().add_run(Run::new().add_text(title)));
    for section in text_sections(args) {
        document = document.add_paragraph(Paragraph::new().add_run(Run::new().add_text(section)));
    }
    for table in args
        .get("tables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let rows = table
            .get("rows")
            .and_then(Value::as_array)
            .or_else(|| table.as_array())
            .cloned()
            .unwrap_or_default();
        let table_rows = rows
            .iter()
            .map(|row| {
                let cells = row.as_array().cloned().unwrap_or_else(|| vec![row.clone()]);
                TableRow::new(
                    cells
                        .iter()
                        .map(|cell| {
                            TableCell::new().add_paragraph(
                                Paragraph::new().add_run(Run::new().add_text(value_text(cell))),
                            )
                        })
                        .collect(),
                )
            })
            .collect::<Vec<_>>();
        if !table_rows.is_empty() {
            document = document.add_table(Table::new(table_rows));
        }
    }
    let file = File::create(&output).map_err(|error| error.to_string())?;
    document
        .build()
        .pack(file)
        .map_err(|error| error.to_string())?;
    verify_zip_package(&output, &["word/document.xml"])?;
    artifact_result(&output, "docx")
}

fn create_spreadsheet(args: &Value) -> Result<Vec<Value>, String> {
    let output = ensure_extension(
        workspace_path(
            args.get("output")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?,
        "xlsx",
    );
    let mut workbook = Workbook::new();
    let sheets = args
        .get("sheets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| vec![json!({ "name": "Sheet1", "rows": [] })]);
    for (sheet_index, sheet_value) in sheets.iter().enumerate() {
        let sheet = workbook.add_worksheet();
        let name = sheet_value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(if sheet_index == 0 { "Sheet1" } else { "Sheet" });
        sheet.set_name(name).map_err(|error| error.to_string())?;
        let rows = sheet_value
            .get("rows")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (row_index, row) in rows.iter().enumerate() {
            let cells = row.as_array().cloned().unwrap_or_else(|| vec![row.clone()]);
            for (column_index, cell) in cells.iter().enumerate() {
                let row_index = row_index as u32;
                let column_index = column_index as u16;
                match cell {
                    Value::Object(cell)
                        if cell.get("formula").and_then(Value::as_str).is_some() =>
                    {
                        sheet
                            .write_formula(
                                row_index,
                                column_index,
                                cell.get("formula")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default(),
                            )
                            .map_err(|error| error.to_string())?;
                    }
                    Value::Number(number) => {
                        sheet
                            .write_number(
                                row_index,
                                column_index,
                                number
                                    .as_f64()
                                    .ok_or_else(|| "invalid spreadsheet number".to_owned())?,
                            )
                            .map_err(|error| error.to_string())?;
                    }
                    Value::Bool(value) => {
                        sheet
                            .write_boolean(row_index, column_index, *value)
                            .map_err(|error| error.to_string())?;
                    }
                    Value::Null => {}
                    _ => {
                        sheet
                            .write_string(row_index, column_index, value_text(cell))
                            .map_err(|error| error.to_string())?;
                    }
                }
            }
        }
    }
    workbook.save(&output).map_err(|error| error.to_string())?;
    verify_zip_package(&output, &["xl/workbook.xml"])?;
    let readable = open_workbook_auto(&output).map_err(|error| error.to_string())?;
    if readable.sheet_names().is_empty() {
        return Err("generated spreadsheet contains no worksheets".to_owned());
    }
    artifact_result(&output, "xlsx")
}

fn create_pdf(args: &Value) -> Result<Vec<Value>, String> {
    let output = ensure_extension(
        workspace_path(
            args.get("output")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?,
        "pdf",
    );
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("OnPeople artifact");
    let mut operations = vec![
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(Mm(20.0), Mm(270.0)),
        },
        Op::SetFont {
            font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
            size: Pt(16.0),
        },
        Op::SetLineHeight { lh: Pt(20.0) },
        Op::ShowText {
            items: vec![TextItem::Text(title.to_owned())],
        },
        Op::AddLineBreak,
        Op::SetFont {
            font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
            size: Pt(11.0),
        },
        Op::SetLineHeight { lh: Pt(15.0) },
    ];
    for section in text_sections(args) {
        operations.push(Op::ShowText {
            items: vec![TextItem::Text(section)],
        });
        operations.push(Op::AddLineBreak);
    }
    operations.push(Op::EndTextSection);
    let page = PdfPage::new(Mm(210.0), Mm(297.0), operations);
    let mut document = PrintPdfDocument::new(title);
    document.with_pages(vec![page]);
    let bytes = document.save(&PdfSaveOptions::default(), &mut Vec::new());
    std::fs::write(&output, bytes).map_err(|error| error.to_string())?;
    PdfDocument::load(&output).map_err(|error| error.to_string())?;
    artifact_result(&output, "pdf")
}

fn create_presentation(args: &Value) -> Result<Vec<Value>, String> {
    let output = ensure_extension(
        workspace_path(
            args.get("output")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?,
        "pptx",
    );
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("OnPeople artifact");
    let subtitle = args
        .get("subtitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let slides = args
        .get("slides")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| vec![json!({ "title": title, "body": subtitle })]);
    let mut presentation = Presentation::new().map_err(|error| error.to_string())?;
    for slide_value in slides {
        let counter = presentation.id_counter();
        let slide = presentation
            .slides_mut()
            .add_slide(counter)
            .map_err(|error| error.to_string())?;
        let slide_title = slide_value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(title);
        let slide_body = slide_value
            .get("body")
            .or_else(|| slide_value.get("text"))
            .map(value_text)
            .unwrap_or_else(|| subtitle.to_owned());
        slide
            .shapes_mut()
            .add_textbox_with_text(
                Inches(0.7),
                Inches(0.6),
                Inches(11.0),
                Inches(0.8),
                slide_title,
            )
            .map_err(|error| error.to_string())?;
        slide
            .shapes_mut()
            .add_textbox_with_text(
                Inches(0.9),
                Inches(1.7),
                Inches(10.5),
                Inches(4.5),
                &slide_body,
            )
            .map_err(|error| error.to_string())?;
    }
    presentation
        .save(&output)
        .map_err(|error| error.to_string())?;
    verify_zip_package(&output, &["ppt/presentation.xml"])?;
    artifact_result(&output, "pptx")
}

fn text_sections(args: &Value) -> Vec<String> {
    args.get("sections")
        .and_then(Value::as_array)
        .map(|sections| sections.iter().map(value_text).collect())
        .unwrap_or_default()
}

fn value_text(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn artifact_result(output: &Path, format: &str) -> Result<Vec<Value>, String> {
    Ok(vec![text_content(
        json!({ "path": output, "format": format, "verified": true }).to_string(),
    )])
}

fn verify_zip_package(path: &Path, required_entries: &[&str]) -> Result<(), String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    for required in required_entries {
        archive
            .by_name(required)
            .map_err(|error| format!("generated package is missing {required}: {error}"))?;
    }
    Ok(())
}

fn create_template(args: &Value) -> Result<Vec<Value>, String> {
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let output = ensure_extension(output, "json");
    let kind = args
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("structured");
    let template = args.get("template").cloned().unwrap_or(Value::Null);
    let package = json!({ "version": 1, "kind": kind, "template": template });
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&package).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(vec![text_content(
        json!({ "path": output, "verified": true }).to_string(),
    )])
}

fn apply_template(args: &Value) -> Result<Vec<Value>, String> {
    let template = workspace_path(
        args.get("template")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let source = std::fs::read_to_string(&template).map_err(|error| error.to_string())?;
    let package: Value = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    let values = args
        .get("values")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let applied = apply_template_values(package.get("template").unwrap_or(&package), &values);
    let bytes = if matches!(
        output.extension().and_then(|value| value.to_str()),
        Some("txt" | "md" | "html" | "css" | "js")
    ) {
        value_text(&applied).into_bytes()
    } else {
        serde_json::to_vec_pretty(&applied).map_err(|error| error.to_string())?
    };
    std::fs::write(&output, bytes).map_err(|error| error.to_string())?;
    Ok(vec![text_content(
        json!({ "path": output, "verified": true, "appliedValues": values.len() }).to_string(),
    )])
}

fn apply_template_values(template: &Value, values: &Map<String, Value>) -> Value {
    match template {
        Value::String(text) => {
            for (key, value) in values {
                if text == &format!("{{{{{key}}}}}") {
                    return value.clone();
                }
            }
            let mut rendered = text.clone();
            for (key, value) in values {
                rendered = rendered.replace(&format!("{{{{{key}}}}}"), &value_text(value));
            }
            Value::String(rendered)
        }
        Value::Array(values_in_template) => Value::Array(
            values_in_template
                .iter()
                .map(|value| apply_template_values(value, values))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), apply_template_values(value, values)))
                .collect(),
        ),
        _ => template.clone(),
    }
}

fn create_site(args: &Value) -> Result<Vec<Value>, String> {
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("OnPeople");
    let subtitle = args
        .get("subtitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let accent = args
        .get("accent")
        .and_then(Value::as_str)
        .filter(|value| is_css_color(value))
        .unwrap_or("#2563eb");
    let sections = args
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut html = format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>:root{{--accent:{accent};color-scheme:light dark}}*{{box-sizing:border-box}}body{{margin:0;font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7f9;color:#18181b}}main{{width:min(920px,calc(100% - 40px));margin:64px auto}}header{{padding:48px;border:1px solid #e4e4e7;border-radius:28px;background:#fff;box-shadow:0 18px 50px #18181b0d}}h1{{margin:0;font-size:clamp(2rem,6vw,4.5rem);line-height:1.05;letter-spacing:-.045em}}header p{{max-width:680px;margin:22px 0 0;color:#71717a;font-size:1.15rem}}section{{margin-top:20px;padding:30px 34px;border:1px solid #e4e4e7;border-radius:22px;background:#fff}}h2{{margin:0 0 12px;font-size:1.35rem}}ul{{padding-left:1.25rem}}a{{color:var(--accent)}}@media(prefers-color-scheme:dark){{body{{background:#111;color:#fafafa}}header,section{{background:#18181b;border-color:#303036}}header p{{color:#a1a1aa}}}}</style></head><body><main><header><h1>{}</h1><p>{}</p></header>",
        html_escape(title),
        html_escape(title),
        html_escape(subtitle)
    );
    for section in sections {
        let heading = section
            .get("heading")
            .or_else(|| section.get("title"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let body = section
            .get("body")
            .or_else(|| section.get("text"))
            .and_then(Value::as_str)
            .or_else(|| section.as_str())
            .unwrap_or_default();
        html.push_str("<section>");
        if !heading.is_empty() {
            html.push_str(&format!("<h2>{}</h2>", html_escape(heading)));
        }
        if !body.is_empty() {
            html.push_str(&format!("<p>{}</p>", html_escape(body)));
        }
        if let Some(items) = section.get("items").and_then(Value::as_array) {
            html.push_str("<ul>");
            for item in items {
                html.push_str(&format!("<li>{}</li>", html_escape(&value_text(item))));
            }
            html.push_str("</ul>");
        }
        html.push_str("</section>");
    }
    html.push_str("</main></body></html>");
    let output = ensure_extension(output, "html");
    std::fs::write(&output, html).map_err(|error| error.to_string())?;
    Ok(vec![text_content(
        json!({ "path": output, "verified": true }).to_string(),
    )])
}

fn create_visualization(args: &Value) -> Result<Vec<Value>, String> {
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Visualization");
    let chart_type = args
        .get("chartType")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "bar" | "line" | "scatter"))
        .unwrap_or("bar");
    let data = serde_json::to_string(args.get("data").unwrap_or(&Value::Array(Vec::new())))
        .map_err(|error| error.to_string())?
        .replace('<', "\\u003c");
    let html = VISUALIZATION_SHELL
        .replace("__TITLE__", &html_escape(title))
        .replace("__CHART_TYPE__", chart_type)
        .replace("__DATA__", &data);
    let output = ensure_extension(output, "html");
    std::fs::write(&output, html).map_err(|error| error.to_string())?;
    Ok(vec![text_content(
        json!({ "path": output, "verified": true }).to_string(),
    )])
}

fn inspect_artifact(args: &Value) -> Result<Vec<Value>, String> {
    let path = workspace_path(
        args.get("input")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let max = args
        .get("maxCharacters")
        .and_then(Value::as_u64)
        .unwrap_or(20_000)
        .clamp(1_000, 100_000) as usize;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (preview, details) = match extension.as_str() {
        "docx" => (
            inspect_zip_xml(&path, |name| name == "word/document.xml", max)?,
            json!({ "kind": "document" }),
        ),
        "pptx" => (
            inspect_zip_xml(
                &path,
                |name| {
                    name.starts_with("ppt/slides/slide")
                        && Path::new(name)
                            .extension()
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("xml"))
                },
                max,
            )?,
            json!({ "kind": "presentation" }),
        ),
        "xlsx" | "xls" | "xlsb" | "ods" => inspect_spreadsheet(&path, max)?,
        "pdf" => inspect_pdf(&path, max)?,
        _ => {
            let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
            (
                truncate_chars(&String::from_utf8_lossy(&bytes), max),
                json!({ "kind": "text" }),
            )
        }
    };
    let truncated = preview.chars().count() >= max;
    Ok(vec![text_content(
        json!({
            "path": path,
            "bytes": metadata.len(),
            "format": extension,
            "preview": preview,
            "truncated": truncated,
            "details": details,
            "verified": true,
        })
        .to_string(),
    )])
}

fn inspect_spreadsheet(path: &Path, max: usize) -> Result<(String, Value), String> {
    let mut workbook = open_workbook_auto(path).map_err(|error| error.to_string())?;
    let names = workbook.sheet_names().to_vec();
    let mut preview = String::new();
    for name in &names {
        preview.push_str(&format!("# {name}\n"));
        let range = workbook
            .worksheet_range(name)
            .map_err(|error| error.to_string())?;
        for row in range.rows() {
            let line = row
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\t");
            preview.push_str(&line);
            preview.push('\n');
            if preview.chars().count() >= max {
                break;
            }
        }
        if preview.chars().count() >= max {
            break;
        }
    }
    Ok((
        truncate_chars(&preview, max),
        json!({ "kind": "spreadsheet", "sheets": names }),
    ))
}

fn inspect_pdf(path: &Path, max: usize) -> Result<(String, Value), String> {
    let document = PdfDocument::load(path).map_err(|error| error.to_string())?;
    let pages = document.get_pages().keys().copied().collect::<Vec<_>>();
    let preview = document
        .extract_text_with_limit(&pages, 8 * 1024 * 1024)
        .unwrap_or_default();
    Ok((
        truncate_chars(&preview, max),
        json!({ "kind": "pdf", "pages": pages.len(), "textExtracted": !preview.trim().is_empty() }),
    ))
}

fn inspect_zip_xml(
    path: &Path,
    include: impl Fn(&str) -> bool,
    max: usize,
) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut names = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|entry| entry.name().to_owned())
        })
        .filter(|name| include(name))
        .collect::<Vec<_>>();
    names.sort();
    let mut preview = String::new();
    for name in names {
        let mut entry = archive.by_name(&name).map_err(|error| error.to_string())?;
        let mut xml = String::new();
        entry
            .read_to_string(&mut xml)
            .map_err(|error| error.to_string())?;
        preview.push_str(&xml_visible_text(&xml));
        preview.push('\n');
        if preview.chars().count() >= max {
            break;
        }
    }
    Ok(truncate_chars(&preview, max))
}

fn xml_visible_text(xml: &str) -> String {
    let mut text = String::new();
    let mut inside_tag = false;
    for character in xml.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                text.push(' ');
            }
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn is_css_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value
            .chars()
            .skip(1)
            .all(|character| character.is_ascii_hexdigit())
}

const VISUALIZATION_SHELL: &str = r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#18181b;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
main{width:min(980px,calc(100% - 40px));margin:48px auto;padding:32px;border:1px solid #e4e4e7;border-radius:24px;background:#fff;box-shadow:0 18px 50px #18181b0d}
h1{margin:0 0 4px;font-size:28px;letter-spacing:-.025em}.meta{color:#71717a;margin-bottom:24px}svg{width:100%;height:auto;min-height:360px;overflow:visible}.axis{stroke:#d4d4d8}.mark{fill:#4b8efa;stroke:#4b8efa;transition:opacity .15s}.mark:hover{opacity:.72}.label{fill:#71717a;font-size:12px}
@media(prefers-color-scheme:dark){body{background:#111;color:#fafafa}main{background:#18181b;border-color:#303036}.axis{stroke:#3f3f46}.label,.meta{fill:#a1a1aa;color:#a1a1aa}}
</style></head><body><main><h1>__TITLE__</h1><div class="meta">__CHART_TYPE__ · OnPeople Visualize</div><svg id="chart" viewBox="0 0 900 440" role="img" aria-label="__TITLE__"></svg></main>
<script type="application/json" id="source">__DATA__</script><script>
const raw=JSON.parse(document.querySelector('#source').textContent);const type='__CHART_TYPE__';
const data=(Array.isArray(raw)?raw:[]).map((d,i)=>({label:String(d.label??d.name??i+1),value:Number(d.value??d.y??0),x:Number(d.x??i)})).filter(d=>Number.isFinite(d.value)&&Number.isFinite(d.x));
const svg=document.querySelector('#chart'),ns='http://www.w3.org/2000/svg',W=900,H=440,p={l:70,r:30,t:30,b:70};const max=Math.max(1,...data.map(d=>d.value)),min=Math.min(0,...data.map(d=>d.value));
const el=(n,a={})=>{const e=document.createElementNS(ns,n);Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v));return e};const add=(n,a,t)=>{const e=el(n,a);if(t!=null)e.textContent=t;svg.appendChild(e);return e};
add('line',{x1:p.l,y1:H-p.b,x2:W-p.r,y2:H-p.b,class:'axis'});add('line',{x1:p.l,y1:p.t,x2:p.l,y2:H-p.b,class:'axis'});
const y=v=>p.t+(max-v)/(max-min||1)*(H-p.t-p.b),step=(W-p.l-p.r)/Math.max(data.length,1);
if(type==='line'){const points=data.map((d,i)=>`${p.l+step*(i+.5)},${y(d.value)}`).join(' ');add('polyline',{points,fill:'none',stroke:'#4b8efa','stroke-width':3});data.forEach((d,i)=>{const c=add('circle',{cx:p.l+step*(i+.5),cy:y(d.value),r:6,class:'mark'});c.appendChild(el('title')).textContent=`${d.label}: ${d.value}`})}
else if(type==='scatter'){const xmin=Math.min(...data.map(d=>d.x),0),xmax=Math.max(...data.map(d=>d.x),1);data.forEach(d=>{const cx=p.l+(d.x-xmin)/(xmax-xmin||1)*(W-p.l-p.r),c=add('circle',{cx,cy:y(d.value),r:7,class:'mark'});c.appendChild(el('title')).textContent=`${d.label}: (${d.x}, ${d.value})`})}
else{data.forEach((d,i)=>{const x=p.l+step*i+step*.15,top=y(Math.max(d.value,0)),base=y(Math.min(d.value,0)),r=add('rect',{x,y:top,width:Math.max(2,step*.7),height:Math.max(1,base-top),rx:5,class:'mark'});r.appendChild(el('title')).textContent=`${d.label}: ${d.value}`})}
data.forEach((d,i)=>add('text',{x:p.l+step*(i+.5),y:H-p.b+24,'text-anchor':'middle',class:'label'},d.label.slice(0,14)));
</script></body></html>"#;

fn call_image_generation(name: &str, args: &Value) -> Result<Vec<Value>, String> {
    if name != "image_generate" {
        return Err(format!("unknown image tool: {name}"));
    }
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "prompt is required".to_owned())?;
    let output = workspace_path(
        args.get("output")
            .and_then(Value::as_str)
            .unwrap_or("generated-image.png"),
    )?;
    let count = args
        .get("count")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 4);
    let payload = json!({ "prompt": prompt, "count": count, "size": args.get("size").and_then(Value::as_str).unwrap_or("1024x1024") });
    if let Ok(value) = env::var("ONPEOPLE_IMAGE_GATEWAY_URL") {
        let response = reqwest::blocking::Client::new()
            .post(value)
            .json(&payload)
            .send()
            .map_err(|error| error.to_string())?;
        let value: Value = response.json().map_err(|error| error.to_string())?;
        let images = value
            .get("images")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| vec![value.clone()]);
        for (index, image) in images.iter().take(count as usize).enumerate() {
            let encoded = image
                .get("b64_json")
                .or_else(|| image.get("base64"))
                .or_else(|| image.get("data"))
                .and_then(Value::as_str)
                .ok_or_else(|| "image gateway response has no base64 image data".to_owned())?;
            let encoded = encoded
                .strip_prefix("data:image/png;base64,")
                .unwrap_or(encoded);
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| error.to_string())?;
            let target = image_output_path(&output, index, count);
            std::fs::write(&target, bytes).map_err(|error| error.to_string())?;
        }
        return Ok(vec![text_content(json!({ "output": output, "count": images.len().min(count as usize), "gatewayConfigured": true }).to_string())]);
    }
    Err("image generation gateway is not configured (set ONPEOPLE_IMAGE_GATEWAY_URL)".to_owned())
}

fn image_output_path(output: &Path, index: usize, count: u64) -> PathBuf {
    if count <= 1 {
        return output.to_owned();
    }
    let stem = output
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("generated-image");
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    output.with_file_name(format!("{stem}-{}.{}", index + 1, extension))
}

fn call_computer_use(name: &str, args: &Value) -> Result<Vec<Value>, String> {
    let command = env::var_os("CUA_DRIVER_PATH")
        .ok_or_else(|| "Cua Driver sidecar is not configured".to_owned())?;
    let mut child = std::process::Command::new(command);
    child
        .arg("mcp")
        .arg(name)
        .arg(serde_json::to_string(args).map_err(|error| error.to_string())?);
    let output = child.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(vec![text_content(
        String::from_utf8_lossy(&output.stdout).to_string(),
    )])
}

fn call_research(name: &str, args: &Value) -> Result<Vec<Value>, String> {
    match name {
        "research_source_status" => Ok(vec![text_content(
            json!({ "available": true, "transport": "reqwest" }).to_string(),
        )]),
        "research_fetch" => {
            let url = args
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "url is required".to_owned())?;
            let parsed = url::Url::parse(url).map_err(|_| "研究来源地址无效".to_owned())?;
            if parsed.scheme() != "https"
                || !matches!(
                    parsed.host_str(),
                    Some(
                        "api.crossref.org"
                            | "api.openalex.org"
                            | "api.datacite.org"
                            | "eutils.ncbi.nlm.nih.gov"
                            | "www.ebi.ac.uk"
                            | "export.arxiv.org"
                            | "dblp.org"
                            | "doaj.org"
                            | "zenodo.org"
                            | "api.osf.io"
                            | "api.ror.org"
                            | "clinicaltrials.gov"
                            | "doi.org"
                            | "arxiv.org"
                    )
                )
            {
                return Err("该地址不在公开研究来源范围内".to_owned());
            }
            let max = args
                .get("maxCharacters")
                .and_then(Value::as_u64)
                .unwrap_or(20_000)
                .clamp(1_000, 100_000) as usize;
            let response = reqwest::blocking::get(url)
                .map_err(|error| public_source_error(&error.to_string()))?
                .error_for_status()
                .map_err(|error| public_source_error(&error.to_string()))?;
            let text = response
                .text()
                .map_err(|error| public_source_error(&error.to_string()))?;
            Ok(vec![text_content(json!({ "url": url, "text": text.chars().take(max).collect::<String>(), "truncated": text.chars().count() > max }).to_string())])
        }
        "research_search" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .ok_or_else(|| "query is required".to_owned())?;
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 25) as usize;
            let value = search_public_research(query, limit)?;
            Ok(vec![text_content(
                serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?,
            )])
        }
        _ => Err(format!("unknown research tool: {name}")),
    }
}

fn search_public_research(query: &str, limit: usize) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("OnPeople-Research-Paper/1.0 (public metadata; no credentials)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let retrieved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default();
    let mut results = Vec::new();
    let mut sources = Vec::new();

    let crossref_url = url::Url::parse_with_params(
        "https://api.crossref.org/works",
        [("query", query), ("rows", &limit.to_string())],
    )
    .map_err(|error| error.to_string())?;
    let crossref = client
        .get(crossref_url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(|response| response.json::<Value>());
    match crossref {
        Ok(value) => {
            let items = value
                .get("message")
                .and_then(|message| message.get("items"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let count = items.len();
            results.extend(items.into_iter().map(|item| {
                let doi = item.get("DOI").and_then(Value::as_str);
                let title = item
                    .get("title")
                    .and_then(Value::as_array)
                    .and_then(|titles| titles.first())
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let authors = item
                    .get("author")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|author| {
                                let given = author.get("given").and_then(Value::as_str);
                                let family = author.get("family").and_then(Value::as_str);
                                match (given, family) {
                                    (Some(given), Some(family)) => Some(format!("{given} {family}")),
                                    (None, Some(family)) => Some(family.to_owned()),
                                    _ => None,
                                }
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let year = item
                    .get("published")
                    .and_then(|published| published.get("date-parts"))
                    .and_then(Value::as_array)
                    .and_then(|parts| parts.first())
                    .and_then(Value::as_array)
                    .and_then(|parts| parts.first())
                    .and_then(Value::as_i64);
                json!({
                    "source": "Crossref",
                    "sourceRecordUrl": item.get("URL").and_then(Value::as_str),
                    "retrievedAt": retrieved_at,
                    "evidenceLevel": "metadata-only",
                    "doi": doi,
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "venue": item.get("container-title").and_then(Value::as_array).and_then(|values| values.first()).and_then(Value::as_str),
                })
            }));
            sources.push(json!({ "source": "Crossref", "status": "ok", "resultCount": count }));
        }
        Err(error) => sources.push(
            json!({ "source": "Crossref", "status": "error", "message": public_source_error(&error.to_string()) }),
        ),
    }

    let openalex_url = url::Url::parse_with_params(
        "https://api.openalex.org/works",
        [("search", query), ("per-page", &limit.to_string())],
    )
    .map_err(|error| error.to_string())?;
    let openalex = client
        .get(openalex_url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(|response| response.json::<Value>());
    match openalex {
        Ok(value) => {
            let items = value
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let count = items.len();
            results.extend(items.into_iter().map(|item| {
                let authors = item
                    .get("authorships")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|author| {
                                author
                                    .get("author")
                                    .and_then(|author| author.get("display_name"))
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned)
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let full_text = item
                    .get("best_oa_location")
                    .and_then(|location| location.get("landing_page_url"))
                    .and_then(Value::as_str);
                json!({
                    "source": "OpenAlex",
                    "sourceRecordUrl": item.get("id").and_then(Value::as_str),
                    "retrievedAt": retrieved_at,
                    "evidenceLevel": if full_text.is_some() { "public-full-text-link" } else { "metadata-only" },
                    "doi": item.get("doi").and_then(Value::as_str),
                    "title": item.get("title").and_then(Value::as_str).unwrap_or_default(),
                    "authors": authors,
                    "year": item.get("publication_year").and_then(Value::as_i64),
                    "venue": item.get("primary_location").and_then(|location| location.get("source")).and_then(|source| source.get("display_name")).and_then(Value::as_str),
                    "fullTextUrl": full_text,
                    "citationCount": item.get("cited_by_count").and_then(Value::as_i64),
                })
            }));
            sources.push(json!({ "source": "OpenAlex", "status": "ok", "resultCount": count }));
        }
        Err(error) => sources.push(
            json!({ "source": "OpenAlex", "status": "error", "message": public_source_error(&error.to_string()) }),
        ),
    }

    if results.is_empty()
        && sources
            .iter()
            .all(|source| source.get("status").and_then(Value::as_str) == Some("error"))
    {
        return Err("公共研究来源暂时不可用".to_owned());
    }
    Ok(json!({
        "query": query,
        "resultCount": results.len(),
        "results": results,
        "sources": sources,
        "notice": "结果为公开来源的书目信息、摘要或全文链接；形成论断前仍需核对原文。",
    }))
}

fn public_source_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("503")
        || lower.contains("502")
    {
        "一个公共来源暂时繁忙，已继续使用其他来源"
    } else {
        "一个公共来源暂时不可用，已继续使用其他来源"
    }
}

fn text_content(text: String) -> Value {
    json!({ "type": "text", "text": text })
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension(extension);
    }
    path
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::{
        ServerKind, apply_template, create_document, create_site, create_spreadsheet,
        create_template, create_visualization, inspect_artifact, tool_definitions,
    };
    use serde_json::Value;

    #[test]
    fn artifact_tools_expose_all_bundled_productivity_capabilities() {
        let names = tool_definitions(ServerKind::Artifacts)
            .into_iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_owned))
            .collect::<Vec<_>>();
        for required in [
            "artifact_create_document",
            "artifact_create_pdf",
            "artifact_create_spreadsheet",
            "artifact_create_presentation",
            "artifact_create_template",
            "artifact_apply_template",
            "artifact_create_site",
            "artifact_create_visualization",
            "artifact_inspect",
        ] {
            assert!(
                names.iter().any(|name| name == required),
                "missing {required}"
            );
        }
    }

    #[test]
    fn document_spreadsheet_and_inspection_round_trip() {
        let current = std::env::current_dir().expect("current directory");
        let temporary = tempfile::Builder::new()
            .prefix("onpeople-artifact-test-")
            .tempdir_in(current)
            .expect("temporary workspace");
        let document = temporary.path().join("report.docx");
        create_document(&serde_json::json!({
            "output": document,
            "title": "Quarterly report",
            "sections": ["Alpha section", "Beta section"],
            "tables": [{"rows": [["Metric", "Value"], ["Users", 42]]}]
        }))
        .expect("create document");
        let inspection = inspect_artifact(&serde_json::json!({
            "input": temporary.path().join("report.docx")
        }))
        .expect("inspect document");
        assert!(
            inspection[0]["text"]
                .as_str()
                .unwrap_or_default()
                .contains("Alpha")
        );

        let workbook = temporary.path().join("metrics.xlsx");
        create_spreadsheet(&serde_json::json!({
            "output": workbook,
            "sheets": [{
                "name": "Metrics",
                "rows": [["Month", "Value"], ["Jan", 12], ["Total", {"formula": "=SUM(B2:B2)"}]]
            }]
        }))
        .expect("create spreadsheet");
        let inspection = inspect_artifact(&serde_json::json!({
            "input": temporary.path().join("metrics.xlsx")
        }))
        .expect("inspect spreadsheet");
        assert!(
            inspection[0]["text"]
                .as_str()
                .unwrap_or_default()
                .contains("Metrics")
        );
    }

    #[test]
    fn templates_sites_and_visualizations_are_applied_and_verified() {
        let current = std::env::current_dir().expect("current directory");
        let temporary = tempfile::Builder::new()
            .prefix("onpeople-plugin-test-")
            .tempdir_in(current)
            .expect("temporary workspace");
        let template = temporary.path().join("brief-template.json");
        create_template(&serde_json::json!({
            "output": template,
            "kind": "brief",
            "template": {"title": "{{title}}", "count": "{{count}}"}
        }))
        .expect("create template");
        let applied = temporary.path().join("brief.json");
        apply_template(&serde_json::json!({
            "template": temporary.path().join("brief-template.json"),
            "output": applied,
            "values": {"title": "Launch", "count": 3}
        }))
        .expect("apply template");
        let applied: Value = serde_json::from_slice(
            &std::fs::read(temporary.path().join("brief.json")).expect("applied template"),
        )
        .expect("applied JSON");
        assert_eq!(applied, serde_json::json!({"title": "Launch", "count": 3}));

        create_site(&serde_json::json!({
            "output": temporary.path().join("site.html"),
            "title": "Launch <Plan>",
            "sections": [{"heading": "Overview", "body": "Ready", "items": ["One", "Two"]}]
        }))
        .expect("create site");
        let site = std::fs::read_to_string(temporary.path().join("site.html")).expect("site");
        assert!(site.contains("Launch &lt;Plan&gt;"));
        assert!(site.contains("<li>One</li>"));

        create_visualization(&serde_json::json!({
            "output": temporary.path().join("chart.html"),
            "title": "Comparison",
            "chartType": "bar",
            "data": [{"label": "A", "value": 10}, {"label": "B", "value": 20}]
        }))
        .expect("create visualization");
        let chart = std::fs::read_to_string(temporary.path().join("chart.html")).expect("chart");
        assert!(chart.contains("OnPeople Visualize"));
        assert!(chart.contains("application/json"));
    }
}
