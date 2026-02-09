use serde::Serialize;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputEvent {
    pub session_id: usize,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitEvent {
    pub session_id: usize,
    pub exit_code: i32,
}

// -----------------------------------------------------------------------------
// Git activity events (Task 3B.2)
// -----------------------------------------------------------------------------

pub const GIT_EVENT_NAME: &str = "git:event";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitEventType {
    Commit,
    BranchCreated,
    BranchDeleted,
    MergeCompleted,
    ConflictDetected,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEvent {
    pub id: String,
    pub event_type: GitEventType,
    pub timestamp: String, // RFC3339
    pub project_path: String,

    // Common optional context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,

    // Commit-specific
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,

    // Merge/conflict-specific
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy: Option<String>, // "merge" | "squash" | "rebase"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_files: Option<Vec<String>>,
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

// -----------------------------------------------------------------------------
// Localhost sessions (Phase 4)
// -----------------------------------------------------------------------------

pub const LOCALHOST_LOG_EVENT_NAME: &str = "localhost:log";
pub const LOCALHOST_STATUS_EVENT_NAME: &str = "localhost:status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostSessionLogEvent {
    pub project_path: String,
    pub id: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
    pub timestamp: String, // RFC3339
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostSessionStatusEvent {
    pub project_path: String,
    pub id: String,
    pub status: crate::core::localhost_runtime::LocalhostSessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_exit_code: Option<i32>,
}
