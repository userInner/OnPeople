use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
    sync::Arc,
};

use chrono::Utc;
use onpeople_types::{
    AppError, Preferences, ProjectSummary, ProviderKind, ProviderSettings, SecretMetadata,
    ThreadFilters, ThreadList, ThreadSummary,
};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::{DataPaths, Keychain, legacy, migrations};

#[derive(Clone)]
pub struct Storage {
    paths: DataPaths,
    connection: Arc<Mutex<Connection>>,
    keychain: Keychain,
}

impl Storage {
    pub fn open(root: Option<std::path::PathBuf>) -> Result<Self, AppError> {
        let root = match root {
            Some(root) => root,
            None => crate::stable_data_root()?,
        };
        let paths = DataPaths::from_root(root)?;
        paths.ensure_private()?;
        if !paths.database.exists() {
            legacy::initialize_new_database(&paths)?;
        }
        let mut connection = Connection::open(&paths.database).map_err(AppError::storage)?;
        legacy::resume_or_validate(&paths, &mut connection)?;
        Ok(Self {
            keychain: Keychain::new(paths.secrets_namespace.clone()),
            paths,
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn open_empty(root: std::path::PathBuf) -> Result<Self, AppError> {
        let paths = DataPaths::from_root(root)?;
        paths.ensure_private()?;
        let mut connection = Connection::open(&paths.database).map_err(AppError::storage)?;
        migrations::apply(&mut connection).map_err(AppError::storage)?;
        Ok(Self {
            keychain: Keychain::new(paths.secrets_namespace.clone()),
            paths,
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    #[must_use]
    pub const fn paths(&self) -> &DataPaths {
        &self.paths
    }

    #[must_use]
    pub const fn keychain(&self) -> &Keychain {
        &self.keychain
    }

    pub fn get_preferences(&self) -> Result<Preferences, AppError> {
        let connection = self.connection.lock();
        let raw: Option<String> = connection
            .query_row("SELECT value_json FROM preferences WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::storage)?;
        match raw {
            Some(value) => serde_json::from_str(&value).or_else(|_| {
                let legacy: Value = serde_json::from_str(&value).map_err(AppError::internal)?;
                let mut preferences = Preferences::default();
                apply_legacy_preferences(&mut preferences, &legacy);
                Ok(preferences)
            }),
            None => Ok(Preferences::default()),
        }
    }

    pub fn save_preferences(&self, preferences: &Preferences) -> Result<Preferences, AppError> {
        let json = serde_json::to_string(preferences).map_err(AppError::internal)?;
        self.connection
            .lock()
            .execute(
                "INSERT OR REPLACE INTO preferences(id,value_json,updated_at)
                 VALUES(1,?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                [json],
            )
            .map_err(AppError::storage)?;
        Ok(preferences.clone())
    }

    pub fn list_threads(&self, filters: &ThreadFilters) -> Result<ThreadList, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT value_json FROM threads
                 WHERE (?1 OR json_extract(value_json,'$.archived') = 0)
                 AND (?2 = '' OR lower(value_json) LIKE '%' || lower(?2) || '%')
                 AND (?3 IS NULL OR COALESCE(
                    json_extract(value_json,'$.projectPath'),
                    json_extract(value_json,'$.cwd')
                 ) = ?3)
                 ORDER BY updated_at DESC LIMIT ?4",
            )
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map(
                params![
                    filters.archived,
                    filters.query,
                    filters.project_path.as_deref(),
                    i64::from(filters.limit.min(1_000))
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(AppError::storage)?;
        let mut threads = Vec::new();
        for row in rows {
            let value = row.map_err(AppError::storage)?;
            if let Ok(thread) = serde_json::from_str::<ThreadSummary>(&value) {
                threads.push(thread);
            }
        }
        let isolated_paths = threads
            .iter()
            .filter(|thread| thread.workspace_mode == "isolated")
            .flat_map(|thread| {
                thread
                    .project_path
                    .iter()
                    .chain(std::iter::once(&thread.cwd))
            })
            .cloned()
            .collect::<HashSet<_>>();
        let mut projects = BTreeMap::<String, ProjectSummary>::new();
        drop(statement);
        let mut statement = connection
            .prepare(
                "SELECT path,name,pinned,hidden,updated_at
                 FROM project_preferences
                 WHERE explicit = 1
                 ORDER BY pinned DESC, updated_at DESC",
            )
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(AppError::storage)?;
        for row in rows {
            let (path, name, pinned, hidden, updated_at) = row.map_err(AppError::storage)?;
            if isolated_paths.contains(&path) {
                continue;
            }
            if hidden {
                projects.remove(&path);
                continue;
            }
            let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_at)
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let project = projects.entry(path.clone()).or_insert(ProjectSummary {
                path,
                name: name.clone(),
                pinned,
                hidden,
                thread_count: 0,
                archived_thread_count: 0,
                updated_at,
            });
            project.name = name;
            project.pinned = pinned;
            project.hidden = hidden;
            project.updated_at = project.updated_at.max(updated_at);
        }
        drop(statement);
        for thread in &threads {
            if thread.workspace_mode == "isolated" {
                continue;
            }
            let path = thread
                .project_path
                .as_deref()
                .unwrap_or(thread.cwd.as_str());
            let Some(project) = projects.get_mut(path) else {
                continue;
            };
            project.thread_count = project.thread_count.saturating_add(1);
            if thread.archived {
                project.archived_thread_count = project.archived_thread_count.saturating_add(1);
            }
            project.updated_at = project.updated_at.max(thread.updated_at);
        }
        let mut projects = projects.into_values().collect::<Vec<_>>();
        projects.sort_by_key(|project| (Reverse(project.pinned), Reverse(project.updated_at)));
        Ok(ThreadList { threads, projects })
    }

    pub fn update_project(
        &self,
        path: &str,
        action: &str,
        value: Option<&Value>,
    ) -> Result<Value, AppError> {
        if path.trim().is_empty() {
            return Err(AppError::invalid("项目路径不能为空"));
        }
        let default_name = Path::new(path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("项目")
            .to_owned();
        let connection = self.connection.lock();
        let current: Option<(String, bool, bool)> = connection
            .query_row(
                "SELECT name,pinned,hidden FROM project_preferences WHERE path=?1",
                [path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(AppError::storage)?;
        let (mut name, mut pinned, mut hidden) = current.unwrap_or((default_name, false, false));
        match action {
            "rename" => {
                name = value
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| AppError::invalid("项目名称不能为空"))?
                    .to_owned();
            }
            "pin" => pinned = value.and_then(Value::as_bool).unwrap_or(true),
            "remove" => hidden = true,
            "add" | "restore" => hidden = false,
            _ => return Err(AppError::invalid("未知的项目操作")),
        }
        let updated_at = Utc::now().to_rfc3339();
        connection
            .execute(
                "INSERT OR REPLACE INTO project_preferences(path,name,pinned,hidden,updated_at,explicit)
                 VALUES(?1,?2,?3,?4,?5,1)",
                params![path, name, pinned, hidden, updated_at],
            )
            .map_err(AppError::storage)?;
        Ok(json!({
            "path": path,
            "name": name,
            "pinned": pinned,
            "hidden": hidden,
            "updatedAt": updated_at,
        }))
    }

    pub fn upsert_thread(&self, thread: &ThreadSummary) -> Result<(), AppError> {
        let json = serde_json::to_string(thread).map_err(AppError::internal)?;
        self.connection
            .lock()
            .execute(
                "INSERT OR REPLACE INTO threads(id,value_json,created_at,updated_at)
                 VALUES(?1,?2,?3,?4)",
                params![
                    thread.id,
                    json,
                    thread.created_at.to_rfc3339(),
                    thread.updated_at.to_rfc3339()
                ],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }

    pub fn update_thread_json(&self, id: &str, value: &Value) -> Result<(), AppError> {
        let json = serde_json::to_string(value).map_err(AppError::internal)?;
        let now = chrono::Utc::now().to_rfc3339();
        self.connection
            .lock()
            .execute(
                "INSERT OR REPLACE INTO threads(id,value_json,created_at,updated_at)
                 VALUES(?1,?2,COALESCE((SELECT created_at FROM threads WHERE id=?1),?3),?3)",
                params![id, json, now],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }

    pub fn thread_json(&self, id: &str) -> Result<Option<Value>, AppError> {
        let connection = self.connection.lock();
        let raw: Option<String> = connection
            .query_row("SELECT value_json FROM threads WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::storage)?;
        raw.map(|value| serde_json::from_str(&value).map_err(AppError::internal))
            .transpose()
    }

    pub fn upsert_timeline_item(
        &self,
        thread_id: &str,
        turn_id: Option<&str>,
        item_id: &str,
        sequence: i64,
        value: &Value,
        timestamp: Option<&str>,
    ) -> Result<(), AppError> {
        if thread_id.trim().is_empty() || item_id.trim().is_empty() {
            return Ok(());
        }
        let value_json = serde_json::to_string(value).map_err(AppError::internal)?;
        let timestamp = timestamp
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        self.connection
            .lock()
            .execute(
                "INSERT INTO timeline_items(
                   thread_id,item_id,turn_id,sequence,value_json,created_at,updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?6)
                 ON CONFLICT(thread_id,item_id) DO UPDATE SET
                   turn_id=COALESCE(excluded.turn_id,timeline_items.turn_id),
                   sequence=MIN(timeline_items.sequence,excluded.sequence),
                   value_json=json_patch(timeline_items.value_json,excluded.value_json),
                   updated_at=excluded.updated_at",
                params![thread_id, item_id, turn_id, sequence, value_json, timestamp],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }

    pub fn timeline_items(&self, thread_id: &str) -> Result<Vec<Value>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT turn_id,sequence,value_json,created_at,updated_at
                 FROM timeline_items
                 WHERE thread_id=?1
                 ORDER BY sequence ASC, created_at ASC
                 LIMIT 4000",
            )
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([thread_id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(AppError::storage)?;
        let mut items = Vec::new();
        for row in rows {
            let (turn_id, sequence, value_json, created_at, updated_at) =
                row.map_err(AppError::storage)?;
            let item = serde_json::from_str::<Value>(&value_json).map_err(AppError::internal)?;
            items.push(json!({
                "turnId": turn_id,
                "sequence": sequence,
                "item": item,
                "timestamp": updated_at,
                "createdAt": created_at,
            }));
        }
        Ok(items)
    }

    pub fn list_documents(&self, collection: &str) -> Result<Vec<Value>, AppError> {
        let table = document_table(collection)?;
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT value_json FROM {table} ORDER BY updated_at DESC"
            ))
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::storage)?;
        rows.map(|row| {
            let value = row.map_err(AppError::storage)?;
            serde_json::from_str(&value).map_err(AppError::internal)
        })
        .collect()
    }

    pub fn list_memories(&self, cwd: Option<&str>) -> Result<Vec<Value>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT value_json FROM memories
                 WHERE (?1 IS NULL AND cwd = '')
                    OR (?1 IS NOT NULL AND (cwd = '' OR cwd = ?1))
                 ORDER BY updated_at DESC",
            )
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([cwd], |row| row.get::<_, String>(0))
            .map_err(AppError::storage)?;
        rows.map(|row| {
            let value = row.map_err(AppError::storage)?;
            serde_json::from_str(&value).map_err(AppError::internal)
        })
        .collect()
    }

    pub fn save_document(&self, collection: &str, id: &str, value: &Value) -> Result<(), AppError> {
        let table = document_table(collection)?;
        let json = serde_json::to_string(value).map_err(AppError::internal)?;
        let now = chrono::Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        match table {
            "memories" => {
                let cwd = value
                    .get("cwd")
                    .or_else(|| value.get("projectPath"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                connection.execute(
                    "INSERT OR REPLACE INTO memories(id,cwd,value_json,updated_at) VALUES(?1,?2,?3,?4)",
                    params![id, cwd, json, now],
                )
                .map_err(AppError::storage)?;
                connection
                    .execute(
                        "DELETE FROM memories
                         WHERE json_extract(value_json, '$.kind') = 'candidate'
                           AND id NOT IN (
                             SELECT id FROM memories
                             WHERE json_extract(value_json, '$.kind') = 'candidate'
                             ORDER BY updated_at DESC LIMIT 100
                           )",
                        [],
                    )
                    .map_err(AppError::storage)?;
            }
            "scheduled_tasks" => {
                connection.execute(
                    "INSERT OR REPLACE INTO scheduled_tasks(id,value_json,updated_at) VALUES(?1,?2,?3)",
                    params![id, json, now],
                )
                .map_err(AppError::storage)?;
            }
            "agent_profiles" | "agent_tasks" | "usage" => {
                connection.execute(
                    &format!("INSERT OR REPLACE INTO {table}(id,value_json,updated_at) VALUES(?1,?2,?3)"),
                    params![id, json, now],
                )
                .map_err(AppError::storage)?;
            }
            _ => unreachable!("document table has no save mapping"),
        }
        Ok(())
    }

    pub fn delete_document(&self, collection: &str, id: &str) -> Result<bool, AppError> {
        let table = document_table(collection)?;
        let connection = self.connection.lock();
        let changed = connection
            .execute(&format!("DELETE FROM {table} WHERE id=?1"), [id])
            .map_err(AppError::storage)?;
        Ok(changed > 0)
    }

    pub fn get_metadata(&self, key: &str) -> Result<Option<Value>, AppError> {
        let connection = self.connection.lock();
        let raw: Option<String> = connection
            .query_row(
                "SELECT value_json FROM metadata WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::storage)?;
        raw.map(|value| serde_json::from_str(&value).map_err(AppError::internal))
            .transpose()
    }

    pub fn put_metadata(&self, key: &str, value: &Value) -> Result<(), AppError> {
        self.connection
            .lock()
            .execute(
                "INSERT OR REPLACE INTO metadata(key,value_json,updated_at)
                 VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![
                    key,
                    serde_json::to_string(value).map_err(AppError::internal)?
                ],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }

    pub fn delete_metadata(&self, key: &str) -> Result<bool, AppError> {
        let changed = self
            .connection
            .lock()
            .execute("DELETE FROM metadata WHERE key=?1", [key])
            .map_err(AppError::storage)?;
        Ok(changed > 0)
    }

    pub fn metadata_prefix(&self, prefix: &str) -> Result<Vec<(String, Value)>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT key,value_json FROM metadata WHERE key LIKE ?1 ORDER BY key")
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([format!("{prefix}%")], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(AppError::storage)?;
        rows.map(|row| {
            let (key, value) = row.map_err(AppError::storage)?;
            Ok((
                key,
                serde_json::from_str(&value).map_err(AppError::internal)?,
            ))
        })
        .collect()
    }

    pub fn save_secret(
        &self,
        id: &str,
        name: &str,
        scope: &str,
        value: &str,
        metadata: &Value,
    ) -> Result<(), AppError> {
        let reference = format!("secret/{scope}/{id}");
        self.keychain.set(&reference, value)?;
        let result = self.connection.lock().execute(
            "INSERT OR REPLACE INTO secrets(id,name,scope,keychain_ref,metadata_json,updated_at)
             VALUES(?1,?2,?3,?4,?5,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            params![
                id,
                name,
                scope,
                reference,
                serde_json::to_string(metadata).map_err(AppError::internal)?
            ],
        );
        if let Err(error) = result {
            let _ = self.keychain.delete(&reference);
            return Err(AppError::storage(error));
        }
        Ok(())
    }

    pub fn read_secret(&self, id: &str) -> Result<Option<String>, AppError> {
        let connection = self.connection.lock();
        let reference: Option<String> = connection
            .query_row(
                "SELECT keychain_ref FROM secrets WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::storage)?;
        drop(connection);
        let current = reference
            .map(|reference| self.keychain.get(&reference))
            .transpose()
            .map(Option::flatten)?;
        if current.is_some() {
            return Ok(current);
        }
        self.read_legacy_cloud_secret(id)
    }

    /// Check whether a secret is registered without reading its value from the
    /// operating-system credential store. This is intentionally used for
    /// startup/status paths so macOS does not show an access prompt merely to
    /// render the account or provider state.
    pub fn has_secret(&self, id: &str) -> Result<bool, AppError> {
        let connection = self.connection.lock();
        let registered = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM secrets WHERE id=?1)",
                [id],
                |row| row.get(0),
            )
            .map_err(AppError::storage)?;
        drop(connection);
        if registered {
            return Ok(true);
        }
        self.has_legacy_cloud_secret(id)
    }

    /// Return the legacy cloud account document when an older Electron
    /// install left it beside the migrated `SQLite` database. The document is
    /// read-only; credentials are decrypted only when a caller actually asks
    /// for the corresponding secret.
    pub fn legacy_cloud_account(&self) -> Result<Option<Value>, AppError> {
        let path = self.paths.legacy_json("cloud-account.json");
        if !path.is_file() {
            return Ok(None);
        }
        let raw = fs::read_to_string(path).map_err(AppError::storage)?;
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(AppError::internal)
    }

    fn legacy_cloud_secret_value<'a>(value: &'a Value, id: &str) -> Option<&'a str> {
        let field = match id {
            "provider-onpeople" | "cloud-api-key" => "encryptedApiKey",
            "cloud-access-token" => "encryptedAccessToken",
            "cloud-refresh-token" => "encryptedRefreshToken",
            _ => return None,
        };
        value.get(field).and_then(Value::as_str)
    }

    fn legacy_cloud_fallback_enabled(&self) -> Result<bool, AppError> {
        Ok(self
            .get_metadata("cloud.account")?
            .is_none_or(|state| state.get("signedIn").and_then(Value::as_bool) != Some(false)))
    }

    fn has_legacy_cloud_secret(&self, id: &str) -> Result<bool, AppError> {
        if !self.legacy_cloud_fallback_enabled()? {
            return Ok(false);
        }
        Ok(self
            .legacy_cloud_account()?
            .as_ref()
            .and_then(|value| Self::legacy_cloud_secret_value(value, id))
            .is_some_and(|value| !value.trim().is_empty()))
    }

    fn read_legacy_cloud_secret(&self, id: &str) -> Result<Option<String>, AppError> {
        if !self.legacy_cloud_fallback_enabled()? {
            return Ok(None);
        }
        let Some(encrypted) = self
            .legacy_cloud_account()?
            .and_then(|value| Self::legacy_cloud_secret_value(&value, id).map(ToOwned::to_owned))
        else {
            return Ok(None);
        };
        crate::keychain::decrypt_legacy_safe_storage_value(&encrypted)
    }

    pub fn delete_secret(&self, id: &str) -> Result<bool, AppError> {
        let connection = self.connection.lock();
        let reference: Option<String> = connection
            .query_row(
                "SELECT keychain_ref FROM secrets WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::storage)?;
        let changed = connection
            .execute("DELETE FROM secrets WHERE id=?1", [id])
            .map_err(AppError::storage)?
            > 0;
        drop(connection);
        if let Some(reference) = reference {
            self.keychain.delete(&reference)?;
        }
        Ok(changed)
    }

    pub fn list_secret_metadata(&self) -> Result<Vec<SecretMetadata>, AppError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,name,scope,metadata_json,updated_at FROM secrets ORDER BY updated_at DESC",
            )
            .map_err(AppError::storage)?;
        let rows = statement
            .query_map([], |row| {
                let metadata_json: String = row.get(3)?;
                let metadata: Value = serde_json::from_str(&metadata_json).unwrap_or_default();
                let updated_at: String = row.get(4)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    metadata,
                    updated_at,
                ))
            })
            .map_err(AppError::storage)?;
        rows.map(|row| {
            let (id, name, scope, metadata, updated_at) = row.map_err(AppError::storage)?;
            let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_at)
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok(SecretMetadata {
                id,
                name,
                scope,
                description: metadata
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                value_set: true,
                updated_at,
            })
        })
        .collect()
    }

    pub fn health(&self) -> Result<Value, AppError> {
        let connection = self.connection.lock();
        let version: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::storage)?;
        Ok(json!({
            "schemaVersion": version,
            "wal": true,
            "root": self.paths.root,
        }))
    }

    pub fn provider(
        &self,
        kind: ProviderKind,
        thread_id: Option<&str>,
    ) -> Result<ProviderSettings, AppError> {
        let scope = thread_id.unwrap_or("global");
        let kind_key = provider_kind_key(kind)?;
        let connection = self.connection.lock();
        let mut raw: Option<String> = connection
            .query_row(
                "SELECT value_json FROM providers WHERE scope=?1 AND kind=?2",
                params![scope, kind_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::storage)?;
        if raw.is_none() && thread_id.is_some() {
            raw = connection
                .query_row(
                    "SELECT value_json FROM providers WHERE scope='global' AND kind=?1",
                    [&kind_key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(AppError::storage)?;
        }
        raw.map(|value| decode_provider(kind, &value))
            .transpose()
            .map(|value| value.unwrap_or_else(|| default_provider(kind)))
    }

    pub fn save_provider(
        &self,
        scope: &str,
        provider: &ProviderSettings,
        secret_ref: Option<&str>,
    ) -> Result<(), AppError> {
        let json = serde_json::to_string(provider).map_err(AppError::internal)?;
        self.connection
            .lock()
            .execute(
                "INSERT OR REPLACE INTO providers(scope,kind,value_json,secret_ref,updated_at)
                 VALUES(?1,?2,?3,?4,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                params![scope, provider_kind_key(provider.kind)?, json, secret_ref],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }
}

fn provider_kind_key(kind: ProviderKind) -> Result<String, AppError> {
    serde_json::to_value(kind)
        .map_err(AppError::internal)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::internal("provider kind is not a string"))
}

fn decode_provider(kind: ProviderKind, raw: &str) -> Result<ProviderSettings, AppError> {
    if let Ok(provider) = serde_json::from_str::<ProviderSettings>(raw) {
        return Ok(provider);
    }

    let value: Value = serde_json::from_str(raw).map_err(AppError::internal)?;
    let provider_key = provider_kind_key(kind)?;
    let profile = value
        .get("profiles")
        .and_then(|profiles| profiles.get(&provider_key))
        .unwrap_or(&value);
    let default = default_provider(kind);
    let mut provider = default;
    provider.name = string_field(profile, "name")
        .or_else(|| string_field(&value, "name"))
        .unwrap_or(provider.name);
    provider.protocol = string_field(profile, "protocol")
        .or_else(|| string_field(&value, "protocol"))
        .unwrap_or(provider.protocol);
    provider.base_url = string_field(profile, "baseUrl")
        .or_else(|| string_field(profile, "base_url"))
        .or_else(|| string_field(&value, "baseUrl"))
        .or_else(|| string_field(&value, "base_url"))
        .unwrap_or(provider.base_url);
    provider.model = string_field(profile, "model")
        .or_else(|| string_field(&value, "model"))
        .unwrap_or_default();
    provider.vision = profile
        .get("vision")
        .or_else(|| value.get("vision"))
        .and_then(Value::as_bool)
        .unwrap_or(provider.vision);
    provider.api_key_set = profile
        .get("apiKeySet")
        .or_else(|| profile.get("api_key_set"))
        .or_else(|| value.get("apiKeySet"))
        .or_else(|| value.get("api_key_set"))
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            profile
                .get("encryptedApiKey")
                .or_else(|| profile.get("apiKey"))
                .and_then(Value::as_str)
                .is_some_and(|secret| !secret.is_empty())
        });
    if let Some(extra) = profile.get("extra").and_then(Value::as_object) {
        provider.extra = extra.clone().into_iter().collect();
    }
    Ok(provider)
}

fn default_provider(kind: ProviderKind) -> ProviderSettings {
    ProviderSettings {
        kind,
        name: provider_display_name(kind).to_owned(),
        protocol: provider_default_protocol(kind).to_owned(),
        base_url: provider_default_base_url(kind).to_owned(),
        ..ProviderSettings::default()
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn provider_display_name(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Onpeople => "OnPeople",
        ProviderKind::Openai => "OpenAI",
        ProviderKind::Deepseek => "DeepSeek",
        ProviderKind::Minimax => "MiniMax",
        ProviderKind::Kimi => "Kimi",
        ProviderKind::Grok => "Grok",
        ProviderKind::Compatible => "Compatible",
        ProviderKind::Ollama => "Ollama",
        ProviderKind::Lmstudio => "LM Studio",
    }
}

fn provider_default_protocol(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Onpeople | ProviderKind::Openai => "responses",
        ProviderKind::Deepseek
        | ProviderKind::Minimax
        | ProviderKind::Kimi
        | ProviderKind::Grok
        | ProviderKind::Compatible
        | ProviderKind::Ollama
        | ProviderKind::Lmstudio => "chat",
    }
}

fn provider_default_base_url(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Onpeople => "https://api.aibro.vip/v1",
        ProviderKind::Openai => "https://api.openai.com/v1",
        ProviderKind::Deepseek => "https://api.deepseek.com/v1",
        ProviderKind::Minimax => "https://api.minimaxi.chat/v1",
        ProviderKind::Kimi => "https://api.moonshot.cn/v1",
        ProviderKind::Grok => "https://api.x.ai/v1",
        ProviderKind::Compatible => "",
        ProviderKind::Ollama => "http://127.0.0.1:11434/",
        ProviderKind::Lmstudio => "http://127.0.0.1:1234/v1/",
    }
}

fn document_table(collection: &str) -> Result<&'static str, AppError> {
    match collection {
        "memories" => Ok("memories"),
        "scheduled_tasks" => Ok("scheduled_tasks"),
        "agent_profiles" => Ok("agent_profiles"),
        "agent_tasks" => Ok("agent_tasks"),
        "usage" => Ok("usage"),
        _ => Err(AppError::invalid("未知的持久化集合")),
    }
}

fn apply_legacy_preferences(preferences: &mut Preferences, value: &Value) {
    if let Some(theme) = value.get("theme").and_then(Value::as_str) {
        preferences.theme = theme.to_owned();
    }
    if let Some(density) = value.get("density").and_then(Value::as_str) {
        preferences.density = density.to_owned();
    }
    if let Some(reduce_motion) = value.get("reduceMotion").and_then(Value::as_bool) {
        preferences.reduce_motion = reduce_motion;
    }
    if let Some(browser_enabled) = value.get("browserEnabled").and_then(Value::as_bool) {
        preferences.browser_enabled = browser_enabled;
    }
    if let Some(voice) = value.get("liveVoice").and_then(Value::as_str) {
        preferences.live_voice = voice.to_owned();
    }
    if let Some(instructions) = value.get("customInstructions").and_then(Value::as_str) {
        preferences.custom_instructions = instructions.to_owned();
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use onpeople_types::{Preferences, ProviderKind, ProviderSettings, ThreadFilters};
    use serde_json::json;
    use tempfile::tempdir;

    use super::Storage;

    #[test]
    fn opens_wal_database_and_round_trips_preferences() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        let mut preferences = Preferences::default();
        preferences.theme = "dark".to_owned();
        storage.save_preferences(&preferences).expect("save");
        assert_eq!(storage.get_preferences().expect("read").theme, "dark");
        assert_eq!(storage.health().expect("health")["wal"], true);
    }

    #[test]
    fn scopes_memories_to_global_and_active_project() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        for (id, cwd) in [
            ("global", ""),
            ("alpha", "/tmp/alpha"),
            ("beta", "/tmp/beta"),
        ] {
            storage
                .save_document(
                    "memories",
                    id,
                    &json!({
                        "id": id,
                        "cwd": cwd,
                        "content": id,
                        "enabled": true,
                    }),
                )
                .expect("save memory");
        }

        let alpha = storage
            .list_memories(Some("/tmp/alpha"))
            .expect("alpha memories");
        assert_eq!(alpha.len(), 2);
        assert!(alpha.iter().any(|item| item["id"] == "global"));
        assert!(alpha.iter().any(|item| item["id"] == "alpha"));
        assert!(!alpha.iter().any(|item| item["id"] == "beta"));

        let global = storage.list_memories(None).expect("global memories");
        assert_eq!(global.len(), 1);
        assert_eq!(global[0]["id"], "global");
    }

    #[test]
    fn persists_timeline_items_in_original_order_and_updates_in_place() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        storage
            .upsert_timeline_item(
                "thread-1",
                Some("turn-1"),
                "command-1",
                20,
                &json!({
                    "id": "command-1",
                    "type": "commandExecution",
                    "status": "inProgress",
                    "command": ["npm", "test"]
                }),
                Some("2026-08-07T00:00:02Z"),
            )
            .expect("insert command");
        storage
            .upsert_timeline_item(
                "thread-1",
                Some("turn-1"),
                "reasoning-1",
                10,
                &json!({
                    "id": "reasoning-1",
                    "type": "reasoning",
                    "status": "completed"
                }),
                Some("2026-08-07T00:00:01Z"),
            )
            .expect("insert reasoning");
        storage
            .upsert_timeline_item(
                "thread-1",
                Some("turn-1"),
                "command-1",
                30,
                &json!({
                    "id": "command-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "aggregatedOutput": "ok"
                }),
                Some("2026-08-07T00:00:03Z"),
            )
            .expect("complete command");

        let timeline = storage.timeline_items("thread-1").expect("timeline");
        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0]["item"]["id"], "reasoning-1");
        assert_eq!(timeline[1]["item"]["id"], "command-1");
        assert_eq!(timeline[1]["sequence"], 20);
        assert_eq!(timeline[1]["item"]["status"], "completed");
        assert_eq!(timeline[1]["item"]["aggregatedOutput"], "ok");
        assert_eq!(timeline[1]["item"]["command"], json!(["npm", "test"]));
    }

    #[test]
    fn reads_legacy_provider_profile_without_kind_field() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        storage
            .connection
            .lock()
            .execute(
                "INSERT INTO providers(scope,kind,value_json,updated_at) VALUES('global','onpeople',?1,?2)",
                rusqlite::params![
                    serde_json::json!({
                        "type": "onpeople",
                        "profiles": {
                            "onpeople": {
                                "baseUrl": "https://legacy.example/v1",
                                "model": "legacy-model"
                            }
                        }
                    })
                    .to_string(),
                    "2026-01-01T00:00:00Z"
                ],
            )
            .expect("insert legacy provider");
        let provider = storage
            .provider(ProviderKind::Onpeople, None)
            .expect("read provider");
        assert_eq!(provider.kind, ProviderKind::Onpeople);
        assert_eq!(provider.base_url, "https://legacy.example/v1");
        assert_eq!(provider.model, "legacy-model");
    }

    #[test]
    fn provider_defaults_match_kind_and_thread_scope_falls_back_to_global() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        let ollama = storage
            .provider(ProviderKind::Ollama, None)
            .expect("ollama defaults");
        assert_eq!(ollama.kind, ProviderKind::Ollama);
        assert_eq!(ollama.name, "Ollama");
        assert_eq!(ollama.base_url, "http://127.0.0.1:11434/");

        let global = ProviderSettings {
            kind: ProviderKind::Openai,
            name: "OpenAI".to_owned(),
            protocol: "responses".to_owned(),
            base_url: "https://example.test/v1".to_owned(),
            model: "gpt-test".to_owned(),
            ..ProviderSettings::default()
        };
        storage
            .save_provider("global", &global, None)
            .expect("save global provider");
        let inherited = storage
            .provider(ProviderKind::Openai, Some("thread-without-override"))
            .expect("thread provider fallback");
        assert_eq!(inherited.model, "gpt-test");
        assert_eq!(inherited.base_url, "https://example.test/v1");
    }

    #[test]
    fn persists_project_name_pin_and_sidebar_removal() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        let path = directory.path().join("demo-project");
        let path = path.to_string_lossy().into_owned();

        storage
            .update_project(&path, "rename", Some(&json!("Codex 对齐")))
            .expect("rename project");
        storage
            .update_project(&path, "pin", Some(&json!(true)))
            .expect("pin project");
        let list = storage
            .list_threads(&ThreadFilters {
                limit: 200,
                ..ThreadFilters::default()
            })
            .expect("list projects");
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.projects[0].name, "Codex 对齐");
        assert!(list.projects[0].pinned);

        storage
            .update_project(&path, "remove", None)
            .expect("remove project");
        let list = storage
            .list_threads(&ThreadFilters {
                limit: 200,
                ..ThreadFilters::default()
            })
            .expect("list projects after removal");
        assert!(list.projects.is_empty());
    }

    #[test]
    fn keeps_opened_directories_recent_until_they_are_explicitly_added() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        let now = Utc::now();
        let path = directory.path().join("opened-folder");
        let path = path.to_string_lossy().into_owned();
        storage
            .upsert_thread(&onpeople_types::ThreadSummary {
                id: "recent-thread".to_owned(),
                title: "最近任务".to_owned(),
                cwd: path.clone(),
                project_path: Some(path.clone()),
                status: "idle".to_owned(),
                pinned: false,
                archived: false,
                unread: false,
                model: None,
                reasoning_effort: None,
                workspace_mode: "local".to_owned(),
                workspace_base_cwd: Some(path.clone()),
                created_at: now,
                updated_at: now,
            })
            .expect("save local thread");

        let list = storage
            .list_threads(&ThreadFilters {
                limit: 200,
                ..ThreadFilters::default()
            })
            .expect("list recent directory");
        assert!(list.projects.is_empty());
        assert_eq!(list.threads.len(), 1);

        storage
            .update_project(&path, "add", None)
            .expect("explicitly add project");
        let list = storage
            .list_threads(&ThreadFilters {
                limit: 200,
                ..ThreadFilters::default()
            })
            .expect("list explicit project");
        assert_eq!(list.projects.len(), 1);
        assert_eq!(list.projects[0].thread_count, 1);
    }

    #[test]
    fn keeps_isolated_workspaces_out_of_manual_projects() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open_empty(directory.path().to_path_buf()).expect("storage");
        let now = Utc::now();
        let path = directory.path().join("Workspaces/2026-08-06/task");
        let path = path.to_string_lossy().into_owned();
        storage
            .upsert_thread(&onpeople_types::ThreadSummary {
                id: "isolated-thread".to_owned(),
                title: "隔离任务".to_owned(),
                cwd: path.clone(),
                project_path: Some(path.clone()),
                status: "idle".to_owned(),
                pinned: false,
                archived: false,
                unread: false,
                model: None,
                reasoning_effort: None,
                workspace_mode: "isolated".to_owned(),
                workspace_base_cwd: Some(directory.path().to_string_lossy().into_owned()),
                created_at: now,
                updated_at: now,
            })
            .expect("save isolated thread");
        storage
            .update_project(&path, "pin", Some(&json!(true)))
            .expect("save legacy project preference");

        let list = storage
            .list_threads(&ThreadFilters {
                limit: 200,
                ..ThreadFilters::default()
            })
            .expect("list tasks");
        assert!(list.projects.is_empty());
        assert_eq!(list.threads.len(), 1);
    }
}
