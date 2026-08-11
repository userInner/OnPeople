use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{Datelike, Local, Timelike};
use onpeople_types::{AppError, ErrorCode};
use uuid::Uuid;

use onpeople_workspace::canonical_workspace;

const TASK_WORKSPACE_MODES: [&str; 3] = ["isolated", "local", "worktree"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedTaskWorkspace {
    pub cwd: PathBuf,
    pub mode: String,
    pub base_cwd: Option<PathBuf>,
    pub created: bool,
}

pub(crate) fn normalize_mode(mode: Option<&str>, cwd: Option<&str>) -> &'static str {
    if let Some(mode) = mode.map(str::trim)
        && TASK_WORKSPACE_MODES.contains(&mode)
    {
        return match mode {
            "local" => "local",
            "worktree" => "worktree",
            _ => "isolated",
        };
    }
    if cwd.is_some_and(|value| !value.trim().is_empty()) {
        "local"
    } else {
        "isolated"
    }
}

pub(crate) fn task_slug(value: &str) -> String {
    let mut source = value.trim().to_lowercase();
    let translations = [
        ("落地页", "landing-page"),
        ("工作空间", "workspace"),
        ("浏览器", "browser"),
        ("终端", "terminal"),
        ("登录", "login"),
        ("注册", "signup"),
        ("邮件", "email"),
        ("支付", "payment"),
        ("模型", "model"),
        ("图片", "image"),
        ("网站", "website"),
        ("设计", "design"),
        ("优化", "improve"),
        ("修复", "fix"),
        ("测试", "test"),
        ("任务", "task"),
        ("报告", "report"),
    ];
    let mut translated = Vec::new();
    for (term, replacement) in translations {
        if source.contains(term) {
            translated.push(replacement);
            source = source.replace(term, " ");
        }
    }
    let ascii_words = source
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();
    let mut words = translated;
    words.extend(ascii_words.split_whitespace());
    let mut slug = words.join("-");
    slug.truncate(42);
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "conversation".to_owned()
    } else {
        slug
    }
}

pub(crate) fn isolated_destination(root: &Path, prompt: &str, id: &str) -> PathBuf {
    let now = Local::now();
    let date = format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day());
    let time = format!("{:02}{:02}{:02}", now.hour(), now.minute(), now.second());
    let suffix = id
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>()
        .to_lowercase();
    root.join(date).join(format!(
        "{time}-{}-{}",
        task_slug(prompt),
        if suffix.is_empty() {
            "workspace"
        } else {
            &suffix
        }
    ))
}

pub(crate) fn materialize(
    mode: Option<&str>,
    cwd: Option<&str>,
    workspace_root: &Path,
    prompt: &str,
) -> Result<ResolvedTaskWorkspace, AppError> {
    match normalize_mode(mode, cwd) {
        "local" => {
            let cwd = canonical_workspace(Path::new(cwd.unwrap_or_default().trim()))
                .map_err(|error| error.context("workspaceMode", "local"))?;
            Ok(ResolvedTaskWorkspace {
                cwd: cwd.clone(),
                mode: "local".to_owned(),
                base_cwd: Some(cwd),
                created: false,
            })
        }
        "worktree" => Err(AppError::new(
            ErrorCode::Unsupported,
            "当前任务入口暂不支持直接创建 Worktree，请先选择项目后创建 Worktree",
        )),
        _ => {
            fs::create_dir_all(workspace_root).map_err(AppError::storage)?;
            let destination =
                isolated_destination(workspace_root, prompt, &Uuid::now_v7().to_string());
            fs::create_dir_all(
                destination
                    .parent()
                    .ok_or_else(|| AppError::internal("自动工作区目标缺少父目录"))?,
            )
            .map_err(AppError::storage)?;
            fs::create_dir(&destination).map_err(|error| {
                AppError::new(ErrorCode::Conflict, "无法创建自动工作区")
                    .context("path", destination.to_string_lossy())
                    .context("cause", error)
            })?;
            Ok(ResolvedTaskWorkspace {
                cwd: destination,
                mode: "isolated".to_owned(),
                base_cwd: None,
                created: true,
            })
        }
    }
}

pub(crate) fn remove_if_empty(workspace: &ResolvedTaskWorkspace) {
    if !workspace.created {
        return;
    }
    let _ = fs::remove_dir(&workspace.cwd);
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn defaults_to_isolated_without_a_cwd() {
        assert_eq!(normalize_mode(None, None), "isolated");
        assert_eq!(normalize_mode(None, Some("/tmp/project")), "local");
    }

    #[test]
    fn materializes_unique_isolated_workspace() {
        let root = tempdir().expect("workspace root");
        let first = materialize(None, None, root.path(), "重构登录页面").expect("first");
        let second = materialize(None, None, root.path(), "重构登录页面").expect("second");
        assert!(first.created);
        assert!(second.created);
        assert_ne!(first.cwd, second.cwd);
        assert!(first.cwd.starts_with(root.path()));
        assert_eq!(first.mode, "isolated");
    }

    #[test]
    fn local_workspace_is_not_created() {
        let root = tempdir().expect("workspace root");
        let selected = root.path().join("project");
        fs::create_dir(&selected).expect("project");
        let resolved = materialize(
            None,
            Some(selected.to_str().expect("utf8 path")),
            root.path().join("Workspaces").as_path(),
            "local",
        )
        .expect("local workspace");
        assert!(!resolved.created);
        assert_eq!(resolved.mode, "local");
        assert_eq!(
            resolved.cwd,
            selected.canonicalize().expect("canonical path")
        );
    }
}
