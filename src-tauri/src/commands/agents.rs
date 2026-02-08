use tauri::State;

use crate::core::agent_detection::{DetectedAgent, SharedAgentRegistry};

#[tauri::command]
pub fn agents_list(
    registry: State<'_, SharedAgentRegistry>,
) -> std::result::Result<Vec<DetectedAgent>, String> {
    let guard = registry.lock().expect("agent registry mutex poisoned");
    Ok(guard.list())
}

