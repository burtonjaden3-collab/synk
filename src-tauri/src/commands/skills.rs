use std::path::PathBuf;

use crate::core::skills_discovery::{self, SkillsDiscoveryResult};
use crate::core::agent_detection::AgentType;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsDiscoverArgs {
    pub project_path: Option<String>,
    #[serde(default)]
    pub agent_type: Option<AgentType>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsSetEnabledArgs {
    pub name: String,
    pub enabled: bool,
    pub path: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub agent_type: Option<AgentType>,
}

#[tauri::command]
pub fn skills_discover(
    args: SkillsDiscoverArgs,
) -> std::result::Result<SkillsDiscoveryResult, String> {
    let project_path = args
        .project_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);
    let agent_type = args.agent_type.unwrap_or(AgentType::ClaudeCode);
    skills_discovery::discover_skills(agent_type, project_path.as_deref()).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn skills_set_enabled(args: SkillsSetEnabledArgs) -> std::result::Result<(), String> {
    let agent_type = args.agent_type.unwrap_or(AgentType::ClaudeCode);
    skills_discovery::set_skill_enabled_for_agent(
        agent_type,
        &args.name,
        args.enabled,
        args.path.as_deref(),
        args.description.as_deref(),
    )
    .map_err(|e| format!("{e:#}"))
}
