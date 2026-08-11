use std::path::{Path, PathBuf};

use onpeople_types::{AppError, ErrorCode};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct DataPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub journal: PathBuf,
    pub migration_backup: PathBuf,
    pub browser_partition: PathBuf,
    pub cef_profile: PathBuf,
    pub codex_home: PathBuf,
    pub secrets_namespace: String,
}

impl DataPaths {
    pub fn from_root(root: PathBuf) -> Result<Self, AppError> {
        if root.as_os_str().is_empty() {
            return Err(AppError::new(ErrorCode::Storage, "OnPeople 数据目录为空"));
        }
        let root = root
            .canonicalize()
            .or_else(|_| {
                std::fs::create_dir_all(&root)?;
                root.canonicalize()
            })
            .map_err(AppError::storage)?;
        Ok(Self {
            database: root.join("onpeople.db"),
            journal: root.join("onpeople-migration.json"),
            migration_backup: root.join("migration-backups"),
            browser_partition: root.join("Partitions").join("internal-agent-browser"),
            cef_profile: root.join("cef-profile"),
            codex_home: root.join("codex-home"),
            secrets_namespace: secrets_namespace(&root),
            root,
        })
    }

    #[must_use]
    pub fn legacy_json(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    pub fn ensure_private(&self) -> Result<(), AppError> {
        std::fs::create_dir_all(&self.root).map_err(AppError::storage)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(AppError::storage)?;
        }
        Ok(())
    }

    #[must_use]
    pub fn is_inside_root(&self, path: &Path) -> bool {
        path.canonicalize()
            .map(|value| value.starts_with(&self.root))
            .unwrap_or(false)
    }
}

fn secrets_namespace(root: &Path) -> String {
    if std::env::var_os("ONPEOPLE_TEST_USER_DATA").is_none() {
        #[cfg(debug_assertions)]
        return "com.userinner.onpeople.dev".to_owned();
        #[cfg(not(debug_assertions))]
        return "com.userinner.onpeople".to_owned();
    }

    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("com.userinner.onpeople.preview.{}", &digest[..16])
}

pub fn stable_data_root() -> Result<PathBuf, AppError> {
    if let Some(override_root) = std::env::var_os("ONPEOPLE_TEST_USER_DATA") {
        return Ok(PathBuf::from(override_root));
    }
    let base = directories::BaseDirs::new()
        .ok_or_else(|| AppError::new(ErrorCode::Storage, "无法定位系统应用数据目录"))?;
    #[cfg(debug_assertions)]
    return Ok(base.data_dir().join("internal-agent-workbench-dev"));
    #[cfg(not(debug_assertions))]
    Ok(base.data_dir().join("internal-agent-workbench"))
}
