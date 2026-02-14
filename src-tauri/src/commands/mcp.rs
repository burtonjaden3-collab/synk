use std::path::PathBuf;

use tauri::State;

use crate::core::agent_detection::AgentType;
use crate::core::mcp_discovery::{self, McpDiscoveryResult};
use crate::core::mcp_server::SharedMcpRuntime;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoverArgs {
    pub project_path: Option<String>,
    #[serde(default)]
    pub agent_type: Option<AgentType>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetEnabledArgs {
    pub project_path: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub scope: Option<String>, // "global" | "project"
    #[serde(default)]
    pub agent_type: Option<AgentType>,
}

#[tauri::command]
pub fn mcp_discover(
    runtime: State<'_, SharedMcpRuntime>,
    args: McpDiscoverArgs,
) -> std::result::Result<McpDiscoveryResult, String> {
    let project_path = args
        .project_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);
    let agent_type = args.agent_type.unwrap_or(AgentType::ClaudeCode);
    let mut out = mcp_discovery::discover_mcp_agent(agent_type, project_path.as_deref())
        .map_err(|e| format!("{e:#}"))?;

    // Best-effort "starting" status for servers we recently spawned.
    let guard = runtime.lock().expect("mcp runtime mutex poisoned");
    for s in out.servers.iter_mut() {
        if s.enabled && !s.running && guard.is_starting(&s.name, std::time::Duration::from_secs(8))
        {
            s.status = "starting".to_string();
        }
    }

    Ok(out)
}

#[tauri::command]
pub fn mcp_set_enabled(
    runtime: State<'_, SharedMcpRuntime>,
    args: McpSetEnabledArgs,
) -> std::result::Result<(), String> {
    let agent_type = args.agent_type.unwrap_or(AgentType::ClaudeCode);
    if agent_type != AgentType::ClaudeCode {
        return Err("mcp_set_enabled is only supported for Claude MCP config today".to_string());
    }
    let project_path = args
        .project_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);

    // Persist enabled flag first.
    mcp_discovery::set_server_enabled(
        project_path.as_deref(),
        &args.name,
        args.enabled,
        args.scope.as_deref(),
    )
    .map_err(|e| format!("{e:#}"))?;

    // Then start/stop the process according to the new value (spec Task 2.2).
    if args.enabled {
        let info = mcp_discovery::discover_mcp(project_path.as_deref())
            .map_err(|e| format!("{e:#}"))?
            .servers
            .into_iter()
            .find(|s| s.configured && s.name == args.name)
            .ok_or_else(|| format!("MCP server not found after enabling: {}", args.name))?;

        let Some(cmd) = info.command.as_deref() else {
            return Err(format!(
                "MCP server '{}' has no command in config",
                args.name
            ));
        };

        let mut guard = runtime.lock().expect("mcp runtime mutex poisoned");
        guard
            .start_server(&args.name, cmd, &info.args, &info.env)
            .map_err(|e| format!("{e:#}"))?;
    } else {
        // If we didn't start it, fall back to best-effort stop by discovered pid.
        let discovered_pid = mcp_discovery::discover_mcp(project_path.as_deref())
            .ok()
            .and_then(|r| {
                r.servers
                    .into_iter()
                    .find(|s| s.name == args.name)
                    .and_then(|s| s.pid)
            });
        let mut guard = runtime.lock().expect("mcp runtime mutex poisoned");
        guard
            .stop_server(&args.name, discovered_pid)
            .map_err(|e| format!("{e:#}"))?;
    }

    Ok(())
}
