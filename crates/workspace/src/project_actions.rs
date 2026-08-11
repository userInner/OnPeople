use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
};

use onpeople_types::{AppError, ProjectAction};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::canonical_workspace;

const ALLOWED_PACKAGE_SCRIPTS: &[&str] =
    &["dev", "start", "test", "lint", "build", "check", "format"];

#[derive(Debug, Deserialize)]
struct ProjectActionsFile {
    #[serde(default)]
    setup: serde_json::Value,
    #[serde(default)]
    actions: Vec<ActionInput>,
}

#[derive(Debug, Deserialize)]
struct ActionInput {
    id: String,
    label: String,
    command: String,
}

pub fn discover_project_actions(cwd: &Path) -> Result<Vec<ProjectAction>, AppError> {
    let root = canonical_workspace(cwd)?;
    let mut actions = Vec::new();
    let mut seen = HashSet::new();
    let explicit_path = root.join(".onpeople").join("actions.json");
    if explicit_path.is_file() {
        let raw = fs::read_to_string(&explicit_path).map_err(AppError::storage)?;
        let manifest: ProjectActionsFile = serde_json::from_str(&raw).map_err(AppError::invalid)?;
        let setup = platform_setup_command(&manifest.setup);
        if let Some(command) = setup {
            push_action(
                &mut actions,
                &mut seen,
                ActionInput {
                    id: "setup".to_owned(),
                    label: "设置环境".to_owned(),
                    command,
                },
                ".onpeople/actions.json",
            )?;
        }
        for action in manifest.actions {
            push_action(&mut actions, &mut seen, action, ".onpeople/actions.json")?;
        }
    }

    let package_path = root.join("package.json");
    if package_path.is_file() {
        let raw = fs::read_to_string(package_path).map_err(AppError::storage)?;
        let package: serde_json::Value = serde_json::from_str(&raw).map_err(AppError::invalid)?;
        if let Some(scripts) = package.get("scripts").and_then(|value| {
            serde_json::from_value::<BTreeMap<String, String>>(value.clone()).ok()
        }) {
            for name in ALLOWED_PACKAGE_SCRIPTS {
                if scripts.contains_key(*name) {
                    push_action(
                        &mut actions,
                        &mut seen,
                        ActionInput {
                            id: (*name).to_owned(),
                            label: match *name {
                                "dev" => "开发",
                                "start" => "启动",
                                "test" => "测试",
                                "build" => "构建",
                                _ => name,
                            }
                            .to_owned(),
                            command: format!("npm run {name}"),
                        },
                        "package.json",
                    )?;
                }
            }
        }
    }
    Ok(actions)
}

fn push_action(
    actions: &mut Vec<ProjectAction>,
    seen: &mut HashSet<String>,
    input: ActionInput,
    source: &str,
) -> Result<(), AppError> {
    let id = clean_token(&input.id, 80)?;
    if !seen.insert(id.clone()) {
        return Ok(());
    }
    let label = clean_text(&input.label, 100)?;
    let command = bounded_command(&input.command)?;
    let fingerprint = hex::encode(Sha256::digest(
        format!("{id}\0{command}\0{source}").as_bytes(),
    ));
    actions.push(ProjectAction {
        id,
        label,
        command,
        source: source.to_owned(),
        fingerprint,
    });
    Ok(())
}

fn platform_setup_command(value: &serde_json::Value) -> Option<String> {
    if let Some(command) = value.as_str() {
        return Some(command.to_owned());
    }
    let object = value.as_object()?;
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "default"
    };
    object
        .get(platform)
        .or_else(|| object.get("default"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
}

fn bounded_command(value: &str) -> Result<String, AppError> {
    let command = value.replace('\0', "").trim().to_owned();
    if command.is_empty() || command.len() > 2_000 {
        return Err(AppError::invalid("项目动作命令为空或过长"));
    }
    Ok(command)
}

fn clean_text(value: &str, maximum: usize) -> Result<String, AppError> {
    let value = value.replace('\0', "").trim().to_owned();
    if value.is_empty() || value.len() > maximum {
        return Err(AppError::invalid("项目动作文本为空或过长"));
    }
    Ok(value)
}

fn clean_token(value: &str, maximum: usize) -> Result<String, AppError> {
    let value = clean_text(value, maximum)?;
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
    {
        Ok(value)
    } else {
        Err(AppError::invalid("项目动作 ID 无效"))
    }
}
