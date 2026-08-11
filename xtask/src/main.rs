use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Child, Command, ExitCode},
    time::{Duration, Instant},
};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("bindings") => {
            let check = args.any(|arg| arg == "--check");
            match bindings(check) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("xtask bindings: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("clean-release") => {
            let root = workspace_root();
            for path in [root.join("dist"), root.join("dist-tauri")] {
                if path.exists() {
                    if let Err(error) = fs::remove_dir_all(&path) {
                        eprintln!("xtask clean-release: {}: {error}", path.display());
                        return ExitCode::FAILURE;
                    }
                }
            }
            ExitCode::SUCCESS
        }
        Some("audit") => match audit() {
            Ok(()) => {
                println!("OnPeople 0.30 final architecture audit passed");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("xtask audit: {error}");
                ExitCode::FAILURE
            }
        },
        Some("stage-runtime") => {
            let platform = option_value(&mut args, "--platform").unwrap_or_else(|| {
                env::var("ONPEOPLE_TARGET_PLATFORM").unwrap_or_else(|_| current_platform())
            });
            let arch = option_value(&mut args, "--arch").unwrap_or_else(|| {
                env::var("ONPEOPLE_TARGET_ARCH").unwrap_or_else(|_| current_arch())
            });
            match stage_runtime(&platform, &arch) {
                Ok(manifest) => {
                    println!("staged runtime: {}", manifest.display());
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("xtask stage-runtime: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("package-contents") => match package_contents() {
            Ok(()) => {
                println!("OnPeople Tauri package contents audit passed");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("xtask package-contents: {error}");
                ExitCode::FAILURE
            }
        },
        Some("sign-macos-runtime") => match sign_macos_runtime() {
            Ok(()) => {
                println!("signed macOS Browser Host runtime");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("xtask sign-macos-runtime: {error}");
                ExitCode::FAILURE
            }
        },
        Some("package-msix") => match package_msix() {
            Ok(path) => {
                println!("created MSIX: {}", path.display());
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("xtask package-msix: {error}");
                ExitCode::FAILURE
            }
        },
        Some("package-macos-zip") => match package_macos_zip() {
            Ok(path) => {
                println!("created macOS ZIP: {}", path.display());
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("xtask package-macos-zip: {error}");
                ExitCode::FAILURE
            }
        },
        Some("smoke-browser-runtime") => {
            let runtime_root = option_value(&mut args, "--runtime-root")
                .map(PathBuf::from)
                .unwrap_or_else(|| workspace_root().join(".embedded-runtime"));
            match smoke_browser_runtime(&runtime_root) {
                Ok(()) => {
                    println!(
                        "OnPeople Browser Host smoke passed: {}",
                        runtime_root.display()
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("xtask smoke-browser-runtime: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("smoke-agent-runtime") => {
            let runtime_root = option_value(&mut args, "--runtime-root")
                .map(PathBuf::from)
                .unwrap_or_else(|| workspace_root().join(".embedded-runtime"));
            match smoke_agent_runtime(&runtime_root) {
                Ok(()) => {
                    println!(
                        "OnPeople Codex App Server smoke passed: {}",
                        runtime_root.display()
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("xtask smoke-agent-runtime: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("smoke-headless-runtime") => {
            let runtime_root = option_value(&mut args, "--runtime-root")
                .map(PathBuf::from)
                .unwrap_or_else(|| workspace_root().join(".embedded-runtime"));
            match smoke_headless_runtime(&runtime_root) {
                Ok(()) => {
                    println!(
                        "OnPeople headless runtime smoke passed: {}",
                        runtime_root.display()
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("xtask smoke-headless-runtime: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Some("release-gate") => {
            let platform = option_value(&mut args, "--platform").unwrap_or_else(|| {
                env::var("ONPEOPLE_TARGET_PLATFORM").unwrap_or_else(|_| current_platform())
            });
            let arch = option_value(&mut args, "--arch").unwrap_or_else(|| {
                env::var("ONPEOPLE_TARGET_ARCH").unwrap_or_else(|_| current_arch())
            });
            let bundle_dir = option_value(&mut args, "--bundle-dir")
                .map(PathBuf::from)
                .unwrap_or_else(|| release_dir(&workspace_root()).join("bundle"));
            match release_gate(&platform, &arch, &bundle_dir) {
                Ok(()) => {
                    println!("OnPeople release gate passed for {platform}-{arch}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("xtask release-gate: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!(
                "usage: cargo run -p xtask -- bindings [--check] | audit | stage-runtime [--platform P --arch A] | package-contents | sign-macos-runtime | package-msix | package-macos-zip | smoke-browser-runtime [--runtime-root DIR] | smoke-agent-runtime [--runtime-root DIR] | smoke-headless-runtime [--runtime-root DIR] | release-gate [--platform P --arch A --bundle-dir DIR] | clean-release"
            );
            ExitCode::from(2)
        }
    }
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("workspace root")
}

fn release_dir(root: &Path) -> PathBuf {
    env::var_os("ONPEOPLE_RELEASE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("target/release"))
}

fn option_value(args: &mut impl Iterator<Item = String>, name: &str) -> Option<String> {
    let mut value = None;
    while let Some(arg) = args.next() {
        if arg == name {
            value = args.next();
            break;
        }
    }
    value
}

fn current_platform() -> String {
    if cfg!(target_os = "macos") {
        "darwin".to_owned()
    } else if cfg!(windows) {
        "win32".to_owned()
    } else {
        "linux".to_owned()
    }
}

fn current_arch() -> String {
    match std::env::consts::ARCH {
        "aarch64" => "arm64".to_owned(),
        "x86_64" => "x64".to_owned(),
        value => value.to_owned(),
    }
}

fn stage_runtime(platform: &str, arch: &str) -> Result<PathBuf, String> {
    if !matches!(platform, "darwin" | "win32") {
        return Err(format!("unsupported release platform: {platform}"));
    }
    if !matches!(arch, "arm64" | "x64") {
        return Err(format!("unsupported release architecture: {arch}"));
    }
    let root = workspace_root();
    let stage = root.join(".embedded-runtime");
    if stage.exists() {
        fs::remove_dir_all(&stage).map_err(|error| error.to_string())?;
    }
    let bin = stage.join("bin");
    fs::create_dir_all(&bin).map_err(|error| error.to_string())?;
    let executable_suffix = if platform == "win32" { ".exe" } else { "" };
    let components: [(&str, String, &[&str]); 5] = [
        (
            "codex",
            format!("codex{executable_suffix}"),
            &["CODEX_BUNDLE_SOURCE", "CODEX_BIN"],
        ),
        (
            "cua-driver",
            format!("cua-driver{executable_suffix}"),
            &["CUA_DRIVER_BINARY_SOURCE", "CUA_DRIVER_PATH"],
        ),
        (
            "browser-host",
            format!("onpeople-browser-host{executable_suffix}"),
            &["ONPEOPLE_BROWSER_HOST_SOURCE"],
        ),
        (
            "mcp-host",
            format!("onpeople-mcp-host{executable_suffix}"),
            &["ONPEOPLE_MCP_HOST_SOURCE"],
        ),
        (
            "headless",
            format!("onpeople{executable_suffix}"),
            &["ONPEOPLE_CLI_SOURCE"],
        ),
    ];
    let mut entries = Vec::new();
    for (name, file_name, variables) in components {
        let source = variables
            .iter()
            .find_map(|variable| env::var_os(variable).map(PathBuf::from))
            .or_else(|| {
                env::var_os("ONPEOPLE_RUNTIME_DIR").map(|directory| {
                    PathBuf::from(directory).join(&file_name)
                })
            })
            .or_else(|| {
                let candidate = release_dir(&root).join(&file_name);
                candidate.is_file().then_some(candidate)
            })
            .ok_or_else(|| {
                format!(
                    "missing {name} for {platform}-{arch}; set {} or build target/release/{file_name}",
                    variables.join(" or ")
                )
            })?;
        if !source.is_file() {
            return Err(format!(
                "runtime source is not a file: {}",
                source.display()
            ));
        }
        let canonical_source = source
            .canonicalize()
            .map_err(|error| format!("resolve {name} source: {error}"))?;
        if canonical_source.starts_with(&stage) {
            return Err(format!("{name} source points into the staging directory"));
        }
        let target = bin.join(&file_name);
        fs::copy(&source, &target)
            .map_err(|error| format!("copy {name} from {}: {error}", source.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&target)
                .map_err(|error| error.to_string())?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&target, permissions).map_err(|error| error.to_string())?;
        }
        verify_target_binary(&target, platform, arch, name)?;
        let staged_target = if name == "browser-host" && platform == "darwin" {
            let bundle_executable = stage_macos_browser_host_bundle(&root, &stage, &target, arch)?;
            // macOS launches the complete nested Host.app. Do not ship a
            // second standalone browser-host binary alongside it; that path
            // bypasses the framework/helpers and is the source of the second
            // Dock process seen in preview builds.
            fs::remove_file(&target)
                .map_err(|error| format!("remove duplicate macOS browser-host binary: {error}"))?;
            bundle_executable
        } else {
            target.clone()
        };
        let mut entry = serde_json::json!({
            "name": name,
            "source": source,
            "target": staged_target.strip_prefix(&stage).map_err(|error| error.to_string())?,
            "sha256": sha256(&staged_target)?,
        });
        if name == "browser-host" && platform == "win32" {
            entry["runtime"] =
                serde_json::Value::Array(stage_windows_cef_runtime(&root, &stage, arch)?);
        }
        entries.push(entry);
    }
    let plugins = stage_bundled_plugins(&root, &stage)?;
    let manifest = stage.join("manifest.json");
    fs::write(
        &manifest,
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "target": { "platform": platform, "arch": arch },
            "components": entries,
            "plugins": plugins,
            "generatedBy": "xtask stage-runtime",
        }))
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(manifest)
}

fn stage_bundled_plugins(root: &Path, stage: &Path) -> Result<Vec<serde_json::Value>, String> {
    const BUNDLED_PLUGIN_IDS: &[&str] = &[
        "research-paper",
        "documents",
        "pdf",
        "spreadsheets",
        "presentations",
        "template-creator",
        "sites",
        "visualize",
    ];
    let mut files = Vec::new();
    for id in BUNDLED_PLUGIN_IDS {
        let source = root.join("plugins").join(id);
        if !source.join(".codex-plugin/plugin.json").is_file() {
            return Err(format!("bundled plugin {id} has no plugin manifest"));
        }
        let target = stage.join("plugins").join(id);
        for entry in walkdir::WalkDir::new(&source).follow_links(false) {
            let entry = entry.map_err(|error| error.to_string())?;
            let relative = entry
                .path()
                .strip_prefix(&source)
                .map_err(|error| error.to_string())?;
            if relative.as_os_str().is_empty() || relative.starts_with(".git") {
                continue;
            }
            if entry.file_type().is_symlink() {
                return Err(format!(
                    "bundled plugin {id} contains a symbolic link: {}",
                    relative.display()
                ));
            }
            let destination = target.join(relative);
            if entry.file_type().is_dir() {
                fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
                continue;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(entry.path(), &destination).map_err(|error| {
                format!(
                    "copy bundled plugin {} to {}: {error}",
                    entry.path().display(),
                    destination.display()
                )
            })?;
            files.push(serde_json::json!({
                "plugin": id,
                "target": destination.strip_prefix(stage).map_err(|error| error.to_string())?,
                "sha256": sha256(&destination)?,
            }));
        }
    }
    files.sort_by(|left, right| {
        left.get("target")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("target").and_then(serde_json::Value::as_str))
    });
    Ok(files)
}

fn stage_windows_cef_runtime(
    root: &Path,
    stage: &Path,
    arch: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let source = find_windows_cef_runtime(root, arch)?;
    let target = stage.join("bin");
    let mut copied = Vec::new();
    copy_directory_files(&source, &target, stage, &mut copied)?;
    let locales = source.join("locales");
    if !locales.is_dir() {
        return Err(format!(
            "Windows CEF locales directory is missing: {}",
            locales.display()
        ));
    }
    copy_directory_files(&locales, &target.join("locales"), stage, &mut copied)?;
    copied.sort_by(|left, right| {
        left.get("target")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("target").and_then(serde_json::Value::as_str))
    });
    validate_windows_cef_runtime(stage)?;
    Ok(copied)
}

fn find_windows_cef_runtime(root: &Path, arch: &str) -> Result<PathBuf, String> {
    if arch != "x64" {
        return Err(format!("unsupported Windows CEF architecture: {arch}"));
    }
    if let Some(path) = env::var_os("ONPEOPLE_CEF_RUNTIME_SOURCE").map(PathBuf::from) {
        if path.join("libcef.dll").is_file() {
            return Ok(path);
        }
        return Err(format!(
            "ONPEOPLE_CEF_RUNTIME_SOURCE is not a Windows CEF runtime: {}",
            path.display()
        ));
    }
    let build_root = release_dir(root).join("build");
    walkdir::WalkDir::new(&build_root)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("cef_windows_")
                && entry.path().join("libcef.dll").is_file()
        })
        .map(walkdir::DirEntry::into_path)
        .ok_or_else(|| {
            "missing Windows CEF runtime; build onpeople-browser-host on Windows or set ONPEOPLE_CEF_RUNTIME_SOURCE"
                .to_owned()
        })
}

fn copy_directory_files(
    source: &Path,
    target: &Path,
    stage: &Path,
    copied: &mut Vec<serde_json::Value>,
) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let destination = target.join(entry.file_name());
        fs::copy(entry.path(), &destination).map_err(|error| {
            format!(
                "copy Windows CEF runtime {} to {}: {error}",
                entry.path().display(),
                destination.display()
            )
        })?;
        copied.push(serde_json::json!({
            "target": destination.strip_prefix(stage).map_err(|error| error.to_string())?,
            "sha256": sha256(&destination)?,
        }));
    }
    Ok(())
}

fn validate_windows_cef_runtime(stage: &Path) -> Result<(), String> {
    let bin = stage.join("bin");
    for name in [
        "libcef.dll",
        "chrome_elf.dll",
        "icudtl.dat",
        "resources.pak",
        "chrome_100_percent.pak",
        "chrome_200_percent.pak",
        "v8_context_snapshot.bin",
    ] {
        if !bin.join(name).is_file() {
            return Err(format!("Windows CEF runtime is missing bin/{name}"));
        }
    }
    let locales = bin.join("locales");
    let has_locale = locales
        .read_dir()
        .map_err(|error| format!("read Windows CEF locales: {error}"))?
        .filter_map(Result::ok)
        .any(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("pak"));
    if !has_locale {
        return Err("Windows CEF runtime contains no locale .pak files".to_owned());
    }
    Ok(())
}

fn stage_macos_browser_host_bundle(
    root: &Path,
    stage: &Path,
    browser_host: &Path,
    arch: &str,
) -> Result<PathBuf, String> {
    let app_name = "OnPeople Browser Host";
    let app = stage.join(format!("{app_name}.app"));
    let contents = app.join("Contents");
    let executable = contents.join("MacOS").join(app_name);
    fs::create_dir_all(contents.join("MacOS")).map_err(|error| error.to_string())?;
    fs::create_dir_all(contents.join("Frameworks")).map_err(|error| error.to_string())?;
    fs::create_dir_all(contents.join("Resources")).map_err(|error| error.to_string())?;
    fs::copy(browser_host, &executable).map_err(|error| error.to_string())?;
    set_executable(&executable)?;
    write_macos_info_plist(
        &contents,
        app_name,
        "com.userinner.onpeople.browser-host",
        false,
    )?;

    let framework_source = find_macos_cef_framework(root, arch)?;
    copy_dir_recursive(
        &framework_source,
        &contents
            .join("Frameworks")
            .join("Chromium Embedded Framework.framework"),
    )?;
    // CEF resolves the browser process resources from the main macOS app
    // bundle. The framework package keeps the .pak/icudtl/locales files under
    // its own Resources directory, so copy them into the nested host bundle
    // as well. Without this, CEF can reach cef_initialize and trap in the
    // resource loader before the browser IPC socket is available.
    copy_dir_recursive(
        &framework_source.join("Resources"),
        &contents.join("Resources"),
    )?;

    for suffix in [
        "Helper",
        "Helper (GPU)",
        "Helper (Renderer)",
        "Helper (Plugin)",
        "Helper (Alerts)",
    ] {
        let helper_name = format!("{app_name} {suffix}");
        let helper_contents = contents
            .join("Frameworks")
            .join(format!("{helper_name}.app"))
            .join("Contents");
        fs::create_dir_all(helper_contents.join("MacOS")).map_err(|error| error.to_string())?;
        fs::create_dir_all(helper_contents.join("Resources")).map_err(|error| error.to_string())?;
        let helper_executable = helper_contents.join("MacOS").join(&helper_name);
        fs::copy(browser_host, &helper_executable).map_err(|error| error.to_string())?;
        set_executable(&helper_executable)?;
        write_macos_info_plist(
            &helper_contents,
            &helper_name,
            macos_helper_bundle_identifier(suffix),
            true,
        )?;
    }
    verify_target_binary(&executable, "darwin", arch, "browser-host bundle")?;
    Ok(executable)
}

fn macos_helper_bundle_identifier(suffix: &str) -> &'static str {
    // Chromium intentionally gives the generic and GPU helper variants the
    // same stable application identity. Renderer, legacy plugin and alert
    // service variants extend that identity. Changing these identifiers can
    // make Chromium's same-signature child-process validation reject an
    // otherwise correctly signed helper at runtime.
    match suffix {
        "Helper" | "Helper (GPU)" => "com.userinner.onpeople.browser-host.helper",
        "Helper (Renderer)" => "com.userinner.onpeople.browser-host.helper.renderer",
        "Helper (Plugin)" => "com.userinner.onpeople.browser-host.helper.plugin",
        "Helper (Alerts)" => "com.userinner.onpeople.browser-host.helper.AlertNotificationService",
        _ => panic!("unsupported CEF helper suffix: {suffix}"),
    }
}

fn find_macos_cef_framework(root: &Path, arch: &str) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("ONPEOPLE_CEF_FRAMEWORK_SOURCE").map(PathBuf::from) {
        if path.join("Chromium Embedded Framework").is_file() {
            return Ok(path);
        }
        return Err(format!(
            "ONPEOPLE_CEF_FRAMEWORK_SOURCE is not a CEF framework: {}",
            path.display()
        ));
    }
    let architecture_directory = if arch == "arm64" {
        "cef_macos_aarch64"
    } else {
        "cef_macos_x86_64"
    };
    let build_root = release_dir(root).join("build");
    walkdir::WalkDir::new(&build_root)
        .max_depth(5)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir()
                && entry.file_name() == "Chromium Embedded Framework.framework"
                && entry.path().components().any(|component| {
                    component.as_os_str() == std::ffi::OsStr::new(architecture_directory)
                })
        })
        .map(|entry| entry.into_path())
        .ok_or_else(|| {
            format!("missing CEF framework for darwin-{arch}; set ONPEOPLE_CEF_FRAMEWORK_SOURCE")
        })
}

fn write_macos_info_plist(
    contents: &Path,
    executable: &str,
    identifier: &str,
    helper: bool,
) -> Result<(), String> {
    // The CEF browser host is a background rendering sidecar.  Mark both the
    // host and its Chromium helpers as agent applications so macOS does not
    // expose a second Dock icon alongside the Tauri shell.
    let agent_entry = "  <key>LSUIElement</key>\n  <true/>\n";
    let bundle_name = if helper { executable } else { "OnPeople" };
    let plist = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n<dict>\n\
  <key>CFBundleDevelopmentRegion</key>\n  <string>English</string>\n\
  <key>CFBundleDisplayName</key>\n  <string>{executable}</string>\n\
  <key>CFBundleExecutable</key>\n  <string>{executable}</string>\n\
  <key>CFBundleIdentifier</key>\n  <string>{identifier}</string>\n\
  <key>CFBundleInfoDictionaryVersion</key>\n  <string>6.0</string>\n\
  <key>CFBundleName</key>\n  <string>{bundle_name}</string>\n\
  <key>CrProductDirName</key>\n  <string>OnPeople</string>\n\
  <key>CFBundlePackageType</key>\n  <string>APPL</string>\n\
  <key>CFBundleShortVersionString</key>\n  <string>{}</string>\n\
  <key>CFBundleVersion</key>\n  <string>{}</string>\n\
  <key>LSMinimumSystemVersion</key>\n  <string>11.0</string>\n\
{agent_entry}  <key>NSHighResolutionCapable</key>\n  <true/>\n\
  <key>NSSupportsAutomaticGraphicsSwitching</key>\n  <true/>\n\
</dict>\n</plist>\n",
        env!("CARGO_PKG_VERSION"),
        env!("CARGO_PKG_VERSION"),
    );
    fs::write(contents.join("Info.plist"), plist).map_err(|error| error.to_string())
}

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn verify_target_binary(path: &Path, platform: &str, arch: &str, name: &str) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| format!("read {name}: {error}"))?;
    if bytes.len() < 4 {
        return Err(format!("{name} is not a complete executable"));
    }
    match platform {
        "darwin" => {
            let magic = u32::from_be_bytes(bytes[0..4].try_into().unwrap());
            if matches!(magic, 0xcafe_babe | 0xbeba_feca) {
                if bytes.len() < 8 {
                    return Err(format!("{name} has an incomplete universal Mach-O header"));
                }
                let little_endian = magic == 0xbeba_feca;
                let read_u32 = |offset: usize| {
                    let value = bytes[offset..offset + 4].try_into().unwrap();
                    if little_endian {
                        u32::from_le_bytes(value)
                    } else {
                        u32::from_be_bytes(value)
                    }
                };
                let count = read_u32(4) as usize;
                let expected = match arch {
                    "arm64" => 0x0100_000c,
                    "x64" => 0x0100_0007,
                    _ => return Err(format!("unsupported macOS architecture: {arch}")),
                };
                let has_arch = (0..count).any(|index| {
                    let offset = 8 + index.saturating_mul(20);
                    bytes.len() >= offset.saturating_add(4) && read_u32(offset) == expected
                });
                if !has_arch {
                    return Err(format!(
                        "{name} universal Mach-O does not contain the requested {arch} slice"
                    ));
                }
                return Ok(());
            }
            let little_magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
            if little_magic != 0xfeed_facf {
                return Err(format!("{name} is not a 64-bit Mach-O executable"));
            }
            let cpu_type = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
            let expected = match arch {
                "arm64" => 0x0100_000c,
                "x64" => 0x0100_0007,
                _ => return Err(format!("unsupported macOS architecture: {arch}")),
            };
            if cpu_type != expected {
                return Err(format!(
                    "{name} architecture mismatch: expected {arch}, Mach-O cputype 0x{cpu_type:08x}"
                ));
            }
        }
        "win32" => {
            if bytes[0..2] != *b"MZ" {
                return Err(format!("{name} is not a Windows PE executable"));
            }
            let pe_offset = u32::from_le_bytes(bytes[0x3c..0x40].try_into().unwrap()) as usize;
            if bytes.len() < pe_offset.saturating_add(6)
                || bytes.get(pe_offset..pe_offset + 4) != Some(b"PE\0\0")
            {
                return Err(format!("{name} has an invalid PE header"));
            }
            let machine =
                u16::from_le_bytes(bytes[pe_offset + 4..pe_offset + 6].try_into().unwrap());
            let expected = match arch {
                "x64" => 0x8664,
                _ => return Err(format!("unsupported Windows architecture: {arch}")),
            };
            if machine != expected {
                return Err(format!(
                    "{name} architecture mismatch: expected {arch}, PE machine 0x{machine:04x}"
                ));
            }
        }
        _ => return Err(format!("unsupported release platform: {platform}")),
    }
    Ok(())
}

fn package_contents() -> Result<(), String> {
    let root = workspace_root();
    let stage = root.join(".embedded-runtime");
    let canonical_stage = stage
        .canonicalize()
        .map_err(|error| format!("resolve staged runtime: {error}"))?;
    let manifest_path = stage.join("manifest.json");
    let manifest: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let expected_platform =
        env::var("ONPEOPLE_TARGET_PLATFORM").unwrap_or_else(|_| current_platform());
    let expected_arch = env::var("ONPEOPLE_TARGET_ARCH").unwrap_or_else(|_| current_arch());
    let target = manifest
        .get("target")
        .ok_or_else(|| "runtime manifest has no target".to_owned())?;
    if target.get("platform").and_then(serde_json::Value::as_str)
        != Some(expected_platform.as_str())
        || target.get("arch").and_then(serde_json::Value::as_str) != Some(expected_arch.as_str())
    {
        return Err(format!(
            "runtime target mismatch; expected {expected_platform}-{expected_arch}"
        ));
    }
    let components = manifest
        .get("components")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "runtime manifest has no components".to_owned())?;
    for name in [
        "codex",
        "cua-driver",
        "browser-host",
        "mcp-host",
        "headless",
    ] {
        let component = components
            .iter()
            .find(|component| {
                component.get("name").and_then(serde_json::Value::as_str) == Some(name)
            })
            .ok_or_else(|| format!("runtime manifest missing {name}"))?;
        let target = component
            .get("target")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("runtime manifest missing {name} target"))?;
        let path = stage.join(target);
        if !path.is_file() {
            return Err(format!("staged runtime file missing: {}", path.display()));
        }
        let canonical_path = path
            .canonicalize()
            .map_err(|error| format!("resolve staged runtime file: {error}"))?;
        if !canonical_path.starts_with(&canonical_stage) {
            return Err(format!(
                "staged runtime target escapes runtime root: {target}"
            ));
        }
        let expected = component
            .get("sha256")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("runtime manifest missing {name} checksum"))?;
        if sha256(&path)? != expected {
            return Err(format!("staged runtime checksum mismatch: {name}"));
        }
        if name == "browser-host" && expected_platform == "darwin" {
            validate_macos_browser_host_bundle(&path)?;
        }
        if name == "browser-host" && expected_platform == "win32" {
            let runtime = component
                .get("runtime")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| "Windows browser-host manifest has no CEF runtime".to_owned())?;
            if runtime.is_empty() {
                return Err("Windows browser-host CEF runtime is empty".to_owned());
            }
            for file in runtime {
                let target = file
                    .get("target")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| "Windows CEF manifest target is missing".to_owned())?;
                let path = stage.join(target);
                let canonical_path = path
                    .canonicalize()
                    .map_err(|error| format!("resolve Windows CEF runtime {target}: {error}"))?;
                if !canonical_path.is_file() || !canonical_path.starts_with(&canonical_stage) {
                    return Err(format!("untrusted Windows CEF runtime target: {target}"));
                }
                let expected = file
                    .get("sha256")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| format!("Windows CEF runtime checksum is missing: {target}"))?;
                if sha256(&canonical_path)? != expected {
                    return Err(format!("Windows CEF runtime checksum mismatch: {target}"));
                }
            }
            validate_windows_cef_runtime(&stage)?;
        }
    }
    if expected_platform == "darwin" && stage.join("bin/onpeople-browser-host").exists() {
        return Err("macOS runtime contains duplicate standalone onpeople-browser-host".to_owned());
    }
    let names = components
        .iter()
        .filter_map(|component| component.get("name").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>();
    if names.len() != 5
        || names.iter().any(|name| {
            ![
                "codex",
                "cua-driver",
                "browser-host",
                "mcp-host",
                "headless",
            ]
            .contains(name)
        })
    {
        return Err("runtime manifest contains an unexpected component set".to_owned());
    }
    let plugins = manifest
        .get("plugins")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "runtime manifest has no bundled plugins".to_owned())?;
    let expected_plugins = [
        "research-paper",
        "documents",
        "pdf",
        "spreadsheets",
        "presentations",
        "template-creator",
        "sites",
        "visualize",
    ];
    for id in expected_plugins {
        if !plugins
            .iter()
            .any(|file| file.get("plugin").and_then(serde_json::Value::as_str) == Some(id))
        {
            return Err(format!("runtime manifest is missing bundled plugin {id}"));
        }
    }
    for file in plugins {
        let target = file
            .get("target")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "bundled plugin manifest target is missing".to_owned())?;
        let path = stage.join(target);
        let canonical_path = path
            .canonicalize()
            .map_err(|error| format!("resolve bundled plugin file {target}: {error}"))?;
        if !canonical_path.is_file() || !canonical_path.starts_with(&canonical_stage) {
            return Err(format!("untrusted bundled plugin target: {target}"));
        }
        let expected = file
            .get("sha256")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("bundled plugin checksum is missing: {target}"))?;
        if sha256(&canonical_path)? != expected {
            return Err(format!("bundled plugin checksum mismatch: {target}"));
        }
    }
    Ok(())
}

struct SmokeChild(Option<Child>);

impl SmokeChild {
    fn child_mut(&mut self) -> Result<&mut Child, String> {
        self.0
            .as_mut()
            .ok_or_else(|| "Browser Host smoke process is unavailable".to_owned())
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SmokeChild {
    fn drop(&mut self) {
        self.stop();
    }
}

fn smoke_browser_runtime(runtime_root: &Path) -> Result<(), String> {
    use onpeople_browser_host::{BrowserCommand, BrowserIpcClient, IpcConfig};

    let executable = if cfg!(target_os = "macos") {
        runtime_root.join("OnPeople Browser Host.app/Contents/MacOS/OnPeople Browser Host")
    } else if cfg!(windows) {
        runtime_root.join("bin/onpeople-browser-host.exe")
    } else {
        return Err("Browser Host release smoke supports macOS and Windows only".to_owned());
    };
    if !executable.is_file() {
        return Err(format!(
            "Browser Host smoke executable is missing: {}",
            executable.display()
        ));
    }
    let profile = tempfile::tempdir().map_err(|error| error.to_string())?;
    let profile_path = profile.path().join("cef-profile");
    fs::create_dir_all(&profile_path).map_err(|error| error.to_string())?;
    let config = IpcConfig::for_profile(&profile_path);
    let mut command = Command::new(&executable);
    command
        .env("ONPEOPLE_CEF_PROFILE", &profile_path)
        .env("ONPEOPLE_BROWSER_IPC_TOKEN", &config.token)
        .env(
            "ONPEOPLE_BROWSER_IPC_PROTOCOL",
            config.protocol_version.to_string(),
        )
        .env("ONPEOPLE_BROWSER_IPC_SOCKET", &config.address.unix_socket)
        .env("ONPEOPLE_BROWSER_IPC_PIPE", &config.address.windows_pipe);
    let child = command
        .spawn()
        .map_err(|error| format!("start Browser Host smoke process: {error}"))?;
    let mut child = SmokeChild(Some(child));
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| format!("create Browser Host smoke runtime: {error}"))?;
    let client = BrowserIpcClient::with_timeout(config, Duration::from_secs(2));
    runtime.block_on(async {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            if let Some(status) = child
                .child_mut()?
                .try_wait()
                .map_err(|error| format!("read Browser Host smoke status: {error}"))?
            {
                return Err(format!(
                    "Browser Host exited before CEF readiness with {status}"
                ));
            }
            if client
                .request(BrowserCommand::Ping)
                .await
                .ok()
                .and_then(|value| value.get("ready").and_then(serde_json::Value::as_bool))
                == Some(true)
            {
                break;
            }
            if Instant::now() >= deadline {
                return Err("Browser Host did not report CEF readiness within 60s".to_owned());
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        let route_id = format!("smoke-{}", uuid::Uuid::now_v7());
        client
            .request(BrowserCommand::CreateRoute {
                route_id: route_id.clone(),
                thread_id: "release-smoke".to_owned(),
                url: "about:blank".to_owned(),
            })
            .await
            .map_err(|error| format!("create Browser Host smoke route: {error}"))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if client
                .request(BrowserCommand::DomSnapshot {
                    route_id: route_id.clone(),
                })
                .await
                .is_ok()
            {
                break;
            }
            if Instant::now() >= deadline {
                return Err("CEF route did not produce a DOM snapshot within 30s".to_owned());
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let _ = client
            .request(BrowserCommand::CloseRoute { route_id })
            .await;
        Ok(())
    })?;
    child.stop();
    Ok(())
}

fn smoke_agent_runtime(runtime_root: &Path) -> Result<(), String> {
    use onpeople_core_runtime::{AgentRuntimeConfig, AppServerClient};
    use onpeople_types::{ProviderKind, ProviderSettings};

    let manifest_path = runtime_root.join("manifest.json");
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            format!("read runtime manifest {}: {error}", manifest_path.display())
        })?)
        .map_err(|error| {
            format!(
                "parse runtime manifest {}: {error}",
                manifest_path.display()
            )
        })?;
    let target = manifest
        .get("components")
        .and_then(serde_json::Value::as_array)
        .and_then(|components| {
            components.iter().find(|component| {
                component.get("name").and_then(serde_json::Value::as_str) == Some("codex")
            })
        })
        .and_then(|component| component.get("target"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "runtime manifest is missing the codex target".to_owned())?;
    let canonical_root = runtime_root
        .canonicalize()
        .map_err(|error| format!("resolve runtime root: {error}"))?;
    let executable = runtime_root
        .join(target)
        .canonicalize()
        .map_err(|error| format!("resolve staged Codex executable {target}: {error}"))?;
    if !executable.is_file() || !executable.starts_with(&canonical_root) {
        return Err(format!("untrusted staged Codex executable: {target}"));
    }
    let scratch = tempfile::tempdir().map_err(|error| error.to_string())?;
    let cwd = scratch.path().join("workspace");
    let codex_home = scratch.path().join("codex-home");
    fs::create_dir_all(&cwd).map_err(|error| error.to_string())?;
    let provider = ProviderSettings {
        kind: ProviderKind::Onpeople,
        name: "OnPeople release smoke".to_owned(),
        protocol: "responses".to_owned(),
        base_url: "http://127.0.0.1:9/v1".to_owned(),
        model: "gpt-5.6-sol".to_owned(),
        vision: true,
        api_key_set: true,
        extra: std::collections::BTreeMap::default(),
    };
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| format!("create App Server smoke runtime: {error}"))?;
    runtime.block_on(async {
        let client = AppServerClient::new(executable);
        client
            .start(
                &cwd,
                &codex_home,
                &provider,
                Some("onpeople-release-smoke"),
                &AgentRuntimeConfig {
                    enabled: false,
                    max_concurrent_threads: 1,
                },
            )
            .await
            .map_err(|error| format!("initialize staged Codex App Server: {}", error.message))?;
        if !client.is_ready() || !client.is_running() {
            client.stop().await;
            return Err("staged Codex App Server did not remain ready after initialize".to_owned());
        }
        client.stop().await;
        if client.is_ready() {
            return Err("staged Codex App Server remained ready after shutdown".to_owned());
        }
        Ok(())
    })
}

fn smoke_headless_runtime(runtime_root: &Path) -> Result<(), String> {
    verify_runtime_manifest_component(runtime_root, "headless")?;
    let manifest_path = runtime_root.join("manifest.json");
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            format!("read runtime manifest {}: {error}", manifest_path.display())
        })?)
        .map_err(|error| {
            format!(
                "parse runtime manifest {}: {error}",
                manifest_path.display()
            )
        })?;
    let target = manifest
        .get("components")
        .and_then(serde_json::Value::as_array)
        .and_then(|components| {
            components.iter().find(|component| {
                component.get("name").and_then(serde_json::Value::as_str) == Some("headless")
            })
        })
        .and_then(|component| component.get("target"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "runtime manifest is missing the headless target".to_owned())?;
    let executable = runtime_root.join(target);
    let output = Command::new(&executable)
        .arg("--version")
        .output()
        .map_err(|error| format!("start packaged OnPeople headless CLI: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "packaged OnPeople headless CLI exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.trim().starts_with("onpeople ") {
        return Err(format!(
            "packaged OnPeople headless CLI returned an invalid version: {}",
            stdout.trim()
        ));
    }
    Ok(())
}

fn sign_macos_runtime() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("macOS runtime signing must run on macOS".to_owned());
    }
    let identity = env::var("APPLE_SIGNING_IDENTITY")
        .or_else(|_| env::var("ONPEOPLE_CODESIGN_IDENTITY"))
        .map_err(|_| {
            "APPLE_SIGNING_IDENTITY (or ONPEOPLE_CODESIGN_IDENTITY) is required for release signing"
                .to_owned()
        })?;
    if identity.trim().is_empty() {
        return Err("macOS signing identity is empty".to_owned());
    }
    const TEAM_ID: &str = "6K4S66PVRQ";
    let root = workspace_root();
    let runtime = root.join(".embedded-runtime");
    let signed_runtime_override = env::var_os("ONPEOPLE_SIGNED_RUNTIME_OUTPUT").map(PathBuf::from);
    if signed_runtime_override.is_none() && path_is_file_provider_workspace(&root) {
        return Err(
            "release signing cannot commit into Documents/File Provider; copy the workspace to an independent staging directory or set ONPEOPLE_SIGNED_RUNTIME_OUTPUT"
                .to_owned(),
        );
    }
    let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
    let staged_runtime = temporary.path().join(".embedded-runtime");
    run_checked(
        Command::new("ditto").arg(&runtime).arg(&staged_runtime),
        "copy runtime to independent signing staging",
    )?;
    run_checked(
        Command::new("xattr")
            .args(["-c", "-r"])
            .arg(&staged_runtime),
        "clear signing staging xattrs",
    )?;
    let app = staged_runtime.join("OnPeople Browser Host.app");
    let contents = app.join("Contents");
    let framework = contents.join("Frameworks/Chromium Embedded Framework.framework");
    if !framework.is_dir() {
        return Err(format!("CEF Framework is missing: {}", framework.display()));
    }
    let helper_entitlements = root.join("packaging/macos/cef-helper.entitlements");
    let sign = |path: &Path, label: &str, entitlements: Option<&Path>| -> Result<(), String> {
        let mut command = Command::new("codesign");
        command
            .args(["--force", "--options", "runtime", "--timestamp", "--sign"])
            .arg(&identity);
        if let Some(entitlements) = entitlements {
            command.args(["--entitlements"]).arg(entitlements);
        }
        command.arg(path);
        run_checked(&mut command, label)
    };

    // These binaries are shipped as standalone runtime tools. Cua Driver's
    // upstream signature is valid inside CuaDriver.app, but extracting only
    // its executable leaves a signature that still references the missing
    // app Info.plist. Re-sign the standalone copy together with our own MCP
    // host and headless CLI so each has a valid Developer ID identity, hardened runtime, and
    // secure timestamp in the final OnPeople bundle.
    let signed_sidecars = [
        (staged_runtime.join("bin/cua-driver"), "Cua Driver sidecar"),
        (
            staged_runtime.join("bin/onpeople-mcp-host"),
            "OnPeople MCP Host sidecar",
        ),
        (
            staged_runtime.join("bin/onpeople"),
            "OnPeople headless sidecar",
        ),
    ];
    for (path, label) in &signed_sidecars {
        if !path.is_file() {
            return Err(format!("{label} is missing: {}", path.display()));
        }
        sign(path, &format!("codesign {label}"), None)?;
    }

    // Sign from the inside out. The outer Host.app must only be signed after
    // the framework and every Chromium helper has a valid sealed signature.
    for library in [
        "libEGL.dylib",
        "libvulkan.dylib",
        "libcef_sandbox.dylib",
        "libvk_swiftshader.dylib",
        "libGLESv2.dylib",
    ] {
        let path = framework.join("Libraries").join(library);
        if path.is_file() {
            sign(&path, &format!("codesign CEF {library}"), None)?;
        }
    }
    sign(&framework, "codesign CEF Framework", None)?;
    let helper_suffixes = [
        "Helper",
        "Helper (GPU)",
        "Helper (Renderer)",
        "Helper (Plugin)",
        "Helper (Alerts)",
    ];
    for suffix in helper_suffixes {
        let helper_name = format!("OnPeople Browser Host {suffix}");
        let executable = contents.join(format!(
            "Frameworks/{helper_name}.app/Contents/MacOS/{helper_name}"
        ));
        sign(
            &executable,
            &format!("codesign {helper_name} executable"),
            Some(&helper_entitlements),
        )?;
    }
    for suffix in helper_suffixes {
        let helper_name = format!("OnPeople Browser Host {suffix}");
        let helper = contents.join(format!("Frameworks/{helper_name}.app"));
        sign(
            &helper,
            &format!("codesign {helper_name}"),
            Some(&helper_entitlements),
        )?;
    }
    sign(
        &contents.join("MacOS/OnPeople Browser Host"),
        "codesign OnPeople Browser Host executable",
        None,
    )?;
    sign(&app, "codesign OnPeople Browser Host.app", None)?;
    let mut verify = Command::new("codesign");
    verify.args(["--verify", "--deep", "--strict", "--verbose=2"]);
    verify.arg(&app);
    run_checked(&mut verify, "verify signed Browser Host.app")?;

    let signed_components = signed_sidecars
        .iter()
        .map(|(path, label)| (path.clone(), (*label).to_owned()))
        .chain(std::iter::once((
            framework.clone(),
            "CEF Framework".to_owned(),
        )))
        .chain(helper_suffixes.into_iter().flat_map(|suffix| {
            let name = format!("OnPeople Browser Host {suffix}");
            let helper = contents.join(format!("Frameworks/{name}.app"));
            [
                (
                    helper.join(format!("Contents/MacOS/{name}")),
                    format!("{name} executable"),
                ),
                (helper, name),
            ]
        }))
        .chain(std::iter::once((
            contents.join("MacOS/OnPeople Browser Host"),
            "Browser Host executable".to_owned(),
        )))
        .chain(std::iter::once((
            app.clone(),
            "Browser Host.app".to_owned(),
        )));
    for (path, label) in signed_components {
        let mut details = Command::new("codesign");
        details.args(["-d", "--verbose=4"]).arg(&path);
        let output = run_capture(&mut details, &format!("codesign details {label}"))?;
        let standalone_sidecar = label.ends_with("sidecar");
        if !output.contains(&format!("TeamIdentifier={TEAM_ID}"))
            || output.contains("Signature=adhoc")
            || (!standalone_sidecar && output.contains("Info.plist=not bound"))
        {
            return Err(format!(
                "{label} is not signed by required Developer ID Team {TEAM_ID}:\n{}",
                output.trim()
            ));
        }
    }

    // Signing mutates the Mach-O bytes, so the checksum written by
    // `stage-runtime` is no longer valid. Refresh it before Tauri embeds the
    // runtime; otherwise the packaged app rejects its correctly signed host.
    let manifest_path = staged_runtime.join("manifest.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|error| format!("read runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("parse runtime manifest: {error}"))?;
    let components = manifest
        .get_mut("components")
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| "runtime manifest has no components array".to_owned())?;
    for (name, path) in [
        ("browser-host", contents.join("MacOS/OnPeople Browser Host")),
        ("cua-driver", staged_runtime.join("bin/cua-driver")),
        ("mcp-host", staged_runtime.join("bin/onpeople-mcp-host")),
        ("headless", staged_runtime.join("bin/onpeople")),
    ] {
        let component = components
            .iter_mut()
            .find(|component| {
                component.get("name").and_then(serde_json::Value::as_str) == Some(name)
            })
            .ok_or_else(|| format!("runtime manifest has no {name} component"))?;
        component["sha256"] = serde_json::Value::String(sha256(&path)?);
    }
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("serialize runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("write runtime manifest: {error}"))?;

    // Copy the completed, immutable signed tree only after every check and
    // the post-signing manifest update succeeded. A Documents/File Provider
    // checkout must point this at an external release staging directory.
    let signed_runtime = signed_runtime_override.unwrap_or_else(|| runtime.clone());
    if !signed_runtime.is_absolute()
        || signed_runtime.file_name().and_then(|name| name.to_str()) != Some(".embedded-runtime")
    {
        return Err(
            "ONPEOPLE_SIGNED_RUNTIME_OUTPUT must be an absolute path ending in .embedded-runtime"
                .to_owned(),
        );
    }
    let output_parent = signed_runtime
        .parent()
        .ok_or_else(|| "signed runtime output has no parent directory".to_owned())?;
    fs::create_dir_all(output_parent).map_err(|error| error.to_string())?;
    let signed_copy =
        output_parent.join(format!(".embedded-runtime.signed-{}", std::process::id()));
    if signed_copy.exists() {
        fs::remove_dir_all(&signed_copy).map_err(|error| error.to_string())?;
    }
    run_checked(
        Command::new("ditto").arg(&staged_runtime).arg(&signed_copy),
        "copy completed signed runtime",
    )?;
    let previous_backup =
        output_parent.join(format!(".embedded-runtime.previous-{}", std::process::id()));
    let had_previous = signed_runtime.exists();
    if had_previous {
        fs::rename(&signed_runtime, &previous_backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&signed_copy, &signed_runtime) {
        if had_previous {
            let _ = fs::rename(&previous_backup, &signed_runtime);
        }
        return Err(format!("commit signed runtime: {error}"));
    }
    if had_previous {
        fs::remove_dir_all(&previous_backup).map_err(|error| error.to_string())?;
    }
    // Documents/File Provider may attach Finder metadata while the already
    // signed tree is copied back. Extended attributes are not part of the
    // runtime payload or manifest hash, but codesign correctly rejects this
    // detritus. Clear it at the destination and verify the committed tree,
    // so a valid temporary staging result cannot mask an invalid artifact.
    run_checked(
        Command::new("xattr")
            .args(["-c", "-r"])
            .arg(&signed_runtime),
        "clear committed runtime xattrs",
    )?;
    let mut committed_verify = Command::new("codesign");
    committed_verify
        .args(["--verify", "--deep", "--strict", "--verbose=2"])
        .arg(signed_runtime.join("OnPeople Browser Host.app"));
    run_checked(
        &mut committed_verify,
        "verify committed signed Browser Host.app",
    )?;
    println!("signed runtime output: {}", signed_runtime.display());
    Ok(())
}

fn path_is_file_provider_workspace(path: &Path) -> bool {
    let text = path.to_string_lossy();
    text.contains("/Documents/")
        || text.contains("/Library/Mobile Documents/")
        || text.contains("/Library/CloudStorage/")
}

fn validate_macos_browser_host_bundle(executable: &Path) -> Result<(), String> {
    let contents = executable
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "browser-host bundle executable has an invalid path".to_owned())?;
    validate_macos_bundle_identifier(contents, "com.userinner.onpeople.browser-host")?;
    let framework = contents
        .join("Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework");
    if !framework.is_file() {
        return Err(format!(
            "staged browser-host is missing CEF Framework: {}",
            framework.display()
        ));
    }
    for suffix in [
        "Helper",
        "Helper (GPU)",
        "Helper (Renderer)",
        "Helper (Plugin)",
        "Helper (Alerts)",
    ] {
        let helper_name = format!("OnPeople Browser Host {suffix}");
        let helper_contents = contents
            .join("Frameworks")
            .join(format!("{helper_name}.app/Contents"));
        validate_macos_bundle_identifier(&helper_contents, macos_helper_bundle_identifier(suffix))?;
        let helper = helper_contents.join("MacOS").join(&helper_name);
        if !helper.is_file() {
            return Err(format!(
                "staged browser-host is missing CEF helper: {}",
                helper.display()
            ));
        }
    }
    Ok(())
}

fn validate_macos_bundle_identifier(contents: &Path, expected: &str) -> Result<(), String> {
    let plist_path = contents.join("Info.plist");
    let plist = fs::read_to_string(&plist_path)
        .map_err(|error| format!("read {}: {error}", plist_path.display()))?;
    let marker = format!("<key>CFBundleIdentifier</key>\n  <string>{expected}</string>");
    if !plist.contains(&marker) {
        return Err(format!(
            "unstable macOS bundle identifier in {}; expected {expected}",
            plist_path.display()
        ));
    }
    Ok(())
}

fn package_msix() -> Result<PathBuf, String> {
    let cross_package = !cfg!(windows);
    if cross_package && env::var("ONPEOPLE_ALLOW_CROSS_WINDOWS_BUILD").as_deref() != Ok("1") {
        return Err(
            "cross-platform MSIX packaging requires ONPEOPLE_ALLOW_CROSS_WINDOWS_BUILD=1"
                .to_owned(),
        );
    }
    let root = workspace_root();
    let release = release_dir(&root);
    let version = env::var("ONPEOPLE_MSIX_VERSION")
        .unwrap_or_else(|_| format!("{}.0", env!("CARGO_PKG_VERSION")));
    let publisher = env::var("ONPEOPLE_MSIX_PUBLISHER")
        .map_err(|_| "ONPEOPLE_MSIX_PUBLISHER is required for MSIX packaging".to_owned())?;
    let shell = release.join("onpeople-tauri.exe");
    if !shell.is_file() {
        return Err(format!("release shell is missing: {}", shell.display()));
    }
    package_contents()?;

    let bundle_dir = release.join("bundle");
    let package_dir = bundle_dir.join("msix/OnPeople");
    if package_dir.exists() {
        fs::remove_dir_all(&package_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(package_dir.join("Assets")).map_err(|error| error.to_string())?;
    fs::copy(&shell, package_dir.join("OnPeople.exe"))
        .map_err(|error| format!("copy release shell: {error}"))?;
    copy_dir_recursive(
        &root.join(".embedded-runtime"),
        &package_dir.join(".embedded-runtime"),
    )?;
    for name in [
        "StoreLogo.png",
        "Square44x44Logo.png",
        "Square150x150Logo.png",
        "Wide310x150Logo.png",
    ] {
        fs::copy(
            root.join("build/appx").join(name),
            package_dir.join("Assets").join(name),
        )
        .map_err(|error| format!("copy MSIX asset {name}: {error}"))?;
    }

    let manifest_template = fs::read_to_string(root.join("packaging/windows/AppxManifest.xml"))
        .map_err(|error| format!("read MSIX manifest template: {error}"))?;
    let manifest = manifest_template
        .replace("__PUBLISHER__", &publisher)
        .replace("__VERSION__", &version);
    fs::write(package_dir.join("AppxManifest.xml"), manifest)
        .map_err(|error| format!("write MSIX manifest: {error}"))?;
    if !package_dir
        .join(".embedded-runtime/bin/onpeople-browser-host.exe")
        .is_file()
        || !package_dir
            .join(".embedded-runtime/bin/onpeople.exe")
            .is_file()
        || !package_dir
            .join(".embedded-runtime/bin/libcef.dll")
            .is_file()
        || !package_dir.join(".embedded-runtime/bin/locales").is_dir()
    {
        return Err("MSIX staging is missing the embedded Windows CEF runtime".to_owned());
    }

    let output = bundle_dir.join(format!("OnPeople_{version}_x64.msix"));
    if output.exists() {
        fs::remove_file(&output).map_err(|error| error.to_string())?;
    }
    if cfg!(windows) {
        run_checked(
            Command::new(env::var("MAKEAPPX").unwrap_or_else(|_| "makeappx.exe".to_owned()))
                .args(["pack", "/d"])
                .arg(&package_dir)
                .args(["/p"])
                .arg(&output)
                .arg("/o"),
            "makeappx pack",
        )?;
    } else {
        run_checked(
            Command::new(
                env::var("ONPEOPLE_MAKEMSIX_BINARY").unwrap_or_else(|_| "makemsix".to_owned()),
            )
            .args(["pack", "-d"])
            .arg(&package_dir)
            .args(["-p"])
            .arg(&output),
            "makemsix pack",
        )?;
    }

    if cfg!(windows) {
        let certificate = env::var("ONPEOPLE_MSIX_CERTIFICATE")
            .map_err(|_| "ONPEOPLE_MSIX_CERTIFICATE is required for MSIX signing".to_owned())?;
        let mut sign =
            Command::new(env::var("SIGNTOOL").unwrap_or_else(|_| "signtool.exe".to_owned()));
        sign.args(["sign", "/fd", "SHA256", "/f"])
            .arg(certificate)
            .args(["/tr", "http://timestamp.digicert.com", "/td", "SHA256"]);
        if let Some(password) = env::var_os("ONPEOPLE_MSIX_CERTIFICATE_PASSWORD") {
            sign.args(["/p"]).arg(password);
        }
        sign.arg(&output);
        run_checked(&mut sign, "signtool MSIX sign")?;
    } else if let Some(script) = env::var_os("ONPEOPLE_MSIX_SIGN_SCRIPT") {
        run_checked(
            Command::new(env::var("NODE").unwrap_or_else(|_| "node".to_owned()))
                .arg(script)
                .arg(&output),
            "cross-platform MSIX sign",
        )?;
    } else if env::var("ONPEOPLE_MSIX_UNSIGNED").as_deref() == Ok("1") {
        eprintln!(
            "warning: created an unsigned MSIX; it is for local validation or Store submission only"
        );
    } else {
        return Err(
            "cross-platform MSIX signing requires ONPEOPLE_MSIX_SIGN_SCRIPT, or explicitly set ONPEOPLE_MSIX_UNSIGNED=1"
                .to_owned(),
        );
    }
    Ok(output)
}

fn package_macos_zip() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("macOS ZIP packaging must run on macOS with ditto".to_owned());
    }
    let root = workspace_root();
    let release = release_dir(&root);
    let app = release.join("bundle/macos/OnPeople.app");
    if !app.is_dir() {
        return Err(format!("macOS app bundle is missing: {}", app.display()));
    }
    let arch = env::var("ONPEOPLE_TARGET_ARCH").unwrap_or_else(|_| current_arch());
    let output = release.join(format!(
        "bundle/macos/OnPeople_{}_{}.zip",
        env!("CARGO_PKG_VERSION"),
        arch
    ));
    if output.exists() {
        fs::remove_file(&output).map_err(|error| error.to_string())?;
    }
    run_checked(
        Command::new("ditto")
            .args(["-c", "-k", "--sequesterRsrc", "--keepParent"])
            .arg(&app)
            .arg(&output),
        "ditto macOS ZIP",
    )?;
    Ok(output)
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "resource directory is missing: {}",
            source.display()
        ));
    }
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "copy {} to {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn run_checked(command: &mut Command, label: &str) -> Result<(), String> {
    let status = command
        .status()
        .map_err(|error| format!("{label} could not start: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{label} failed with status {status}"))
    }
}

fn run_capture(command: &mut Command, label: &str) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|error| format!("{label} could not start: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        Ok(format!("{stdout}{stderr}"))
    } else {
        Err(format!(
            "{label} failed with status {}: {}",
            output.status,
            format!("{stdout}{stderr}").trim()
        ))
    }
}

fn release_gate(platform: &str, arch: &str, bundle_dir: &Path) -> Result<(), String> {
    if !matches!(platform, "darwin" | "win32") {
        return Err(format!("unsupported release platform: {platform}"));
    }
    if !matches!(arch, "arm64" | "x64") {
        return Err(format!("unsupported release architecture: {arch}"));
    }
    if env::var("TAURI_SIGNING_PRIVATE_KEY")
        .ok()
        .as_ref()
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err("TAURI_SIGNING_PRIVATE_KEY is required for a release artifact".to_owned());
    }
    package_contents()?;

    let root = workspace_root();
    let release = release_dir(&root);
    let shell_candidates = [
        release.join("onpeople-tauri"),
        release.join("onpeople-tauri.exe"),
    ];
    let shell = shell_candidates
        .iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "release shell binary is missing; run tauri build first".to_owned())?;
    let shell_bytes = fs::metadata(shell)
        .map_err(|error| error.to_string())?
        .len();
    if shell_bytes > 20 * 1024 * 1024 {
        return Err(format!(
            "release shell exceeds 20 MiB: {} bytes",
            shell_bytes
        ));
    }
    if !bundle_dir.is_dir() {
        return Err(format!(
            "bundle directory is missing: {}",
            bundle_dir.display()
        ));
    }
    if platform == "darwin" {
        verify_macos_release_bundle(bundle_dir)?;
    }

    let max_bytes = match (platform, arch) {
        ("darwin", "arm64") => 389_u64 * 1024 * 1024 * 115 / 100,
        ("darwin", "x64") => 411_u64 * 1024 * 1024 * 115 / 100,
        ("win32", "x64") => 253_u64 * 1024 * 1024 * 115 / 100,
        _ => unreachable!(),
    };
    let mut artifacts = Vec::new();
    collect_release_artifacts(bundle_dir, &mut artifacts)?;
    if artifacts.is_empty() {
        return Err(format!(
            "no signed installer/archive found below {}",
            bundle_dir.display()
        ));
    }
    if platform == "win32" {
        verify_windows_release_bundle(&root, &artifacts)?;
    }
    match platform {
        "darwin" => {
            if !artifacts
                .iter()
                .any(|path| path.extension().and_then(|value| value.to_str()) == Some("dmg"))
            {
                return Err("macOS release is missing a DMG".to_owned());
            }
            if !artifacts
                .iter()
                .any(|path| path.extension().and_then(|value| value.to_str()) == Some("zip"))
            {
                return Err("macOS release is missing a ZIP".to_owned());
            }
        }
        "win32" => {
            if !artifacts
                .iter()
                .any(|path| path.extension().and_then(|value| value.to_str()) == Some("msix"))
            {
                return Err("Windows release is missing an MSIX".to_owned());
            }
            if !artifacts.iter().any(|path| {
                path.extension().and_then(|value| value.to_str()) == Some("exe")
                    && path.to_string_lossy().contains("nsis")
            }) {
                return Err("Windows release is missing an NSIS installer".to_owned());
            }
        }
        _ => unreachable!(),
    }
    for artifact in artifacts {
        let bytes = fs::metadata(&artifact)
            .map_err(|error| error.to_string())?
            .len();
        if bytes > max_bytes {
            return Err(format!(
                "{} exceeds {}% of the {} baseline: {} bytes",
                artifact.display(),
                115,
                match (platform, arch) {
                    ("darwin", "arm64") => "macOS arm64 389 MiB",
                    ("darwin", "x64") => "macOS x64 411 MiB",
                    _ => "Windows x64 253 MiB",
                },
                bytes
            ));
        }
    }
    Ok(())
}

fn verify_windows_release_bundle(root: &Path, artifacts: &[PathBuf]) -> Result<(), String> {
    if !cfg!(windows) {
        let _ = (root, artifacts);
        return Err("Windows release verification must run on Windows".to_owned());
    }
    #[cfg(windows)]
    {
        let sign_tool = env::var("SIGNTOOL").unwrap_or_else(|_| "signtool.exe".to_owned());
        let owned_binaries = [
            release_dir(root).join("onpeople-tauri.exe"),
            root.join(".embedded-runtime/bin/onpeople-browser-host.exe"),
            root.join(".embedded-runtime/bin/onpeople-mcp-host.exe"),
            root.join(".embedded-runtime/bin/onpeople.exe"),
        ];
        for path in owned_binaries {
            if !path.is_file() {
                return Err(format!(
                    "signed Windows executable is missing: {}",
                    path.display()
                ));
            }
            run_checked(
                Command::new(&sign_tool)
                    .args(["verify", "/pa", "/all", "/v"])
                    .arg(&path),
                &format!("verify Authenticode {}", path.display()),
            )?;
        }
        for artifact in artifacts.iter().filter(|path| {
            matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("exe" | "msix")
            )
        }) {
            run_checked(
                Command::new(&sign_tool)
                    .args(["verify", "/pa", "/all", "/v"])
                    .arg(artifact),
                &format!("verify signed Windows artifact {}", artifact.display()),
            )?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    unreachable!()
}

fn verify_macos_release_bundle(bundle_dir: &Path) -> Result<(), String> {
    const TEAM_ID: &str = "6K4S66PVRQ";
    let app = bundle_dir.join("macos/OnPeople.app");
    if !app.is_dir() {
        return Err(format!("macOS app bundle is missing: {}", app.display()));
    }
    let app_info_plist = app.join("Contents/Info.plist");
    let app_info = fs::read_to_string(&app_info_plist)
        .map_err(|error| format!("read {}: {error}", app_info_plist.display()))?;
    if !app_info.contains("<key>NSMicrophoneUsageDescription</key>") {
        return Err("OnPeople.app Info.plist has no microphone usage description".to_owned());
    }
    let runtime_root = app.join("Contents/Resources/.embedded-runtime");
    let host_app = runtime_root.join("OnPeople Browser Host.app");
    if !host_app.is_dir() {
        return Err(format!(
            "final app is missing Browser Host.app: {}",
            host_app.display()
        ));
    }
    if runtime_root.join("bin/onpeople-browser-host").exists() {
        return Err("final macOS app contains duplicate standalone browser-host".to_owned());
    }
    verify_runtime_manifest_component(&runtime_root, "browser-host")?;
    verify_runtime_manifest_component(&runtime_root, "headless")?;
    let info_plist = host_app.join("Contents/Info.plist");
    if !info_plist.is_file() {
        return Err("Browser Host.app has no Info.plist".to_owned());
    }
    let contents = host_app.join("Contents");
    validate_macos_browser_host_bundle(&contents.join("MacOS/OnPeople Browser Host"))?;
    let framework = contents.join("Frameworks/Chromium Embedded Framework.framework");
    let mut signed_components = vec![
        (app.clone(), "OnPeople.app".to_owned()),
        (host_app.clone(), "Browser Host.app".to_owned()),
        (framework, "CEF Framework".to_owned()),
        (
            contents.join("MacOS/OnPeople Browser Host"),
            "Browser Host executable".to_owned(),
        ),
        (
            runtime_root.join("bin/onpeople"),
            "OnPeople headless sidecar".to_owned(),
        ),
        (
            runtime_root.join("bin/onpeople-mcp-host"),
            "OnPeople MCP Host sidecar".to_owned(),
        ),
        (
            runtime_root.join("bin/cua-driver"),
            "Cua Driver sidecar".to_owned(),
        ),
    ];
    for suffix in [
        "Helper",
        "Helper (GPU)",
        "Helper (Renderer)",
        "Helper (Plugin)",
        "Helper (Alerts)",
    ] {
        let name = format!("OnPeople Browser Host {suffix}");
        let helper = contents.join(format!("Frameworks/{name}.app"));
        signed_components.push((helper.clone(), format!("{name}.app")));
        signed_components.push((
            helper.join(format!("Contents/MacOS/{name}")),
            format!("{name} executable"),
        ));
    }
    for (path, label) in &signed_components {
        let mut verify = Command::new("codesign");
        verify.args(["--verify", "--deep", "--strict", "--verbose=2"]);
        verify.arg(path);
        run_checked(&mut verify, &format!("codesign verify {label}"))?;

        let mut details = Command::new("codesign");
        details.args(["-d", "--verbose=4"]);
        details.arg(path);
        let output = run_capture(&mut details, &format!("codesign details {label}"))?;
        let standalone_sidecar = label.ends_with("sidecar");
        if output.contains("Signature=adhoc")
            || (!standalone_sidecar && output.contains("Info.plist=not bound"))
            || output.contains("flags=0x2(adhoc)")
            || !output.contains(&format!("TeamIdentifier={TEAM_ID}"))
        {
            return Err(format!(
                "{label} is not sealed by required Developer ID Team {TEAM_ID}"
            ));
        }
    }
    let mut app_entitlements = Command::new("codesign");
    app_entitlements
        .args(["-d", "--entitlements", ":-"])
        .arg(&app);
    let output = run_capture(&mut app_entitlements, "read OnPeople.app entitlements")?;
    if !output.contains("<key>com.apple.security.device.audio-input</key>") {
        return Err("OnPeople.app is missing the signed audio-input entitlement".to_owned());
    }
    for suffix in [
        "Helper",
        "Helper (GPU)",
        "Helper (Renderer)",
        "Helper (Plugin)",
        "Helper (Alerts)",
    ] {
        let name = format!("OnPeople Browser Host {suffix}");
        let helper = contents.join(format!("Frameworks/{name}.app"));
        let mut entitlements = Command::new("codesign");
        entitlements
            .args(["-d", "--entitlements", ":-"])
            .arg(helper);
        let output = run_capture(&mut entitlements, &format!("read {name} entitlements"))?;
        if output.contains("keychain-access-groups") {
            return Err(format!("{name} must not carry Keychain entitlements"));
        }
    }
    let mut spctl = Command::new("spctl");
    spctl.args(["--assess", "--type", "execute", "--verbose=4"]);
    spctl.arg(&app);
    run_checked(&mut spctl, "spctl assess OnPeople.app")?;
    let mut stapler = Command::new("stapler");
    stapler.args(["validate"]);
    stapler.arg(&app);
    run_checked(&mut stapler, "stapler validate OnPeople.app")
}

fn verify_runtime_manifest_component(runtime_root: &Path, name: &str) -> Result<(), String> {
    let canonical_root = runtime_root
        .canonicalize()
        .map_err(|error| format!("resolve final runtime root: {error}"))?;
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(runtime_root.join("manifest.json"))
            .map_err(|error| format!("read final runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("parse final runtime manifest: {error}"))?;
    let component = manifest
        .get("components")
        .and_then(serde_json::Value::as_array)
        .and_then(|components| {
            components.iter().find(|component| {
                component.get("name").and_then(serde_json::Value::as_str) == Some(name)
            })
        })
        .ok_or_else(|| format!("final runtime manifest is missing {name}"))?;
    let target = component
        .get("target")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("final runtime manifest is missing {name} target"))?;
    let path = runtime_root
        .join(target)
        .canonicalize()
        .map_err(|error| format!("resolve final runtime {name}: {error}"))?;
    if !path.is_file() || !path.starts_with(canonical_root) {
        return Err(format!("final runtime {name} target is untrusted"));
    }
    let expected = component
        .get("sha256")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("final runtime manifest is missing {name} checksum"))?;
    if sha256(&path)? != expected {
        return Err(format!(
            "final runtime {name} was modified after manifest hashing"
        ));
    }
    Ok(())
}

fn collect_release_artifacts(path: &Path, artifacts: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_release_artifacts(&entry_path, artifacts)?;
            continue;
        }
        let extension = entry_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if matches!(
            extension,
            "dmg" | "zip" | "exe" | "msi" | "msix" | "appimage"
        ) {
            artifacts.push(entry_path);
        }
    }
    Ok(())
}

fn binding_dir() -> PathBuf {
    workspace_root()
        .join("frontend")
        .join("src")
        .join("bindings")
}

fn bindings(check: bool) -> Result<(), String> {
    let target = binding_dir();
    if check {
        let temporary = tempfile::tempdir().map_err(|error| error.to_string())?;
        onpeople_types::export_types(temporary.path()).map_err(|error| error.to_string())?;
        onpeople_desktop_api::export_types(temporary.path()).map_err(|error| error.to_string())?;
        compare_dirs(temporary.path(), &target)
    } else {
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        onpeople_types::export_types(&target).map_err(|error| error.to_string())?;
        onpeople_desktop_api::export_types(&target).map_err(|error| error.to_string())
    }
}

fn compare_dirs(expected: &Path, actual: &Path) -> Result<(), String> {
    let mut expected_files = fs::read_dir(expected)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name())
        .collect::<Vec<_>>();
    expected_files.sort();
    let mut actual_files = if actual.is_dir() {
        fs::read_dir(actual)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    actual_files.sort();
    if expected_files != actual_files {
        return Err(format!(
            "generated file set differs; run `npm run bindings` (expected {:?}, found {:?})",
            expected_files, actual_files
        ));
    }
    for name in expected_files {
        let expected_path = expected.join(&name);
        let actual_path = actual.join(&name);
        let expected_text =
            fs::read_to_string(&expected_path).map_err(|error| error.to_string())?;
        let actual_text = fs::read_to_string(&actual_path).map_err(|error| error.to_string())?;
        if expected_text != actual_text {
            return Err(format!(
                "generated binding is stale: {}",
                actual_path.display()
            ));
        }
    }
    Ok(())
}

fn audit() -> Result<(), String> {
    let root = workspace_root();
    // The five legacy Pet commands were intentionally removed from the final
    // product. Keep this count synchronized with the frozen typed production
    // contract so an accidental command addition or removal fails the audit.
    if onpeople_types::COMMAND_SPECS.len() != 162 {
        return Err(format!(
            "command contract count is {}, expected 162",
            onpeople_types::COMMAND_SPECS.len()
        ));
    }
    // The legacy Pet event was removed together with the Pet UI/runtime.
    if onpeople_types::EVENT_SPECS.len() != 17 {
        return Err(format!(
            "event contract count is {}, expected 17",
            onpeople_types::EVENT_SPECS.len()
        ));
    }
    for stale in [
        "src",
        "electron-builder.yml",
        "electron-builder-store.yml",
        "src-tauri/src/tauri-bridge.js",
        "src-tauri/src/preload.cjs",
        "src-tauri/src/renderer.js",
    ] {
        if root.join(stale).exists() {
            return Err(format!("stale desktop runtime path remains: {stale}"));
        }
    }
    let package =
        fs::read_to_string(root.join("package.json")).map_err(|error| error.to_string())?;
    for forbidden in [
        "electron",
        "electron-builder",
        "electron-updater",
        "node-pty",
    ] {
        if package.to_ascii_lowercase().contains(forbidden) {
            return Err(format!(
                "package.json still contains forbidden dependency marker: {forbidden}"
            ));
        }
    }
    let production_files = [
        root.join("frontend"),
        root.join("src-tauri"),
        root.join("crates"),
    ];
    for directory in production_files {
        let mut stack = vec![directory];
        while let Some(path) = stack.pop() {
            let entries = fs::read_dir(&path).map_err(|error| error.to_string())?;
            for entry in entries {
                let entry = entry.map_err(|error| error.to_string())?;
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    stack.push(entry_path);
                } else if entry_path.extension().and_then(|value| value.to_str()) == Some("rs")
                    || entry_path.extension().and_then(|value| value.to_str()) == Some("tsx")
                    || entry_path.extension().and_then(|value| value.to_str()) == Some("ts")
                    || entry_path.file_name().and_then(|value| value.to_str())
                        == Some("package.json")
                {
                    let text =
                        fs::read_to_string(&entry_path).map_err(|error| error.to_string())?;
                    for forbidden in [
                        "window.workbench",
                        "workbench_invoke",
                        "tauri-bridge.js",
                        "node-pty",
                        "electron-updater",
                    ] {
                        if text.contains(forbidden) {
                            return Err(format!(
                                "forbidden legacy bridge marker {forbidden} in {}",
                                entry_path.display()
                            ));
                        }
                    }
                }
            }
        }
    }
    let client = fs::read_to_string(root.join("frontend/src/lib/desktopClient.ts"))
        .map_err(|error| error.to_string())?;
    if !client.contains("@tauri-apps/api/core") {
        return Err("frontend desktop client does not own the Tauri invoke boundary".to_owned());
    }
    if client.contains("invokeLegacy") || client.contains("window.workbench") {
        return Err(
            "frontend desktop client still exposes the removed compatibility bridge".to_owned(),
        );
    }
    if client.matches("@tauri-apps/").count() < 4 {
        return Err("official Tauri plugins are not all routed through desktopClient".to_owned());
    }
    for spec in onpeople_types::COMMAND_SPECS {
        let method = format!("{}:", spec.legacy_method);
        if !client.contains(&method) {
            return Err(format!(
                "desktopClient is missing the typed method for {} ({})",
                spec.legacy_method, spec.command
            ));
        }
    }

    let shell =
        fs::read_to_string(root.join("src-tauri/src/lib.rs")).map_err(|error| error.to_string())?;
    let browser_host = fs::read_to_string(root.join("crates/browser-host/src/cef_runtime.rs"))
        .map_err(|error| error.to_string())?;
    for forbidden in [
        ["use", "mock", "keychain"].join("-"),
        ["ONPEOPLE", "CEF", "USE", "MOCK", "KEYCHAIN"].join("_"),
    ] {
        if shell.contains(&forbidden) || browser_host.contains(&forbidden) {
            return Err(format!(
                "production browser source contains forbidden Keychain fallback: {forbidden}"
            ));
        }
    }
    for spec in onpeople_types::COMMAND_SPECS {
        let command_literal = format!("\"{}\"", spec.command);
        let native_function = format!("fn {}", spec.command);
        if !shell.contains(&command_literal) && !shell.contains(&native_function) {
            return Err(format!(
                "command contract is not connected to a Rust handler: {}",
                spec.command
            ));
        }
    }
    for spec in onpeople_types::EVENT_SPECS {
        if !shell.contains(&format!("\"{}\"", spec.event)) {
            return Err(format!(
                "event contract is not emitted by the shell: {}",
                spec.event
            ));
        }
        if !client.contains(&format!("\"{}\"", spec.event)) {
            return Err(format!(
                "event contract is not subscribed by desktopClient: {}",
                spec.event
            ));
        }
    }
    for forbidden in [
        "delegated",
        "requiresDialog",
        "copied: false",
        "TODO",
        "FIXME",
    ] {
        if shell.contains(forbidden) || client.contains(forbidden) {
            return Err(format!(
                "production shell still contains placeholder marker: {forbidden}"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        copy_directory_files, macos_helper_bundle_identifier, path_is_file_provider_workspace,
        validate_macos_bundle_identifier, validate_windows_cef_runtime, workspace_root,
        write_macos_info_plist,
    };

    #[test]
    fn macos_bundle_declares_signed_microphone_access() {
        let root = workspace_root();
        let info = std::fs::read_to_string(root.join("src-tauri/Info.plist"))
            .expect("read app Info.plist");
        assert!(info.contains("<key>NSMicrophoneUsageDescription</key>"));

        let entitlements = std::fs::read_to_string(root.join("build/entitlements.mac.plist"))
            .expect("read macOS entitlements");
        assert!(entitlements.contains("<key>com.apple.security.device.audio-input</key>"));

        let config = std::fs::read_to_string(root.join("src-tauri/tauri.conf.json"))
            .expect("read Tauri config");
        assert!(config.contains("Developer ID Application: Happy Metaverse Internet Technology"));
    }

    #[test]
    fn generated_browser_bundle_identifiers_are_stable() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let host = temporary.path().join("host/Contents");
        let renderer = temporary.path().join("renderer/Contents");
        std::fs::create_dir_all(&host).expect("host contents");
        std::fs::create_dir_all(&renderer).expect("renderer contents");

        write_macos_info_plist(
            &host,
            "OnPeople Browser Host",
            "com.userinner.onpeople.browser-host",
            false,
        )
        .expect("write host plist");
        write_macos_info_plist(
            &renderer,
            "OnPeople Browser Host Helper (Renderer)",
            macos_helper_bundle_identifier("Helper (Renderer)"),
            true,
        )
        .expect("write helper plist");

        validate_macos_bundle_identifier(&host, "com.userinner.onpeople.browser-host")
            .expect("stable host identifier");
        validate_macos_bundle_identifier(
            &renderer,
            macos_helper_bundle_identifier("Helper (Renderer)"),
        )
        .expect("stable helper identifier");
        assert_eq!(
            macos_helper_bundle_identifier("Helper"),
            macos_helper_bundle_identifier("Helper (GPU)")
        );
        assert!(validate_macos_bundle_identifier(&host, "onpeople_browser_host-random").is_err());
    }

    #[test]
    fn stages_complete_windows_cef_runtime() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let source = temporary.path().join("source");
        let stage = temporary.path().join("stage");
        std::fs::create_dir_all(source.join("locales")).expect("CEF source");
        for name in [
            "libcef.dll",
            "chrome_elf.dll",
            "icudtl.dat",
            "resources.pak",
            "chrome_100_percent.pak",
            "chrome_200_percent.pak",
            "v8_context_snapshot.bin",
        ] {
            std::fs::write(source.join(name), name).expect("CEF file");
        }
        std::fs::write(source.join("locales/en-US.pak"), b"locale").expect("CEF locale");
        let mut copied = Vec::new();
        copy_directory_files(&source, &stage.join("bin"), &stage, &mut copied)
            .expect("copy CEF files");
        copy_directory_files(
            &source.join("locales"),
            &stage.join("bin/locales"),
            &stage,
            &mut copied,
        )
        .expect("copy CEF locales");

        validate_windows_cef_runtime(&stage).expect("complete Windows CEF runtime");
        assert_eq!(copied.len(), 8);
    }

    #[test]
    fn detects_file_provider_release_workspaces() {
        assert!(path_is_file_provider_workspace(std::path::Path::new(
            "/Users/test/Documents/OnPeople"
        )));
        assert!(path_is_file_provider_workspace(std::path::Path::new(
            "/Users/test/Library/CloudStorage/Drive/OnPeople"
        )));
        assert!(!path_is_file_provider_workspace(std::path::Path::new(
            "/private/tmp/OnPeople"
        )));
    }
}
