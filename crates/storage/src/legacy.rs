use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tracing::warn;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    keychain::{Keychain, decrypt_legacy_safe_storage_value},
    migrations,
    paths::DataPaths,
};
use onpeople_types::BrowserImportResult;
use onpeople_types::{AppError, ErrorCode};

const JSON_SOURCES: &[&str] = &[
    "p0-settings.json",
    "provider-settings.json",
    "thread-provider-settings.json",
    "thread-ui-state.json",
    "scheduled-tasks.json",
    "agent-profiles.json",
    "agent-task-board.json",
    "local-memories.json",
    "usage-ledger.json",
    "browser-annotations.json",
    "industry-plugin-state.json",
    "cloud-account.json",
    "runtime-sessions.json",
];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MigrationJournal {
    pub schema: u32,
    pub status: MigrationStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub imported_sources: Vec<String>,
    pub warnings: Vec<String>,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MigrationStatus {
    Started,
    Committed,
    RolledBack,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct LegacyImportReport {
    pub sources_seen: u64,
    pub sources_imported: u64,
    pub credentials_imported: u64,
    pub leveldb_keys_imported: u64,
    pub browser_files_imported: u64,
    pub warnings: Vec<String>,
    #[serde(skip)]
    keychain_refs: Vec<String>,
}

pub fn initialize_new_database(paths: &DataPaths) -> Result<LegacyImportReport, AppError> {
    paths.ensure_private()?;
    let backup_path = write_backup_manifest(paths)?;
    let started_at = chrono::Utc::now().to_rfc3339();
    write_journal(
        paths,
        &MigrationJournal {
            schema: 1,
            status: MigrationStatus::Started,
            started_at: started_at.clone(),
            finished_at: None,
            imported_sources: Vec::new(),
            warnings: Vec::new(),
            backup_path: Some(backup_path.to_string_lossy().into_owned()),
        },
    )?;

    let migration_id = Uuid::now_v7();
    let temporary_db = paths.root.join(format!("onpeople.db.tmp-{migration_id}"));
    let temporary_profile = paths.root.join(format!("cef-profile.tmp-{migration_id}"));
    let mut report = LegacyImportReport::default();
    let result = (|| {
        let mut connection = Connection::open(&temporary_db).map_err(AppError::storage)?;
        migrations::apply(&mut connection).map_err(AppError::storage)?;
        {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(AppError::storage)?;
            import_json_sources(paths, &transaction, &mut report)?;
            import_leveldb_keys(paths, &transaction, &mut report)?;
            transaction
                .execute(
                    "INSERT OR REPLACE INTO metadata(key,value_json,updated_at)
                     VALUES('migration',?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    [
                        serde_json::to_string(&json!({ "version": 1, "report": report }))
                            .map_err(AppError::internal)?,
                    ],
                )
                .map_err(AppError::storage)?;
            transaction.commit().map_err(AppError::storage)?;
        }
        connection
            .close()
            .map_err(|(_, error)| AppError::storage(error))?;

        if paths.database.exists() {
            return Err(AppError::new(
                ErrorCode::Conflict,
                "OnPeople 数据库已存在，拒绝覆盖",
            ));
        }
        let staged_profile = stage_browser_profile(paths, &temporary_profile, &mut report)?;
        if staged_profile {
            fs::rename(&temporary_profile, &paths.cef_profile).map_err(|error| {
                AppError::new(ErrorCode::Migration, "无法提交 Chromium Profile 迁移")
                    .context("cause", error)
            })?;
        }
        if let Err(error) = fs::rename(&temporary_db, &paths.database) {
            if staged_profile {
                let _ = fs::remove_dir_all(&paths.cef_profile);
            }
            return Err(
                AppError::new(ErrorCode::Migration, "无法原子提交 OnPeople 数据库")
                    .context("cause", error),
            );
        }
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temporary_db);
        let _ = fs::remove_dir_all(&temporary_profile);
        let keychain = Keychain::new(&paths.secrets_namespace);
        for reference in &report.keychain_refs {
            let _ = keychain.delete(reference);
        }
        write_journal(
            paths,
            &MigrationJournal {
                schema: 1,
                status: MigrationStatus::RolledBack,
                started_at,
                finished_at: Some(chrono::Utc::now().to_rfc3339()),
                imported_sources: Vec::new(),
                warnings: vec![error.message.clone()],
                backup_path: Some(backup_path.to_string_lossy().into_owned()),
            },
        )?;
        return Err(error);
    }

    write_journal(
        paths,
        &MigrationJournal {
            schema: 1,
            status: MigrationStatus::Committed,
            started_at,
            finished_at: Some(chrono::Utc::now().to_rfc3339()),
            imported_sources: JSON_SOURCES
                .iter()
                .filter(|source| paths.legacy_json(source).is_file())
                .map(|source| (*source).to_owned())
                .collect(),
            warnings: report.warnings.clone(),
            backup_path: Some(backup_path.to_string_lossy().into_owned()),
        },
    )?;
    Ok(report)
}

pub fn resume_or_validate(paths: &DataPaths, connection: &mut Connection) -> Result<(), AppError> {
    migrations::apply(connection).map_err(AppError::storage)?;
    if let Ok(journal) = read_journal(paths) {
        if journal.status == MigrationStatus::Started {
            warn!("found interrupted OnPeople migration; committed database is authoritative");
            let mut repaired = journal;
            repaired.status = MigrationStatus::Committed;
            repaired.finished_at = Some(chrono::Utc::now().to_rfc3339());
            repaired
                .warnings
                .push("检测到上次迁移中断，已验证并继续使用已提交数据库".to_owned());
            write_journal(paths, &repaired)?;
        }
    }
    Ok(())
}

fn import_json_sources(
    paths: &DataPaths,
    transaction: &Transaction<'_>,
    report: &mut LegacyImportReport,
) -> Result<(), AppError> {
    for source in JSON_SOURCES {
        let path = paths.legacy_json(source);
        if !path.is_file() {
            continue;
        }
        report.sources_seen += 1;
        let raw = fs::read_to_string(&path).map_err(|error| {
            AppError::new(ErrorCode::Migration, "无法读取旧版数据文件")
                .context("source", source)
                .context("cause", error)
        })?;
        let value: Value = serde_json::from_str(&raw).map_err(|error| {
            AppError::new(ErrorCode::Migration, "旧版数据文件不是有效 JSON")
                .context("source", source)
                .context("cause", error)
        })?;
        let checksum = hex::encode(Sha256::digest(raw.as_bytes()));
        let mtime = fs::metadata(&path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);
        transaction
            .execute(
                "INSERT OR REPLACE INTO legacy_documents(name,value_json,source_mtime,imported_at)
                 VALUES(?1,?2,?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![source, raw, mtime],
            )
            .map_err(AppError::storage)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO migration_items(source,checksum,imported_at)
                 VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![source, checksum],
            )
            .map_err(AppError::storage)?;
        normalize_legacy_document(source, &value, transaction, report)?;
        report.sources_imported += 1;
    }
    Ok(())
}

fn normalize_legacy_document(
    source: &str,
    value: &Value,
    transaction: &Transaction<'_>,
    report: &mut LegacyImportReport,
) -> Result<(), AppError> {
    let serialized = serde_json::to_string(value).map_err(AppError::internal)?;
    match source {
        "p0-settings.json" => {
            let preferences = value.get("preferences").unwrap_or(value);
            transaction
                .execute(
                    "INSERT OR REPLACE INTO preferences(id,value_json,updated_at)
                     VALUES(1,?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    [serde_json::to_string(preferences).map_err(AppError::internal)?],
                )
                .map_err(AppError::storage)?;
        }
        "provider-settings.json" | "thread-provider-settings.json" => {
            import_providers(value, transaction, report)?;
        }
        "scheduled-tasks.json" => {
            import_array_table(
                "scheduled_tasks",
                value.get("tasks").unwrap_or(value),
                transaction,
            )?;
            import_scheduled_runs(value.get("runs"), transaction)?;
        }
        "agent-profiles.json" => import_array_table(
            "agent_profiles",
            value.get("profiles").unwrap_or(value),
            transaction,
        )?,
        "agent-task-board.json" => import_array_table(
            "agent_tasks",
            value.get("tasks").unwrap_or(value),
            transaction,
        )?,
        "local-memories.json" => import_array_table(
            "memories",
            value.get("memories").unwrap_or(value),
            transaction,
        )?,
        "usage-ledger.json" => {
            transaction
                .execute(
                    "INSERT OR REPLACE INTO usage(id,value_json,updated_at)
                     VALUES('legacy',?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    [&serialized],
                )
                .map_err(AppError::storage)?;
        }
        "thread-ui-state.json" => import_ui_state(value, transaction)?,
        "browser-annotations.json"
        | "industry-plugin-state.json"
        | "cloud-account.json"
        | "runtime-sessions.json" => {
            transaction
                .execute(
                    "INSERT OR REPLACE INTO metadata(key,value_json,updated_at)
                     VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    params![source, serialized],
                )
                .map_err(AppError::storage)?;
        }
        _ => {}
    }
    Ok(())
}

fn import_providers(
    value: &Value,
    transaction: &Transaction<'_>,
    report: &mut LegacyImportReport,
) -> Result<(), AppError> {
    let records: Vec<(String, &Value)> = if value.get("type").is_some() {
        vec![(
            value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("onpeople")
                .to_owned(),
            value,
        )]
    } else {
        value
            .as_object()
            .map(|object| {
                object
                    .iter()
                    .filter(|(_, item)| item.is_object())
                    .map(|(kind, item)| (kind.clone(), item))
                    .collect()
            })
            .unwrap_or_default()
    };
    for (kind, provider) in records {
        let secret_ref = import_secret_value(&kind, provider, transaction, report)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO providers(scope,kind,value_json,secret_ref,updated_at)
                 VALUES('global',?1,?2,?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![
                    kind,
                    serde_json::to_string(provider).map_err(AppError::internal)?,
                    secret_ref
                ],
            )
            .map_err(AppError::storage)?;
    }
    Ok(())
}

fn import_array_table(
    table: &str,
    value: &Value,
    transaction: &Transaction<'_>,
) -> Result<(), AppError> {
    let values = value.as_array().cloned().unwrap_or_default();
    for (index, item) in values.into_iter().enumerate() {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("legacy-{table}-{index}"));
        let serialized = serde_json::to_string(&item).map_err(AppError::internal)?;
        match table {
            "scheduled_tasks" => transaction.execute(
                "INSERT OR REPLACE INTO scheduled_tasks(id,value_json,updated_at)
                     VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![id, serialized],
            ),
            "agent_profiles" => transaction.execute(
                "INSERT OR REPLACE INTO agent_profiles(id,value_json,updated_at)
                     VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![id, serialized],
            ),
            "agent_tasks" => transaction.execute(
                "INSERT OR REPLACE INTO agent_tasks(id,value_json,updated_at)
                     VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![id, serialized],
            ),
            "memories" => transaction.execute(
                "INSERT OR REPLACE INTO memories(id,cwd,value_json,updated_at)
                     VALUES(?1,?2,?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![
                    id,
                    item.get("cwd").and_then(Value::as_str).unwrap_or(""),
                    serialized
                ],
            ),
            _ => {
                return Err(AppError::invalid("未知的迁移表"));
            }
        }
        .map_err(AppError::storage)?;
    }
    Ok(())
}

fn import_scheduled_runs(
    value: Option<&Value>,
    transaction: &Transaction<'_>,
) -> Result<(), AppError> {
    let Some(runs) = value.and_then(Value::as_array) else {
        return Ok(());
    };
    for (index, run) in runs.iter().enumerate() {
        let id = run
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("legacy-run-{index}"));
        let task_id = run
            .get("taskId")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let started_at = run
            .get("startedAt")
            .and_then(Value::as_str)
            .unwrap_or("1970-01-01T00:00:00Z");
        transaction
            .execute(
                "INSERT OR IGNORE INTO scheduled_runs(id,task_id,value_json,started_at)
                 VALUES(?1,?2,?3,?4)",
                params![
                    id,
                    task_id,
                    serde_json::to_string(run).map_err(AppError::internal)?,
                    started_at
                ],
            )
            .map_err(AppError::storage)?;
    }
    Ok(())
}

fn import_ui_state(value: &Value, transaction: &Transaction<'_>) -> Result<(), AppError> {
    let object = value.as_object().cloned().unwrap_or_default();
    for key in ["browserTabs", "utilityWidth", "terminalHeight"] {
        if let Some(item) = object.get(key) {
            transaction
                .execute(
                    "INSERT OR REPLACE INTO window_state(key,value_json,updated_at)
                     VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    params![
                        key,
                        serde_json::to_string(item).map_err(AppError::internal)?
                    ],
                )
                .map_err(AppError::storage)?;
        }
    }
    Ok(())
}

fn import_secret_value(
    kind: &str,
    provider: &Value,
    transaction: &Transaction<'_>,
    report: &mut LegacyImportReport,
) -> Result<Option<String>, AppError> {
    let encrypted = provider
        .get("encryptedApiKey")
        .and_then(Value::as_str)
        .or_else(|| provider.get("encryptedAccessToken").and_then(Value::as_str));
    let Some(encrypted) = encrypted else {
        return Ok(None);
    };
    let Some(clear) = decrypt_legacy_safe_storage_value(encrypted)? else {
        report
            .warnings
            .push(format!("无法解密旧版 {kind} 凭据；已保留元数据"));
        return Ok(None);
    };
    let reference = format!("legacy/{kind}/{}", Uuid::now_v7());
    let keychain = Keychain::new("com.userinner.onpeople");
    keychain.set(&reference, &clear)?;
    report.keychain_refs.push(reference.clone());
    transaction
        .execute(
            "INSERT OR REPLACE INTO secrets(id,name,scope,keychain_ref,metadata_json,updated_at)
             VALUES(?1,?2,'provider',?3,?4,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                Uuid::now_v7().to_string(),
                kind,
                reference,
                json!({ "migrated": true }).to_string()
            ],
        )
        .map_err(AppError::storage)?;
    report.credentials_imported += 1;
    Ok(Some(reference))
}

fn import_leveldb_keys(
    paths: &DataPaths,
    transaction: &Transaction<'_>,
    report: &mut LegacyImportReport,
) -> Result<(), AppError> {
    let roots = [
        paths.root.join("Local Storage").join("leveldb"),
        paths.root.join("Session Storage"),
    ];
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        for entry in WalkDir::new(root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let mut bytes = Vec::new();
            if fs::File::open(entry.path())
                .and_then(|mut file| file.read_to_end(&mut bytes))
                .is_err()
            {
                continue;
            }
            for key in [
                "onpeople.browser-tabs.v1",
                "onpeople.utility-width",
                "onpeople.terminal-height",
            ] {
                if let Some(value) = find_json_after_marker(&bytes, key.as_bytes()) {
                    transaction
                        .execute(
                            "INSERT OR REPLACE INTO window_state(key,value_json,updated_at)
                             VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                            params![key, value],
                        )
                        .map_err(AppError::storage)?;
                    report.leveldb_keys_imported += 1;
                }
            }
        }
    }
    Ok(())
}

fn find_json_after_marker(bytes: &[u8], marker: &[u8]) -> Option<String> {
    let start = bytes
        .windows(marker.len())
        .position(|window| window == marker)?
        + marker.len();
    let rest = &bytes[start..];
    let start_value = rest.iter().position(|byte| {
        *byte == b'{' || *byte == b'[' || byte.is_ascii_digit() || *byte == b'"'
    })?;
    let candidate = &rest[start_value..];
    if candidate[0] == b'{' || candidate[0] == b'[' {
        let close = if candidate[0] == b'{' { b'}' } else { b']' };
        let end = candidate.iter().position(|byte| *byte == close)? + 1;
        return Some(String::from_utf8_lossy(&candidate[..end]).to_string());
    }
    let end = candidate
        .iter()
        .position(|byte| *byte == 0 || *byte == b'\n')
        .unwrap_or(candidate.len());
    Some(
        String::from_utf8_lossy(&candidate[..end])
            .trim_matches(char::from(0))
            .to_string(),
    )
}

fn stage_browser_profile(
    paths: &DataPaths,
    temporary: &Path,
    report: &mut LegacyImportReport,
) -> Result<bool, AppError> {
    if !paths.browser_partition.is_dir() || paths.cef_profile.exists() {
        return Ok(false);
    }
    copy_stateful_profile(&paths.browser_partition, temporary, report)?;
    Ok(true)
}

fn copy_stateful_profile(
    source: &Path,
    target: &Path,
    report: &mut LegacyImportReport,
) -> Result<(), AppError> {
    for entry in WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(AppError::internal)?;
        if relative.components().any(|component| {
            matches!(
                component.as_os_str().to_str(),
                Some(
                    "Cache"
                        | "Code Cache"
                        | "GPUCache"
                        | "DawnGraphiteCache"
                        | "DawnWebGPUCache"
                        | "GrShaderCache"
                )
            )
        }) {
            continue;
        }
        let destination = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination).map_err(AppError::storage)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(AppError::storage)?;
            }
            fs::copy(entry.path(), &destination).map_err(AppError::storage)?;
            report.browser_files_imported += 1;
        }
    }
    Ok(())
}

pub fn import_chromium_profile(
    source: &Path,
    target: &Path,
    include_passwords: bool,
) -> Result<BrowserImportResult, AppError> {
    let source = source.canonicalize().map_err(AppError::storage)?;
    if !source.is_dir() {
        return Err(AppError::invalid("浏览器 Profile 必须是目录"));
    }
    if target.exists() {
        return Err(AppError::new(
            ErrorCode::Conflict,
            "目标浏览器 Profile 已存在",
        ));
    }
    let mut report = LegacyImportReport::default();
    for entry in WalkDir::new(&source)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let relative = entry
            .path()
            .strip_prefix(&source)
            .map_err(AppError::internal)?;
        if relative.components().any(|component| {
            matches!(
                component.as_os_str().to_str(),
                Some(
                    "Cache"
                        | "Code Cache"
                        | "GPUCache"
                        | "DawnGraphiteCache"
                        | "DawnWebGPUCache"
                        | "GrShaderCache"
                )
            )
        }) {
            continue;
        }
        if !include_passwords
            && relative
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| {
                    matches!(value, "Login Data" | "Login Data For Account" | "Web Data")
                })
        {
            report
                .warnings
                .push(format!("已跳过凭据数据库 {}", relative.display()));
            continue;
        }
        let destination = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&destination).map_err(AppError::storage)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(AppError::storage)?;
            }
            fs::copy(entry.path(), &destination).map_err(AppError::storage)?;
            report.browser_files_imported += 1;
        }
    }
    let credentials = u64::from(include_passwords && target.join("Login Data").is_file());
    Ok(BrowserImportResult {
        cookies: u64::from(target.join("Cookies").is_file()),
        storage_files: report.browser_files_imported,
        credentials,
        skipped: report.warnings.len() as u64,
    })
}

fn write_backup_manifest(paths: &DataPaths) -> Result<PathBuf, AppError> {
    let backup = paths.migration_backup.join("pre-0.30.0");
    fs::create_dir_all(&backup).map_err(AppError::storage)?;
    let mut sources = Vec::new();
    for source in JSON_SOURCES {
        let path = paths.legacy_json(source);
        if path.is_file() {
            let bytes = fs::read(&path).map_err(AppError::storage)?;
            sources.push(json!({
                "path": source,
                "size": bytes.len(),
                "sha256": hex::encode(Sha256::digest(&bytes)),
            }));
        }
    }
    let manifest = backup.join("manifest.json");
    let temporary = backup.join("manifest.json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&json!({
            "version": "0.29.27",
            "createdAt": chrono::Utc::now(),
            "sources": sources,
            "originalsRetained": true,
            "codexHomeRetainedInPlace": paths.codex_home,
            "browserPartitionRetainedInPlace": paths.browser_partition,
        }))
        .map_err(AppError::internal)?,
    )
    .map_err(AppError::storage)?;
    fs::rename(temporary, &manifest).map_err(AppError::storage)?;
    Ok(manifest)
}

fn write_journal(paths: &DataPaths, journal: &MigrationJournal) -> Result<(), AppError> {
    let temporary = paths.journal.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(journal).map_err(AppError::internal)?,
    )
    .map_err(AppError::storage)?;
    fs::rename(temporary, &paths.journal).map_err(AppError::storage)
}

fn read_journal(paths: &DataPaths) -> Result<MigrationJournal, AppError> {
    let raw = fs::read_to_string(&paths.journal).map_err(AppError::storage)?;
    serde_json::from_str(&raw).map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::{MigrationStatus, find_json_after_marker, initialize_new_database};
    use crate::DataPaths;
    use rusqlite::Connection;
    use tempfile::tempdir;

    #[test]
    fn extracts_leveldb_json_value() {
        let bytes = b"prefix-onpeople.browser-tabs.v1\x00[{\"id\":\"a\"}]suffix";
        assert_eq!(
            find_json_after_marker(bytes, b"onpeople.browser-tabs.v1").as_deref(),
            Some("[{\"id\":\"a\"}]")
        );
    }

    #[test]
    fn migrates_into_wal_database_and_skips_browser_caches() {
        let root = tempdir().expect("temporary migration root");
        let paths = DataPaths::from_root(root.path().to_path_buf()).expect("data paths");
        std::fs::write(
            paths.legacy_json("p0-settings.json"),
            r#"{"preferences":{"theme":"dark","utilityWidth":640}}"#,
        )
        .expect("legacy settings");
        let source_profile = paths.browser_partition.join("Default");
        std::fs::create_dir_all(source_profile.join("Cache")).expect("cache");
        std::fs::create_dir_all(&source_profile).expect("profile");
        std::fs::write(source_profile.join("Cookies"), b"cookie-state").expect("cookies");
        std::fs::write(source_profile.join("Cache").join("ignored"), b"cache").expect("cache file");

        let report = initialize_new_database(&paths).expect("migration succeeds");
        assert_eq!(report.sources_imported, 1);
        assert!(paths.database.is_file());
        assert!(paths.cef_profile.join("Default/Cookies").is_file());
        assert!(!paths.cef_profile.join("Default/Cache/ignored").exists());

        let connection = Connection::open(&paths.database).expect("database");
        let journal_mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("wal mode");
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
        let preferences: String = connection
            .query_row("SELECT value_json FROM preferences WHERE id=1", [], |row| {
                row.get(0)
            })
            .expect("preferences imported");
        assert!(preferences.contains("dark"));
        let journal: super::MigrationJournal =
            serde_json::from_str(&std::fs::read_to_string(&paths.journal).expect("journal"))
                .expect("journal json");
        assert_eq!(journal.status, MigrationStatus::Committed);
        assert!(
            paths
                .migration_backup
                .join("pre-0.30.0/manifest.json")
                .is_file()
        );
        assert!(initialize_new_database(&paths).is_err());
    }
}
