use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use onpeople_types::{AppError, ErrorCode, WorktreeSummary};

use crate::{GitService, canonical_workspace};

#[derive(Debug, Clone, Default)]
pub struct WorktreeService {
    git: GitService,
}

impl WorktreeService {
    pub fn list(&self, cwd: &Path) -> Result<Vec<WorktreeSummary>, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let output = self
            .git
            .run(&cwd, &["worktree", "list", "--porcelain"], None)?;
        Ok(parse_worktree_porcelain(&output))
    }

    pub fn create(
        &self,
        cwd: &Path,
        destination: &Path,
        branch: &str,
    ) -> Result<WorktreeSummary, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let destination = safe_destination(&cwd, destination)?;
        validate_branch(branch)?;
        let destination_text = destination.to_string_lossy().into_owned();
        self.git.run(
            &cwd,
            &["worktree", "add", "-b", branch, &destination_text, "HEAD"],
            None,
        )?;
        self.list(&cwd)?
            .into_iter()
            .find(|worktree| Path::new(&worktree.path) == destination)
            .ok_or_else(|| AppError::internal("Git 未返回新 worktree"))
    }

    pub fn snapshot(&self, path: &Path, output: &Path) -> Result<PathBuf, AppError> {
        let path = canonical_workspace(path)?;
        let output = safe_snapshot_path(output)?;
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::storage)?;
        }
        let patch = self
            .git
            .run(&path, &["diff", "--binary", "--no-ext-diff", "HEAD"], None)?;
        let temporary = output.with_extension("patch.tmp");
        std::fs::write(&temporary, patch).map_err(AppError::storage)?;
        std::fs::rename(&temporary, &output).map_err(AppError::storage)?;
        Ok(output)
    }

    pub fn remove(&self, root: &Path, worktree: &Path) -> Result<(), AppError> {
        let root = canonical_workspace(root)?;
        let worktree = worktree.canonicalize().map_err(AppError::storage)?;
        let listed = self
            .list(&root)?
            .into_iter()
            .any(|item| Path::new(&item.path) == worktree);
        if !listed {
            return Err(AppError::new(
                ErrorCode::WorkspaceBoundary,
                "目标不是该仓库登记的 worktree",
            ));
        }
        let status = self.git.state(&worktree)?;
        if !status.files.is_empty() {
            return Err(AppError::new(
                ErrorCode::Conflict,
                "Worktree 有未保存变更，请先创建快照",
            ));
        }
        let worktree_text = worktree.to_string_lossy().into_owned();
        self.git
            .run(&root, &["worktree", "remove", "--", &worktree_text], None)?;
        Ok(())
    }

    pub fn handoff(&self, path: &Path) -> Result<(), AppError> {
        let path = canonical_workspace(path)?;
        let executable = std::env::current_exe().map_err(AppError::storage)?;
        Command::new(executable)
            .arg("--new-task")
            .arg("--workspace")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                AppError::new(ErrorCode::ProcessFailed, "无法打开 worktree 任务窗口")
                    .context("cause", error)
            })?;
        Ok(())
    }
}

fn parse_worktree_porcelain(value: &str) -> Vec<WorktreeSummary> {
    value
        .split("\n\n")
        .filter_map(|block| {
            let mut path = None;
            let mut head = String::new();
            let mut branch = None;
            let mut bare = false;
            let mut prunable = false;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    path = Some(value.to_owned());
                } else if let Some(value) = line.strip_prefix("HEAD ") {
                    head = value.to_owned();
                } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
                    branch = Some(value.to_owned());
                } else if line == "bare" {
                    bare = true;
                } else if line.starts_with("prunable") {
                    prunable = true;
                }
            }
            path.map(|path| WorktreeSummary {
                path,
                head,
                branch,
                bare,
                prunable,
            })
        })
        .collect()
}

fn safe_destination(root: &Path, destination: &Path) -> Result<PathBuf, AppError> {
    if destination.as_os_str().is_empty() || destination.exists() {
        return Err(AppError::invalid("Worktree 目标必须是尚不存在的目录"));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::invalid("Worktree 目标没有父目录"))?
        .canonicalize()
        .map_err(AppError::storage)?;
    let git_common = root
        .parent()
        .ok_or_else(|| AppError::invalid("仓库没有父目录"))?
        .canonicalize()
        .map_err(AppError::storage)?;
    if !parent.starts_with(&git_common) {
        return Err(AppError::new(
            ErrorCode::WorkspaceBoundary,
            "Worktree 必须位于仓库同级受控目录",
        ));
    }
    Ok(parent.join(
        destination
            .file_name()
            .ok_or_else(|| AppError::invalid("Worktree 目标无效"))?,
    ))
}

fn safe_snapshot_path(output: &Path) -> Result<PathBuf, AppError> {
    if output.extension().and_then(|value| value.to_str()) != Some("patch") {
        return Err(AppError::invalid("Worktree 快照必须使用 .patch 扩展名"));
    }
    Ok(output.to_path_buf())
}

fn validate_branch(value: &str) -> Result<(), AppError> {
    if value.starts_with("onpeople/")
        && value.len() <= 200
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-/".contains(character))
        && !value.contains("..")
    {
        Ok(())
    } else {
        Err(AppError::invalid("Worktree 分支必须使用 onpeople/* 命名"))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_worktree_porcelain;

    #[test]
    fn parses_worktrees() {
        let values = parse_worktree_porcelain(
            "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/w\nHEAD def\nbranch refs/heads/onpeople/task\n",
        );
        assert_eq!(values.len(), 2);
        assert_eq!(values[1].branch.as_deref(), Some("onpeople/task"));
    }
}
