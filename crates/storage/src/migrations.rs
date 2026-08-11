use rusqlite::{Connection, Result};

pub fn apply(conn: &mut Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 10_000)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at TEXT NOT NULL
         );",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    for (version, sql) in migrations()
        .into_iter()
        .filter(|(version, _)| *version > current)
    {
        let transaction = conn.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            [version],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn migrations() -> Vec<(i64, &'static str)> {
    vec![
        (
            1,
            "CREATE TABLE IF NOT EXISTS metadata (
               key TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS legacy_documents (
               name TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               source_mtime INTEGER,
               imported_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS preferences (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS providers (
               scope TEXT NOT NULL,
               kind TEXT NOT NULL,
               value_json TEXT NOT NULL,
               secret_ref TEXT,
               updated_at TEXT NOT NULL,
               PRIMARY KEY(scope, kind)
             );
             CREATE TABLE IF NOT EXISTS threads (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
             CREATE TABLE IF NOT EXISTS goals (
               id TEXT PRIMARY KEY,
               thread_id TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS scheduled_tasks (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS scheduled_runs (
               id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
               value_json TEXT NOT NULL,
               started_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS agent_profiles (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS agent_tasks (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS memories (
               id TEXT PRIMARY KEY,
               cwd TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS usage (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS browser_tabs (
               route_id TEXT PRIMARY KEY,
               thread_id TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS browser_annotations (
               id TEXT PRIMARY KEY,
               route_id TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS secrets (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               scope TEXT NOT NULL,
               keychain_ref TEXT NOT NULL,
               metadata_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS audit (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               event_json TEXT NOT NULL,
               created_at TEXT NOT NULL
             );",
        ),
        (
            2,
            "CREATE TABLE IF NOT EXISTS migration_items (
               source TEXT PRIMARY KEY,
               checksum TEXT NOT NULL,
               imported_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS window_state (
               key TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        ),
        (
            3,
            "CREATE TABLE IF NOT EXISTS browser_sessions (
               provider_id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS cloud_account (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               metadata_json TEXT NOT NULL,
               keychain_ref TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS live_sessions (
               id TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        ),
        (
            4,
            "CREATE INDEX IF NOT EXISTS idx_browser_annotations_route ON browser_annotations(route_id);
             CREATE INDEX IF NOT EXISTS idx_memories_cwd ON memories(cwd);
             CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task ON scheduled_runs(task_id, started_at DESC);",
        ),
        (
            5,
            "CREATE TABLE IF NOT EXISTS project_preferences (
               path TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               pinned INTEGER NOT NULL DEFAULT 0,
               hidden INTEGER NOT NULL DEFAULT 0,
               updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_project_preferences_pinned
               ON project_preferences(pinned DESC, updated_at DESC);",
        ),
        (
            6,
            "ALTER TABLE project_preferences
               ADD COLUMN explicit INTEGER NOT NULL DEFAULT 0;
             UPDATE project_preferences
               SET explicit = 1
               WHERE pinned = 1 OR path NOT LIKE '%/OnPeople/Workspaces/%';
             CREATE INDEX IF NOT EXISTS idx_project_preferences_explicit
               ON project_preferences(explicit, pinned DESC, updated_at DESC);",
        ),
        (
            7,
            "UPDATE project_preferences
               SET explicit = 1
               WHERE pinned = 1 OR path NOT LIKE '%/OnPeople/Workspaces/%';",
        ),
        (
            8,
            "CREATE TABLE IF NOT EXISTS timeline_items (
               thread_id TEXT NOT NULL,
               item_id TEXT NOT NULL,
               turn_id TEXT,
               sequence INTEGER NOT NULL,
               value_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               PRIMARY KEY(thread_id, item_id)
             );
             CREATE INDEX IF NOT EXISTS idx_timeline_items_thread_sequence
               ON timeline_items(thread_id, sequence ASC);",
        ),
    ]
}
