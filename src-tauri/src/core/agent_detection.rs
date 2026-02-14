use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

pub type SharedAgentRegistry = Arc<Mutex<AgentRegistry>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    GeminiCli,
    Codex,
    Openrouter,
    Terminal,
}

impl AgentType {
    pub fn cli_command(self) -> Option<&'static str> {
        match self {
            AgentType::ClaudeCode => Some("claude"),
            AgentType::GeminiCli => Some("gemini"),
            AgentType::Codex => Some("codex"),
            AgentType::Openrouter => Some("codex"),
            AgentType::Terminal => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "Claude Code",
            AgentType::GeminiCli => "Gemini CLI",
            AgentType::Codex => "OpenAI Codex",
            AgentType::Openrouter => "OpenRouter",
            AgentType::Terminal => "Terminal",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAgent {
    pub agent_type: AgentType,
    pub command: String,
    pub found: bool,
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AgentRegistry {
    detected: HashMap<AgentType, DetectedAgent>,
}

impl AgentRegistry {
    pub fn detect() -> Self {
        let mut detected = HashMap::new();

        // Terminal is always available (we spawn a shell in the PTY pool).
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        detected.insert(
            AgentType::Terminal,
            DetectedAgent {
                agent_type: AgentType::Terminal,
                command: shell,
                found: true,
                path: None,
                version: None,
            },
        );

        for agent_type in [
            AgentType::ClaudeCode,
            AgentType::GeminiCli,
            AgentType::Codex,
            AgentType::Openrouter,
        ] {
            let cmd = agent_type
                .cli_command()
                .expect("non-terminal agent has command");
            let path = which_like(cmd);
            let version = if path.is_some() {
                version_like(cmd)
            } else {
                None
            };
            detected.insert(
                agent_type,
                DetectedAgent {
                    agent_type,
                    command: cmd.to_string(),
                    found: path.is_some(),
                    path,
                    version,
                },
            );
        }

        Self { detected }
    }

    pub fn list(&self) -> Vec<DetectedAgent> {
        // Stable ordering for UI/tests.
        let mut out = Vec::with_capacity(self.detected.len());
        for t in [
            AgentType::ClaudeCode,
            AgentType::GeminiCli,
            AgentType::Codex,
            AgentType::Openrouter,
            AgentType::Terminal,
        ] {
            if let Some(v) = self.detected.get(&t) {
                out.push(v.clone());
            }
        }
        out
    }

    pub fn is_installed(&self, agent_type: AgentType) -> bool {
        self.detected
            .get(&agent_type)
            .map(|a| a.found)
            .unwrap_or(false)
    }
}

fn which_like(cmd: &str) -> Option<String> {
    // Spec calls out `which`, but we also support Windows via `where`.
    let output = if cfg!(windows) {
        Command::new("where").arg(cmd).output().ok()
    } else {
        Command::new("which").arg(cmd).output().ok()
    }?;

    if !output.status.success() {
        return None;
    }

    // `which` and `where` can output multiple matches; take the first.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first = stdout.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

fn version_like(cmd: &str) -> Option<String> {
    let output = Command::new(cmd).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).to_string();
    }
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}
