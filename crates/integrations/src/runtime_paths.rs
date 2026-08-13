use std::{
    io::Read,
    path::{Path, PathBuf},
};

use onpeople_types::{AppError, ErrorCode};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct RuntimeComponent {
    pub name: &'static str,
    pub path: PathBuf,
    pub bundled: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    root: PathBuf,
    allow_env_overrides: bool,
}

impl RuntimePaths {
    /// Strict resolution for desktop hosts: environment-variable binary
    /// overrides (`CODEX_BIN`, `CUA_DRIVER_PATH`, …) bypass manifest hash
    /// verification by design, so they are honored only in debug builds.
    /// Release desktop builds ignore them loudly instead of silently
    /// redirecting sidecars to unverified executables.
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            allow_env_overrides: cfg!(debug_assertions),
        }
    }

    /// CLI-style hosts trust their invoking environment by design (their
    /// runtime root is itself an env/argv knob), so they may opt in to
    /// honoring binary overrides in release builds as well.
    #[must_use]
    pub fn with_env_overrides(root: PathBuf) -> Self {
        Self {
            root,
            allow_env_overrides: true,
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn codex(&self) -> Result<RuntimeComponent, AppError> {
        self.resolve(
            "codex",
            "CODEX_BIN",
            if cfg!(windows) { "codex.exe" } else { "codex" },
        )
    }

    /// Resolves the bundled Codex path without reading the executable.
    ///
    /// Desktop hosts use this only to construct their lightweight startup
    /// state. The full manifest/hash verification is performed immediately
    /// before the App Server is spawned by `CoreRuntime::start_once`, so a
    /// cold desktop connection does not block on hashing the 258 MiB sidecar.
    /// All other public component accessors retain eager verification.
    pub fn codex_startup_path(&self) -> Result<RuntimeComponent, AppError> {
        self.resolve_unverified(
            "codex",
            "CODEX_BIN",
            if cfg!(windows) { "codex.exe" } else { "codex" },
        )
    }

    pub fn cua_driver(&self) -> Result<RuntimeComponent, AppError> {
        self.resolve(
            "cua-driver",
            "CUA_DRIVER_PATH",
            if cfg!(windows) {
                "cua-driver.exe"
            } else {
                "cua-driver"
            },
        )
    }

    /// Resolves the Cua Driver path without hashing it. Capability discovery
    /// runs during the first window render and must not read the whole driver
    /// binary just to decide whether the feature is present. Callers that are
    /// about to execute the driver must continue to use [`Self::cua_driver`].
    pub fn cua_driver_startup_path(&self) -> Result<RuntimeComponent, AppError> {
        self.resolve_unverified(
            "cua-driver",
            "CUA_DRIVER_PATH",
            if cfg!(windows) {
                "cua-driver.exe"
            } else {
                "cua-driver"
            },
        )
    }

    fn verify_manifest_component(&self, name: &str, path: &Path) -> Result<(), AppError> {
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(self.root.join("manifest.json")).map_err(|error| {
                AppError::new(ErrorCode::RuntimeUnavailable, "内嵌运行时 manifest 不可读")
                    .context("cause", error)
            })?,
        )
        .map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, "内嵌运行时 manifest 已损坏")
                .context("cause", error)
        })?;
        let component = manifest
            .get("components")
            .and_then(serde_json::Value::as_array)
            .and_then(|components| {
                components.iter().find(|component| {
                    component.get("name").and_then(serde_json::Value::as_str) == Some(name)
                })
            })
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("内嵌运行时 manifest 缺少 {name}"),
                )
            })?;
        let target = component
            .get("target")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("{name} manifest 路径缺失"),
                )
            })?;
        let expected_path = self.root.join(target).canonicalize().map_err(|error| {
            AppError::new(
                ErrorCode::RuntimeUnavailable,
                format!("{name} manifest 路径无效"),
            )
            .context("cause", error)
        })?;
        let actual_path = path.canonicalize().map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, format!("{name} 路径无效"))
                .context("cause", error)
        })?;
        let root = self.root.canonicalize().map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, "内嵌运行时根目录无效")
                .context("cause", error)
        })?;
        if actual_path != expected_path || !actual_path.starts_with(&root) {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                format!("{name} 不位于当前 App 的可信内嵌运行时中"),
            )
            .context("path", actual_path.to_string_lossy()));
        }
        let expected_hash = component
            .get("sha256")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("{name} manifest 哈希缺失"),
                )
            })?;
        let actual_hash = sha256_file(&actual_path, &format!("无法校验 {name}"))?;
        if actual_hash != expected_hash {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                format!("{name} 与 runtime manifest 哈希不一致"),
            ));
        }
        if let Some(runtime_files) = component
            .get("runtime")
            .and_then(serde_json::Value::as_array)
        {
            for runtime_file in runtime_files {
                let target = runtime_file
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::RuntimeUnavailable,
                            format!("{name} runtime manifest 路径缺失"),
                        )
                    })?;
                let runtime_path = self.root.join(target).canonicalize().map_err(|error| {
                    AppError::new(
                        ErrorCode::RuntimeUnavailable,
                        format!("{name} runtime manifest 路径无效"),
                    )
                    .context("cause", error)
                })?;
                if !runtime_path.is_file() || !runtime_path.starts_with(&root) {
                    return Err(AppError::new(
                        ErrorCode::PermissionDenied,
                        format!("{name} runtime 文件不可信"),
                    )
                    .context("path", runtime_path.to_string_lossy()));
                }
                let expected_hash = runtime_file
                    .get("sha256")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::RuntimeUnavailable,
                            format!("{name} runtime manifest 哈希缺失"),
                        )
                    })?;
                let actual_hash = sha256_file(&runtime_path, &format!("无法校验 {name} runtime"))?;
                if actual_hash != expected_hash {
                    return Err(AppError::new(
                        ErrorCode::PermissionDenied,
                        format!("{name} runtime 与 manifest 哈希不一致"),
                    )
                    .context("path", runtime_path.to_string_lossy()));
                }
            }
        }
        Ok(())
    }

    pub fn mcp_host(&self) -> Result<RuntimeComponent, AppError> {
        self.resolve(
            "mcp-host",
            "ONPEOPLE_MCP_HOST_SOURCE",
            if cfg!(windows) {
                "onpeople-mcp-host.exe"
            } else {
                "onpeople-mcp-host"
            },
        )
    }

    fn override_component(
        &self,
        name: &'static str,
        override_name: &str,
    ) -> Result<Option<RuntimeComponent>, AppError> {
        let Some(path) = std::env::var_os(override_name).map(PathBuf::from) else {
            return Ok(None);
        };
        if !self.allow_env_overrides {
            eprintln!(
                "onpeople-runtime: 忽略 {override_name} 覆盖（此构建只信任已校验的内嵌运行时）"
            );
            return Ok(None);
        }
        if executable_file(&path) {
            return Ok(Some(RuntimeComponent {
                name,
                path,
                bundled: false,
            }));
        }
        Err(AppError::new(
            ErrorCode::RuntimeUnavailable,
            format!("{name} 覆盖路径不可执行"),
        )
        .context("path", path.to_string_lossy()))
    }

    fn bundled_component_path(
        &self,
        name: &'static str,
        executable: &str,
    ) -> Result<PathBuf, AppError> {
        let candidates = [
            self.root.join("bin").join(executable),
            self.root.join(executable),
        ];
        candidates
            .into_iter()
            .find(|path| executable_file(path))
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("未找到已签名的 {name} 运行时"),
                )
            })
    }

    fn resolve(
        &self,
        name: &'static str,
        override_name: &str,
        executable: &str,
    ) -> Result<RuntimeComponent, AppError> {
        if let Some(component) = self.override_component(name, override_name)? {
            return Ok(component);
        }
        let path = self.bundled_component_path(name, executable)?;
        self.verify_manifest_component(name, &path)?;
        Ok(RuntimeComponent {
            name,
            path,
            bundled: true,
        })
    }

    fn resolve_unverified(
        &self,
        name: &'static str,
        override_name: &str,
        executable: &str,
    ) -> Result<RuntimeComponent, AppError> {
        if let Some(component) = self.override_component(name, override_name)? {
            return Ok(component);
        }
        let path = self.bundled_component_path(name, executable)?;
        Ok(RuntimeComponent {
            name,
            path,
            bundled: true,
        })
    }
}

fn sha256_file(path: &Path, message: &str) -> Result<String, AppError> {
    let mut file = std::fs::File::open(path).map_err(|error| {
        AppError::new(ErrorCode::RuntimeUnavailable, message).context("cause", error)
    })?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, message).context("cause", error)
        })?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        true
    }
}
