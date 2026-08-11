use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CapabilityStatus {
    pub available: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentStatus {
    pub ready: bool,
    pub runtime: String,
    pub version: String,
    pub default_cwd: String,
    #[serde(default)]
    pub window_thread_id: Option<String>,
    #[serde(default)]
    pub goal: Option<Goal>,
    pub provider: ProviderSettings,
    pub policy: Policy,
    pub capabilities: BTreeMap<String, CapabilityStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuntimeSnapshot {
    pub state: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub queued_messages: u32,
    #[serde(default)]
    pub pending_approvals: u32,
    #[serde(default)]
    pub context: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuntimeDiagnostics {
    pub state: String,
    pub pid: Option<u32>,
    pub executable: String,
    pub version: String,
    pub restart_count: u32,
    pub last_started_at: Option<DateTime<Utc>>,
    pub last_exit_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub events: Vec<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GoalStatus {
    Active,
    Paused,
    Complete,
    Blocked,
    UsageLimited,
    BudgetLimited,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Goal {
    pub id: String,
    pub thread_id: String,
    pub objective: String,
    pub status: GoalStatus,
    pub token_budget: Option<u64>,
    pub tokens_used: u64,
    #[serde(default)]
    pub time_used_seconds: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[allow(clippy::struct_excessive_bools)]
pub struct Preferences {
    pub theme: String,
    pub density: String,
    pub reduce_motion: bool,
    pub show_composer_footer: bool,
    pub show_suggestions: bool,
    pub default_file_opener: String,
    pub live_voice: String,
    pub download_directory: Option<String>,
    pub custom_instructions: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: f64,
    pub utility_width: f64,
    pub terminal_height: f64,
}

fn default_sidebar_width() -> f64 {
    275.0
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: "system".to_owned(),
            density: "comfortable".to_owned(),
            reduce_motion: false,
            show_composer_footer: true,
            show_suggestions: true,
            default_file_opener: "smart".to_owned(),
            live_voice: "cove".to_owned(),
            download_directory: None,
            custom_instructions: String::new(),
            sidebar_width: default_sidebar_width(),
            utility_width: 560.0,
            terminal_height: 300.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ProviderKind {
    Onpeople,
    Openai,
    Deepseek,
    Minimax,
    Kimi,
    Grok,
    Compatible,
    Ollama,
    Lmstudio,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderSettings {
    pub kind: ProviderKind,
    pub name: String,
    pub protocol: String,
    pub base_url: String,
    pub model: String,
    pub vision: bool,
    pub api_key_set: bool,
    #[serde(default)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            kind: ProviderKind::Onpeople,
            name: "OnPeople".to_owned(),
            protocol: "responses".to_owned(),
            base_url: "https://api.aibro.vip/v1".to_owned(),
            model: String::new(),
            vision: true,
            api_key_set: false,
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelDescriptor {
    pub id: String,
    pub provider: ProviderKind,
    pub name: String,
    pub vision: bool,
    #[serde(default)]
    pub reasoning_efforts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadSummary {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub project_path: Option<String>,
    pub status: String,
    pub pinned: bool,
    pub archived: bool,
    pub unread: bool,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    #[serde(default = "default_workspace_mode")]
    pub workspace_mode: String,
    #[serde(default)]
    pub workspace_base_cwd: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_workspace_mode() -> String {
    "local".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectSummary {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    pub thread_count: u32,
    pub archived_thread_count: u32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThreadList {
    pub threads: Vec<ThreadSummary>,
    pub projects: Vec<ProjectSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PromptSubmission {
    pub thread_id: String,
    pub turn_id: String,
    pub queued: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalSession {
    pub process_id: String,
    pub cwd: String,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TerminalExit {
    pub process_id: String,
    pub code: Option<i32>,
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitFileState {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitState {
    pub repository: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitDiff {
    pub path: Option<String>,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorktreeSummary {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub bare: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub cwd: String,
    pub enabled: bool,
    pub schedule: Value,
    pub runtime: Value,
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScheduledRun {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub thread_id: Option<String>,
    pub message: Option<String>,
    pub unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SchedulerSnapshot {
    pub tasks: Vec<ScheduledTask>,
    pub runs: Vec<ScheduledRun>,
    pub unread: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub role: String,
    pub model: String,
    pub effort: String,
    pub sandbox: String,
    pub instructions: String,
    pub built_in: bool,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentTask {
    pub id: String,
    pub parent_thread_id: String,
    pub agent_id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub status: String,
    pub result: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemoryRecord {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub content: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsageSnapshot {
    pub totals: Value,
    pub prices: BTreeMap<String, f64>,
    pub days: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SecretMetadata {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub description: String,
    pub value_set: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloudAccountState {
    pub signed_in: bool,
    pub service_url: String,
    pub account: Option<Value>,
    pub group: Option<Value>,
    pub models: Vec<ModelDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveStatus {
    pub available: bool,
    pub voice: String,
    pub active_call_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppUpdateState {
    pub supported: bool,
    pub status: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified_at: Option<DateTime<Utc>>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileSearchResult {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectAction {
    pub id: String,
    pub label: String,
    pub command: String,
    pub source: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExtensionSnapshot {
    pub skills: Vec<Value>,
    pub plugins: Vec<Value>,
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Policy {
    pub sandbox: String,
    pub approval_policy: String,
    pub reviewer: String,
    pub network: bool,
    pub multi_agent: bool,
    #[serde(default = "default_max_concurrent_agents")]
    pub max_concurrent_agents: u32,
}

const fn default_max_concurrent_agents() -> u32 {
    4
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            sandbox: "workspace-write".to_owned(),
            approval_policy: "on-request".to_owned(),
            reviewer: "user".to_owned(),
            network: true,
            multi_agent: true,
            max_concurrent_agents: default_max_concurrent_agents(),
        }
    }
}
