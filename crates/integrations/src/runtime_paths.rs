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
}

impl RuntimePaths {
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self { root }
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

    pub fn browser_host(&self) -> Result<RuntimeComponent, AppError> {
        #[cfg(target_os = "macos")]
        {
            let bundled = self
                .root
                .join("OnPeople Browser Host.app/Contents/MacOS/OnPeople Browser Host");
            if executable_file(&bundled) {
                self.verify_manifest_component("browser-host", &bundled)?;
                return Ok(RuntimeComponent {
                    name: "browser-host",
                    path: bundled,
                    bundled: true,
                });
            }
            #[cfg(not(debug_assertions))]
            return Err(AppError::new(
                ErrorCode::RuntimeUnavailable,
                "正式构建缺少当前 App 内嵌的 Browser Host",
            )
            .context("runtime_root", self.root.to_string_lossy()));
        }
        #[cfg(any(not(target_os = "macos"), debug_assertions))]
        self.resolve(
            "browser-host",
            "ONPEOPLE_BROWSER_HOST_SOURCE",
            if cfg!(windows) {
                "onpeople-browser-host.exe"
            } else {
                "onpeople-browser-host"
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
                    "内嵌运行时 manifest 缺少 Browser Host",
                )
            })?;
        let target = component
            .get("target")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    "Browser Host manifest 路径缺失",
                )
            })?;
        let expected_path = self.root.join(target).canonicalize().map_err(|error| {
            AppError::new(
                ErrorCode::RuntimeUnavailable,
                "Browser Host manifest 路径无效",
            )
            .context("cause", error)
        })?;
        let actual_path = path.canonicalize().map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, "Browser Host 路径无效")
                .context("cause", error)
        })?;
        let root = self.root.canonicalize().map_err(|error| {
            AppError::new(ErrorCode::RuntimeUnavailable, "内嵌运行时根目录无效")
                .context("cause", error)
        })?;
        if actual_path != expected_path || !actual_path.starts_with(&root) {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                "Browser Host 不位于当前 App 的可信内嵌运行时中",
            )
            .context("path", actual_path.to_string_lossy()));
        }
        let expected_hash = component
            .get("sha256")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    "Browser Host manifest 哈希缺失",
                )
            })?;
        let actual_hash = sha256_file(&actual_path, "无法校验 Browser Host")?;
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

    fn resolve(
        &self,
        name: &'static str,
        override_name: &str,
        executable: &str,
    ) -> Result<RuntimeComponent, AppError> {
        if let Some(path) = std::env::var_os(override_name).map(PathBuf::from) {
            if executable_file(&path) {
                return Ok(RuntimeComponent {
                    name,
                    path,
                    bundled: false,
                });
            }
            return Err(AppError::new(
                ErrorCode::RuntimeUnavailable,
                format!("{name} 覆盖路径不可执行"),
            )
            .context("path", path.to_string_lossy()));
        }
        let candidates = [
            self.root.join("bin").join(executable),
            self.root.join(executable),
        ];
        let path = candidates
            .into_iter()
            .find(|path| executable_file(path))
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("未找到已签名的 {name} 运行时"),
                )
            })?;
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
        if let Some(path) = std::env::var_os(override_name).map(PathBuf::from) {
            if executable_file(&path) {
                return Ok(RuntimeComponent {
                    name,
                    path,
                    bundled: false,
                });
            }
            return Err(AppError::new(
                ErrorCode::RuntimeUnavailable,
                format!("{name} 覆盖路径不可执行"),
            )
            .context("path", path.to_string_lossy()));
        }
        let candidates = [
            self.root.join("bin").join(executable),
            self.root.join(executable),
        ];
        let path = candidates
            .into_iter()
            .find(|path| executable_file(path))
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RuntimeUnavailable,
                    format!("未找到已签名的 {name} 运行时"),
                )
            })?;
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

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::RuntimePaths;

    #[test]
    fn rejects_modified_extended_runtime_files() {
        let temporary = tempfile::tempdir().expect("temporary runtime");
        let root = temporary.path();
        let host = root.join("bin/onpeople-browser-host.exe");
        let cef = root.join("bin/libcef.dll");
        std::fs::create_dir_all(host.parent().expect("runtime bin")).expect("runtime bin");
        std::fs::write(&host, b"host").expect("browser host");
        std::fs::write(&cef, b"cef").expect("cef runtime");
        let hash = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "components": [{
                    "name": "browser-host",
                    "target": "bin/onpeople-browser-host.exe",
                    "sha256": hash(b"host"),
                    "runtime": [{
                        "target": "bin/libcef.dll",
                        "sha256": hash(b"cef")
                    }]
                }]
            }))
            .expect("runtime manifest"),
        )
        .expect("write runtime manifest");
        let paths = RuntimePaths::new(root.to_path_buf());
        paths
            .verify_manifest_component("browser-host", &host)
            .expect("valid extended runtime");

        std::fs::write(&cef, b"tampered").expect("modify cef runtime");
        let error = paths
            .verify_manifest_component("browser-host", &host)
            .expect_err("modified CEF must fail");
        assert_eq!(error.code, onpeople_types::ErrorCode::PermissionDenied);
    }
}
