use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum EventKind {
    Agent,
    Runtime,
    BrowserState,
    BrowserNavigation,
    BrowserPreview,
    BrowserNewTab,
    Scheduler,
    SchedulerOpen,
    CloudAccount,
    AppUpdate,
    Preferences,
    DeepLink,
    CommandPalette,
    TerminalMenu,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EventEnvelope {
    pub sequence: u64,
    pub kind: EventKind,
    pub emitted_at: DateTime<Utc>,
    #[serde(default)]
    pub window_label: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StreamKind {
    Terminal,
    AgentDelta,
    BrowserFrame,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StreamEnvelope {
    pub sequence: u64,
    pub kind: StreamKind,
    pub stream_id: String,
    pub payload: Value,
    pub terminal: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EventSpec {
    pub legacy_subscription: &'static str,
    pub event: &'static str,
    pub streaming: bool,
}

pub const EVENT_SPECS: &[EventSpec] = &[
    EventSpec {
        legacy_subscription: "onAgentEvent",
        event: "agent:event",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onTurnEvent",
        event: "runtime:event",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onBrowserState",
        event: "browser:state",
        streaming: false,
    },
    EventSpec {
        legacy_subscription: "onAgentBrowserNavigation",
        event: "browser:agent-navigation",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onBrowserPreviewUpdated",
        event: "browser:preview-updated",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onBrowserNewTabRequested",
        event: "browser:new-tab-requested",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onSchedulerUpdated",
        event: "scheduler:updated",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onSchedulerOpen",
        event: "scheduler:open",
        streaming: false,
    },
    EventSpec {
        legacy_subscription: "onRuntimeUpdated",
        event: "runtime:updated",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onCloudAccountUpdated",
        event: "cloud:account:updated",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onAppUpdateState",
        event: "app-update:state",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onLiveSidebandEvent",
        event: "live:sideband-event",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onLiveSidebandStatus",
        event: "live:sideband-status",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onPreferencesChanged",
        event: "preferences:changed",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onDeepLink",
        event: "app:deep-link",
        streaming: true,
    },
    EventSpec {
        legacy_subscription: "onCommandPalette",
        event: "app:command-palette",
        streaming: false,
    },
    EventSpec {
        legacy_subscription: "onTerminalMenuAction",
        event: "terminal:menu-action",
        streaming: true,
    },
];
