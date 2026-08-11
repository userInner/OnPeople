use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use onpeople_types::{AppError, ErrorCode, GitDiff, GitFileState, GitMutationRequest, GitState};

use crate::canonical_workspace;

const MAX_OUTPUT: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct GitService;

impl GitService {
    pub fn state(&self, cwd: &Path) -> Result<GitState, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let root = match self.run_optional(&cwd, &["rev-parse", "--show-toplevel"])? {
            Some(output) => PathBuf::from(output.trim()),
            None => {
                return Ok(GitState {
                    repository: false,
                    root: None,
                    branch: None,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    files: Vec::new(),
                });
            }
        };
        let status = self.run(
            &root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            None,
        )?;
        parse_status(&status, &root)
    }

    pub fn initialize(&self, cwd: &Path) -> Result<GitState, AppError> {
        let cwd = canonical_workspace(cwd)?;
        self.run(&cwd, &["init"], None)?;
        self.state(&cwd)
    }

    pub fn diff(&self, cwd: &Path, path: Option<&Path>) -> Result<GitDiff, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--binary"];
        let path_string;
        if let Some(path) = path {
            path_string = path.to_string_lossy().into_owned();
            args.push("--");
            args.push(&path_string);
        }
        let text = self.run(&cwd, &args, None)?;
        let truncated = text.len() >= MAX_OUTPUT;
        Ok(GitDiff {
            path: path.map(|path| path.to_string_lossy().into_owned()),
            text,
            truncated,
        })
    }

    pub fn mutate(&self, request: &GitMutationRequest) -> Result<GitState, AppError> {
        let cwd = canonical_workspace(Path::new(&request.cwd))?;
        let paths = request.paths.iter().map(String::as_str).collect::<Vec<_>>();
        match request.action.as_str() {
            "stage" => {
                let mut args = vec!["add", "--"];
                args.extend(paths);
                self.run(&cwd, &args, None)?;
            }
            "unstage" => {
                let mut args = vec!["restore", "--staged", "--"];
                args.extend(paths);
                self.run(&cwd, &args, None)?;
            }
            "discard" => {
                let mut args = vec!["restore", "--worktree", "--"];
                args.extend(paths);
                self.run(&cwd, &args, None)?;
            }
            "apply" => {
                let patch = request
                    .patch
                    .as_deref()
                    .ok_or_else(|| AppError::invalid("缺少 Git patch"))?;
                self.run(&cwd, &["apply", "--whitespace=nowarn", "-"], Some(patch))?;
            }
            _ => return Err(AppError::invalid("不支持的 Git 操作")),
        }
        self.state(&cwd)
    }

    pub fn commit(&self, cwd: &Path, message: &str) -> Result<GitState, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let message = normalize_commit_message(message)?;
        self.run(&cwd, &["commit", "--file=-"], Some(&message))?;
        self.state(&cwd)
    }

    pub fn push(&self, cwd: &Path, remote: Option<&str>) -> Result<GitState, AppError> {
        let cwd = canonical_workspace(cwd)?;
        let remote = remote.unwrap_or("origin");
        if !valid_ref_component(remote) {
            return Err(AppError::invalid("Git remote 名称无效"));
        }
        self.run(&cwd, &["push", remote, "HEAD"], None)?;
        self.state(&cwd)
    }

    pub fn run(&self, cwd: &Path, args: &[&str], stdin: Option<&str>) -> Result<String, AppError> {
        let mut command = Command::new("git");
        command
            .args(args)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().map_err(|error| {
            AppError::new(ErrorCode::ProcessFailed, "无法启动系统 Git").context("cause", error)
        })?;
        if let Some(input) = stdin {
            use std::io::Write;
            child
                .stdin
                .take()
                .ok_or_else(|| AppError::internal("git stdin unavailable"))?
                .write_all(input.as_bytes())
                .map_err(AppError::storage)?;
        }
        let output = child.wait_with_output().map_err(AppError::storage)?;
        let stdout = bounded_utf8(output.stdout);
        let stderr = bounded_utf8(output.stderr);
        if !output.status.success() {
            return Err(AppError::new(
                ErrorCode::ProcessFailed,
                stderr
                    .trim()
                    .to_owned()
                    .chars()
                    .take(2_000)
                    .collect::<String>(),
            )
            .context(
                "gitExitCode",
                output.status.code().unwrap_or(-1).to_string(),
            ));
        }
        Ok(stdout)
    }

    fn run_optional(&self, cwd: &Path, args: &[&str]) -> Result<Option<String>, AppError> {
        match self.run(cwd, args, None) {
            Ok(output) => Ok(Some(output)),
            Err(error) if error.code == ErrorCode::ProcessFailed => Ok(None),
            Err(error) => Err(error),
        }
    }
}

fn bounded_utf8(mut bytes: Vec<u8>) -> String {
    if bytes.len() > MAX_OUTPUT {
        bytes.truncate(MAX_OUTPUT);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn parse_status(value: &str, root: &Path) -> Result<GitState, AppError> {
    let mut records = value.split('\0');
    let header = records.next().unwrap_or_default();
    let branch = header
        .strip_prefix("## ")
        .and_then(|header| header.split("...").next())
        .map(str::trim)
        .filter(|branch| *branch != "HEAD (no branch)")
        .map(ToOwned::to_owned);
    let upstream = header
        .split_once("...")
        .map(|(_, value)| value.split(' ').next().unwrap_or_default().to_owned())
        .filter(|value| !value.is_empty());
    let ahead = parse_counter(header, "ahead ");
    let behind = parse_counter(header, "behind ");
    let mut files = Vec::new();
    for record in records.filter(|record| record.len() >= 3) {
        let bytes = record.as_bytes();
        let path = record[3..].to_owned();
        files.push(GitFileState {
            path,
            index_status: char::from(bytes[0]).to_string(),
            worktree_status: char::from(bytes[1]).to_string(),
            untracked: &record[..2] == "??",
        });
    }
    Ok(GitState {
        repository: true,
        root: Some(
            root.canonicalize()
                .map_err(AppError::storage)?
                .to_string_lossy()
                .into_owned(),
        ),
        branch,
        upstream,
        ahead,
        behind,
        files,
    })
}

fn parse_counter(header: &str, marker: &str) -> u32 {
    header
        .find(marker)
        .and_then(|start| {
            header[start + marker.len()..]
                .split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn normalize_commit_message(value: &str) -> Result<String, AppError> {
    let message = value.replace('\0', "").trim().to_owned();
    if message.is_empty() {
        return Err(AppError::invalid("提交消息不能为空"));
    }
    if message.len() > 20_000 {
        return Err(AppError::invalid("提交消息过长"));
    }
    Ok(format!("{message}\n"))
}

fn valid_ref_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-/".contains(character))
        && !value.contains("..")
        && !value.starts_with('-')
}

#[cfg(test)]
mod tests {
    use super::{normalize_commit_message, parse_status};

    #[test]
    fn parses_porcelain_status() {
        let state = parse_status(
            "## main...origin/main [ahead 2, behind 1]\0 M src/main.rs\0?? new.txt\0",
            ".".as_ref(),
        )
        .expect("status");
        assert_eq!(state.branch.as_deref(), Some("main"));
        assert_eq!(state.ahead, 2);
        assert_eq!(state.behind, 1);
        assert_eq!(state.files.len(), 2);
    }

    #[test]
    fn validates_commit_message() {
        assert!(normalize_commit_message("  ").is_err());
        assert_eq!(
            normalize_commit_message("feat: tauri").expect("message"),
            "feat: tauri\n"
        );
    }
}
