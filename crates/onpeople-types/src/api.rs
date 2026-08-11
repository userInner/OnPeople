use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::{Preferences, ProviderKind};

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct EmptyRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct IdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ThreadRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ThreadMutationRequest {
    pub thread_id: String,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct TextRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct PathRequest {
    pub path: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ThreadFilters {
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

const fn default_limit() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct SendPromptRequest {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub workspace_mode: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub capability: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub industry_plugin: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GoalRequest {
    pub objective: String,
    #[serde(default)]
    pub token_budget: Option<u64>,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GoalUpdateRequest {
    pub thread_id: String,
    pub action: String,
    #[serde(default)]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ProviderRequest {
    pub kind: ProviderKind,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct SaveProviderRequest {
    pub kind: ProviderKind,
    pub model: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ReasoningRequest {
    pub thread_id: String,
    pub effort: String,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalStartRequest {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub window_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalIdRequest {
    pub process_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalWriteRequest {
    pub process_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct TerminalResizeRequest {
    pub process_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct GitRequest {
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitFileRequest {
    pub cwd: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GitMutationRequest {
    pub cwd: String,
    pub action: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub patch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct GitCommitRequest {
    pub cwd: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct GitPushRequest {
    pub cwd: String,
    #[serde(default)]
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct WorktreeRequest {
    pub root: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub remove_branch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ScheduledTaskRequest {
    pub name: String,
    pub prompt: String,
    pub cwd: String,
    pub schedule: Value,
    #[serde(default)]
    pub runtime: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ScheduledTaskMutationRequest {
    pub task_id: String,
    #[serde(default)]
    pub patch: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct PreferencePatchRequest {
    pub preferences: Preferences,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandSpec {
    pub legacy_method: &'static str,
    pub command: &'static str,
    pub domain: &'static str,
    pub streaming: bool,
}

pub const COMMAND_SPECS: &[CommandSpec] = &[
    CommandSpec {
        legacy_method: "agentStatus",
        command: "agent_status",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "sendPrompt",
        command: "send_prompt",
        domain: "runtime",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "pickImages",
        command: "pick_images",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pickAttachments",
        command: "pick_attachments",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pasteImage",
        command: "paste_image",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "readGeneratedImage",
        command: "read_generated_image",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "revealGeneratedImage",
        command: "reveal_generated_image",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "copyGeneratedImage",
        command: "copy_generated_image",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "setGoal",
        command: "set_goal",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "updateGoal",
        command: "update_goal",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "newTask",
        command: "new_task",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "openTaskWindow",
        command: "open_task_window",
        domain: "window",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getProviderSettings",
        command: "get_provider_settings",
        domain: "provider",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveProvider",
        command: "save_provider",
        domain: "provider",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "setThreadReasoningEffort",
        command: "set_thread_reasoning_effort",
        domain: "provider",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getCloudAccount",
        command: "get_cloud_account",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "loginCloudAccount",
        command: "login_cloud_account",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "sendCloudRegistrationCode",
        command: "send_cloud_registration_code",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "registerCloudAccount",
        command: "register_cloud_account",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "logoutCloudAccount",
        command: "logout_cloud_account",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "redeemCloudCode",
        command: "redeem_cloud_code",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "openCloudConsole",
        command: "open_cloud_console",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listCloudGroups",
        command: "list_cloud_groups",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "selectCloudGroup",
        command: "select_cloud_group",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getCloudUsageProfile",
        command: "get_cloud_usage_profile",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveCloudLeaderboardPreference",
        command: "save_cloud_leaderboard_preference",
        domain: "cloud",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getLiveStatus",
        command: "get_live_status",
        domain: "live",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "createLiveSession",
        command: "create_live_session",
        domain: "live",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "closeLiveSession",
        command: "close_live_session",
        domain: "live",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getAppUpdateState",
        command: "get_app_update_state",
        domain: "updater",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "checkForAppUpdate",
        command: "check_for_app_update",
        domain: "updater",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "downloadAppUpdate",
        command: "download_app_update",
        domain: "updater",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "installAppUpdate",
        command: "install_app_update",
        domain: "updater",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "openAppDownload",
        command: "open_app_download",
        domain: "updater",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listThreads",
        command: "list_threads",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "resumeThread",
        command: "resume_thread",
        domain: "threads",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "forkThread",
        command: "fork_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "archiveThread",
        command: "archive_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "unarchiveThread",
        command: "unarchive_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pinThread",
        command: "pin_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "markThreadUnread",
        command: "mark_thread_unread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "renameThread",
        command: "rename_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "revealThread",
        command: "reveal_thread",
        domain: "threads",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "copyText",
        command: "copy_text",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "readText",
        command: "read_text",
        domain: "system",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "showTerminalContextMenu",
        command: "show_terminal_context_menu",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "setTerminalFocused",
        command: "set_terminal_focused",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pickProject",
        command: "pick_project",
        domain: "projects",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "updateProject",
        command: "update_project",
        domain: "projects",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "revealProject",
        command: "reveal_project",
        domain: "projects",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "archiveProjectTasks",
        command: "archive_project_tasks",
        domain: "projects",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "startTerminal",
        command: "start_terminal",
        domain: "terminal",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "readyTerminal",
        command: "ready_terminal",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "writeTerminal",
        command: "write_terminal",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "resizeTerminal",
        command: "resize_terminal",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "terminateTerminal",
        command: "terminate_terminal",
        domain: "terminal",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getGitState",
        command: "get_git_state",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "initGitRepository",
        command: "init_git_repository",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getGitDiff",
        command: "get_git_diff",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getGitHunks",
        command: "get_git_hunks",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "mutateGitHunk",
        command: "mutate_git_hunk",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "mutateGit",
        command: "mutate_git",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "commitGit",
        command: "commit_git",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pushGit",
        command: "push_git",
        domain: "git",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "preparePullRequest",
        command: "prepare_pull_request",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "startReview",
        command: "start_review",
        domain: "git",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "submitReviewComments",
        command: "submit_review_comments",
        domain: "git",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "openEditor",
        command: "open_editor",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getRuntimeDiagnostics",
        command: "get_runtime_diagnostics",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getRuntimeSnapshot",
        command: "get_runtime_snapshot",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "restartRuntime",
        command: "restart_runtime",
        domain: "runtime",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "listExtensions",
        command: "list_extensions",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "setSkillEnabled",
        command: "set_skill_enabled",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "installPlugin",
        command: "install_plugin",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "uninstallPlugin",
        command: "uninstall_plugin",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "activateIndustryPlugin",
        command: "activate_industry_plugin",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deactivateIndustryPlugin",
        command: "deactivate_industry_plugin",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "reloadMcp",
        command: "reload_mcp",
        domain: "mcp",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "syncPluginCatalog",
        command: "sync_plugin_catalog",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "startConnectorOauth",
        command: "start_connector_oauth",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "completeConnectorOauth",
        command: "complete_connector_oauth",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "disconnectConnector",
        command: "disconnect_connector",
        domain: "extensions",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "discoverModels",
        command: "discover_models",
        domain: "provider",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "validateModel",
        command: "validate_model",
        domain: "provider",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listAgents",
        command: "list_agents",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listAgentProfiles",
        command: "list_agent_profiles",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveAgentProfile",
        command: "save_agent_profile",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deleteAgentProfile",
        command: "delete_agent_profile",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "spawnAgent",
        command: "spawn_agent",
        domain: "agents",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "createAgentTask",
        command: "create_agent_task",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "dispatchAgentTask",
        command: "dispatch_agent_task",
        domain: "agents",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "removeAgentTask",
        command: "remove_agent_task",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "messageAgent",
        command: "message_agent",
        domain: "agents",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "stopAgent",
        command: "stop_agent",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "readAgent",
        command: "read_agent",
        domain: "agents",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listWorktrees",
        command: "list_worktrees",
        domain: "worktrees",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "createWorktree",
        command: "create_worktree",
        domain: "worktrees",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "handoffWorktree",
        command: "handoff_worktree",
        domain: "worktrees",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "snapshotWorktree",
        command: "snapshot_worktree",
        domain: "worktrees",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "removeWorktree",
        command: "remove_worktree",
        domain: "worktrees",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getContextState",
        command: "get_context_state",
        domain: "context",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "compactContext",
        command: "compact_context",
        domain: "context",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "recalibrateContext",
        command: "recalibrate_context",
        domain: "context",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "steerTurn",
        command: "steer_turn",
        domain: "context",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "queueMessage",
        command: "queue_message",
        domain: "context",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deleteQueuedMessage",
        command: "delete_queued_message",
        domain: "context",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "steerQueuedMessage",
        command: "steer_queued_message",
        domain: "context",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "getPolicy",
        command: "get_policy",
        domain: "policy",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "savePolicy",
        command: "save_policy",
        domain: "policy",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getPreferences",
        command: "get_preferences",
        domain: "preferences",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "savePreferences",
        command: "save_preferences",
        domain: "preferences",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "pickDownloadDirectory",
        command: "pick_download_directory",
        domain: "preferences",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getEffectiveConfig",
        command: "get_effective_config",
        domain: "config",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listMemories",
        command: "list_memories",
        domain: "memories",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveMemory",
        command: "save_memory",
        domain: "memories",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deleteMemory",
        command: "delete_memory",
        domain: "memories",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveMemorySettings",
        command: "save_memory_settings",
        domain: "memories",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getUsageLedger",
        command: "get_usage_ledger",
        domain: "usage",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveUsagePrice",
        command: "save_usage_price",
        domain: "usage",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listSecrets",
        command: "list_secrets",
        domain: "secrets",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "saveSecret",
        command: "save_secret",
        domain: "secrets",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deleteSecret",
        command: "delete_secret",
        domain: "secrets",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listHooks",
        command: "list_hooks",
        domain: "hooks",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listLocalHooks",
        command: "list_local_hooks",
        domain: "hooks",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "createHook",
        command: "create_hook",
        domain: "hooks",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listScheduledTasks",
        command: "list_scheduled_tasks",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "createScheduledTask",
        command: "create_scheduled_task",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "createScheduledTaskFromText",
        command: "create_scheduled_task_from_text",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "updateScheduledTask",
        command: "update_scheduled_task",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "deleteScheduledTask",
        command: "delete_scheduled_task",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "runScheduledTask",
        command: "run_scheduled_task",
        domain: "scheduler",
        streaming: true,
    },
    CommandSpec {
        legacy_method: "markScheduledNotificationsRead",
        command: "mark_scheduled_notifications_read",
        domain: "scheduler",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "interrupt",
        command: "interrupt",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "resolveApproval",
        command: "resolve_approval",
        domain: "runtime",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getQuickLauncherSuggestions",
        command: "get_quick_launcher_suggestions",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "listProjectFiles",
        command: "list_project_files",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "searchProjectFiles",
        command: "search_project_files",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "getProjectActions",
        command: "get_project_actions",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "authorizeProjectAction",
        command: "authorize_project_action",
        domain: "workspace",
        streaming: false,
    },
    CommandSpec {
        legacy_method: "openWorkspaceFile",
        command: "open_workspace_file",
        domain: "workspace",
        streaming: false,
    },
];
