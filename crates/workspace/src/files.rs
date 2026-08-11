use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

use chrono::{DateTime, Utc};
use onpeople_types::{AppError, ErrorCode, FileEntry, FileSearchResult};
use walkdir::{DirEntry, WalkDir};

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "vendor",
];

pub fn canonical_workspace(path: &Path) -> Result<PathBuf, AppError> {
    let canonical = path.canonicalize().map_err(|error| {
        AppError::new(ErrorCode::NotFound, "工作区不存在")
            .context("path", path.to_string_lossy())
            .context("cause", error)
    })?;
    if !canonical.is_dir() {
        return Err(AppError::invalid("工作区必须是目录"));
    }
    Ok(canonical)
}

pub fn resolve_inside(root: &Path, input: &Path) -> Result<PathBuf, AppError> {
    let root = canonical_workspace(root)?;
    if input.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AppError::new(
            ErrorCode::WorkspaceBoundary,
            "路径超出当前工作区",
        ));
    }
    let joined = root.join(input);
    let canonical = if joined.exists() {
        joined.canonicalize().map_err(AppError::storage)?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| AppError::invalid("路径没有父目录"))?
            .canonicalize()
            .map_err(AppError::storage)?;
        parent.join(
            joined
                .file_name()
                .ok_or_else(|| AppError::invalid("路径没有文件名"))?,
        )
    };
    if !canonical.starts_with(&root) {
        return Err(AppError::new(
            ErrorCode::WorkspaceBoundary,
            "路径超出当前工作区",
        ));
    }
    Ok(canonical)
}

pub fn list_directory(root: &Path, relative: &Path) -> Result<Vec<FileEntry>, AppError> {
    let directory = resolve_inside(root, relative)?;
    if !directory.is_dir() {
        return Err(AppError::invalid("目标不是目录"));
    }
    let root = canonical_workspace(root)?;
    let mut entries = fs::read_dir(&directory)
        .map_err(AppError::storage)?
        .filter_map(Result::ok)
        .filter_map(|entry| file_entry(&root, entry.path()).ok())
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    entries.truncate(2_000);
    Ok(entries)
}

pub fn search_files(root: &Path, query: &str) -> Result<FileSearchResult, AppError> {
    let root = canonical_workspace(root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(FileSearchResult {
            entries: Vec::new(),
            truncated: false,
        });
    }
    if query.chars().count() > 200 {
        return Err(AppError::invalid("搜索词过长"));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .max_depth(20)
        .into_iter()
        .filter_entry(allowed_entry)
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let relative = entry
            .path()
            .strip_prefix(&root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_lowercase();
        if !relative.contains(&query) {
            continue;
        }
        if entries.len() == 500 {
            truncated = true;
            break;
        }
        if let Ok(item) = file_entry(&root, entry.path().to_path_buf()) {
            entries.push(item);
        }
    }
    entries.sort_by_key(|entry| {
        let lower = entry.path.to_lowercase();
        (
            !entry.name.to_lowercase().starts_with(&query),
            lower.len(),
            lower,
        )
    });
    Ok(FileSearchResult { entries, truncated })
}

fn allowed_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    if !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !IGNORED_DIRECTORIES.contains(&name.as_ref())
}

fn file_entry(root: &Path, path: PathBuf) -> Result<FileEntry, AppError> {
    let metadata = fs::symlink_metadata(&path).map_err(AppError::storage)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    let kind = if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "directory"
    } else {
        "file"
    };
    let modified_at = metadata.modified().ok().and_then(system_time_to_utc);
    Ok(FileEntry {
        hidden: name.starts_with('.'),
        name,
        path: path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned(),
        kind: kind.to_owned(),
        size: metadata.is_file().then_some(metadata.len()),
        modified_at,
    })
}

fn system_time_to_utc(value: SystemTime) -> Option<DateTime<Utc>> {
    Some(DateTime::<Utc>::from(value))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{list_directory, resolve_inside, search_files};

    #[test]
    fn enforces_workspace_boundary_and_searches() {
        let root = tempdir().expect("root");
        fs::write(root.path().join("README.md"), "hello").expect("write");
        assert!(resolve_inside(root.path(), "../outside".as_ref()).is_err());
        assert_eq!(
            list_directory(root.path(), "".as_ref())
                .expect("list")
                .len(),
            1
        );
        assert_eq!(
            search_files(root.path(), "read")
                .expect("search")
                .entries
                .len(),
            1
        );
    }
}
