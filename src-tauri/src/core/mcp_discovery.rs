use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::core::agent_detection::AgentType;
use anyhow::{Context, Result};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use toml_edit::DocumentMut;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRunningProcess {
    pub pid: u32,
    pub cmdline: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    #[serde(skip_serializing)]
    pub env: HashMap<String, String>, // secrets live here; do not send to frontend
    pub env_keys: Vec<String>,
    pub enabled: bool,
    pub source: String, // "global" | "project" | "process"
    pub configured: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub cmdline: Option<String>,
    pub status: String, // "connected" | "disconnected" | "disabled"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveryResult {
    pub servers: Vec<McpServerInfo>,
    pub global_config_path: String,
    pub project_config_path: Option<String>,
    pub running_processes: Vec<McpRunningProcess>,
}

fn home_dir() -> Result<PathBuf> {
    if let Some(v) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    if let Some(v) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    anyhow::bail!("unable to resolve home directory (missing HOME/USERPROFILE)");
}

fn claude_dir() -> Result<PathBuf> {
    Ok(home_dir()?.join(".claude"))
}

fn claude_user_config_path() -> Result<PathBuf> {
    Ok(home_dir()?.join(".claude.json"))
}

fn codex_dir() -> Result<PathBuf> {
    Ok(home_dir()?.join(".codex"))
}

fn legacy_global_mcp_path() -> Result<PathBuf> {
    Ok(claude_dir()?.join("mcp.json"))
}

fn global_mcp_read_paths() -> Result<Vec<PathBuf>> {
    // Merge both known Claude global config locations.
    // Order matters: newer user config should win over legacy file on conflicts.
    Ok(vec![legacy_global_mcp_path()?, claude_user_config_path()?])
}

fn global_mcp_write_path() -> Result<PathBuf> {
    // Prefer current Claude user config location when present.
    let user = claude_user_config_path()?;
    if fs::metadata(&user).is_ok() {
        return Ok(user);
    }
    let legacy = legacy_global_mcp_path()?;
    if fs::metadata(&legacy).is_ok() {
        return Ok(legacy);
    }
    // Default to modern path for new writes.
    Ok(user)
}

fn codex_config_path() -> Result<PathBuf> {
    Ok(codex_dir()?.join("config.toml"))
}

fn project_mcp_path(project_path: &Path) -> PathBuf {
    project_path.join(".mcp.json")
}

fn read_text_if_exists(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

fn parse_mcp_config(text: &str) -> BTreeMap<String, Value> {
    let parsed: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return BTreeMap::new(),
    };
    let mut out = BTreeMap::new();
    // Support both historical `servers` and common `mcpServers` keys.
    // If both exist, prefer `mcpServers` on conflicts.
    if let Some(servers) = parsed.get("servers").and_then(|v| v.as_object()) {
        for (k, v) in servers {
            out.insert(k.clone(), v.clone());
        }
    }
    if let Some(servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
        for (k, v) in servers {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

fn parse_json_root(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(v) if v.is_object() => v,
        _ => Value::Object(Default::default()),
    }
}

fn server_config_key_for_name(root: &Value, name: &str) -> Option<&'static str> {
    ["mcpServers", "servers"].into_iter().find(|&key| {
        root.get(key)
            .and_then(|v| v.as_object())
            .is_some_and(|o| o.contains_key(name))
    })
}

fn global_path_containing_server(name: &str) -> Result<Option<PathBuf>> {
    let mut found: Option<PathBuf> = None;
    for path in global_mcp_read_paths()? {
        let Some(text) = read_text_if_exists(&path)? else {
            continue;
        };
        let root = parse_json_root(&text);
        if server_config_key_for_name(&root, name).is_some() {
            found = Some(path);
        }
    }
    Ok(found)
}

fn parse_server_fields(v: &Value) -> (Option<String>, Vec<String>, HashMap<String, String>, bool) {
    let command = v
        .get("command")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let args = v
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let env = v
        .get("env")
        .and_then(|v| v.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let enabled = v.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    (command, args, env, enabled)
}

fn pgrep_running() -> Vec<McpRunningProcess> {
    if cfg!(windows) {
        return Vec::new();
    }
    let output = Command::new("ps").args(["-eo", "pid=,args="]).output();
    let Ok(out) = output else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut by_identity: HashMap<String, (u8, McpRunningProcess)> = HashMap::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, ' ');
        let pid_str = parts.next().unwrap_or("");
        let cmdline = parts.next().unwrap_or("").trim().to_string();
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        let lower = cmdline.to_lowercase();
        // Keep only likely MCP-related processes to avoid huge noise.
        if !lower.contains("mcp")
            && !lower.contains("modelcontextprotocol")
            && !lower.contains("puppeteer-mcp")
            && !lower.contains("crawl4ai_mcp")
        {
            continue;
        }
        // Ignore obvious self-noise when users/tools run ps/grep for MCP terms.
        if lower.contains("ps -eo pid=,args=") || lower.contains(" rg -i ") {
            continue;
        }

        let identity = process_identity_key(&cmdline, &lower);
        let score = process_identity_score(&lower);
        let candidate = McpRunningProcess { pid, cmdline };
        match by_identity.get_mut(&identity) {
            Some((existing_score, existing_proc)) => {
                // Prefer a representative process commandline that preserves useful launch
                // context (for matching and UI), while collapsing duplicate wrappers/instances.
                if score > *existing_score
                    || (score == *existing_score && candidate.pid < existing_proc.pid)
                {
                    *existing_score = score;
                    *existing_proc = candidate;
                }
            }
            None => {
                by_identity.insert(identity, (score, candidate));
            }
        }
    }
    let mut procs = by_identity
        .into_values()
        .map(|(_, proc)| proc)
        .collect::<Vec<_>>();
    procs.sort_by_key(|p| p.pid);
    procs
}

fn process_identity_key(cmdline: &str, lower_cmdline: &str) -> String {
    if let Some(name) = extract_name_after(lower_cmdline, "@modelcontextprotocol/server-") {
        return format!("mcp-server-{name}");
    }
    if let Some(name) = extract_name_after(lower_cmdline, "mcp-server-") {
        return format!("mcp-server-{name}");
    }
    if lower_cmdline.contains("context7-mcp") {
        return "context7-mcp".to_string();
    }
    if lower_cmdline.contains("puppeteer-mcp") {
        return "puppeteer-mcp".to_string();
    }
    if lower_cmdline.contains("crawl4ai_mcp") {
        return "crawl4ai_mcp".to_string();
    }

    // Fallback: first token basename.
    let first = cmdline.split_whitespace().next().unwrap_or("").trim();
    let base = Path::new(first)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(first)
        .to_lowercase();
    if base.is_empty() {
        "mcp-process".to_string()
    } else {
        base
    }
}

fn extract_name_after(haystack: &str, marker: &str) -> Option<String> {
    let idx = haystack.find(marker)?;
    let rest = &haystack[idx + marker.len()..];
    let name = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn process_identity_score(lower_cmdline: &str) -> u8 {
    if lower_cmdline.starts_with("npx ")
        || lower_cmdline.contains(" npx ")
        || lower_cmdline.contains("/_npx/")
    {
        return 4;
    }
    if lower_cmdline.starts_with("uvx ")
        || lower_cmdline.contains(" uvx ")
        || lower_cmdline.contains("/uvx ")
    {
        return 4;
    }
    if lower_cmdline.starts_with("npm exec ") {
        return 3;
    }
    if lower_cmdline.contains("/bin/python") && lower_cmdline.contains("mcp-server-") {
        return 1;
    }
    if lower_cmdline.contains("@modelcontextprotocol/server-")
        || lower_cmdline.contains("mcp-server-")
        || lower_cmdline.contains("context7-mcp")
        || lower_cmdline.contains("puppeteer-mcp")
        || lower_cmdline.contains("crawl4ai_mcp")
    {
        return 2;
    }
    if lower_cmdline.starts_with("sh -c ") {
        return 0;
    }
    1
}

fn match_process_to_server(cmdline: &str, command: &str, args: &[String]) -> bool {
    if command.is_empty() {
        return false;
    }
    if cmdline.contains(command) {
        return true;
    }

    let lower_cmdline = cmdline.to_lowercase();
    let basename = Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command);
    if !lower_cmdline.contains(&basename.to_lowercase()) {
        return false;
    }

    // Generic launchers need arg hints to avoid false positives.
    let generic = matches!(
        basename,
        "npx" | "uvx" | "node" | "python" | "python3" | "bun" | "npm" | "pnpm" | "yarn"
    );

    let informative_args = args
        .iter()
        .map(|a| a.trim())
        .filter(|a| !a.is_empty() && !a.starts_with('-') && a.len() >= 3)
        .collect::<Vec<_>>();

    if !informative_args.is_empty() {
        return informative_args.iter().any(|a| {
            if lower_cmdline.contains(&a.to_lowercase()) {
                return true;
            }
            let abase = Path::new(a)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(a);
            lower_cmdline.contains(&abase.to_lowercase())
        });
    }

    !generic
}

pub fn discover_mcp(project_path: Option<&Path>) -> Result<McpDiscoveryResult> {
    // Back-compat: default to Claude config.
    discover_mcp_for_agent(AgentType::ClaudeCode, project_path)
}

pub fn discover_mcp_agent(
    agent_type: AgentType,
    project_path: Option<&Path>,
) -> Result<McpDiscoveryResult> {
    discover_mcp_for_agent(agent_type, project_path)
}

fn discover_mcp_for_agent(
    agent_type: AgentType,
    project_path: Option<&Path>,
) -> Result<McpDiscoveryResult> {
    match agent_type {
        AgentType::Codex | AgentType::Openrouter => discover_codex_mcp(),
        _ => discover_claude_mcp(project_path),
    }
}

fn discover_claude_mcp(project_path: Option<&Path>) -> Result<McpDiscoveryResult> {
    let mut global_path_for_ui = global_mcp_write_path()?;
    let mut global_servers = BTreeMap::<String, Value>::new();
    for path in global_mcp_read_paths()? {
        if let Some(text) = read_text_if_exists(&path)? {
            let parsed = parse_mcp_config(&text);
            if !parsed.is_empty() {
                global_path_for_ui = path.clone();
            }
            for (k, v) in parsed {
                global_servers.insert(k, v);
            }
        }
    }

    let (project_path_on_disk, project_servers) = if let Some(p) = project_path {
        let path = project_mcp_path(p);
        let text = read_text_if_exists(&path)?.unwrap_or_default();
        (Some(path), parse_mcp_config(&text))
    } else {
        (None, BTreeMap::new())
    };

    // Merge: project overrides global.
    let mut merged = BTreeMap::<String, (String, Value)>::new();
    for (k, v) in global_servers.iter() {
        merged.insert(k.clone(), ("global".to_string(), v.clone()));
    }
    for (k, v) in project_servers.iter() {
        merged.insert(k.clone(), ("project".to_string(), v.clone()));
    }

    let running_processes = pgrep_running();

    let mut servers = Vec::<McpServerInfo>::new();
    for (name, (source, v)) in merged.iter() {
        let (command, args, env, enabled) = parse_server_fields(v);
        let env_keys = env.keys().cloned().collect::<Vec<_>>();
        let mut running = false;
        let mut pid = None;
        let mut cmdline = None;
        if let Some(cmd) = command.as_deref() {
            for p in running_processes.iter() {
                if match_process_to_server(&p.cmdline, cmd, &args) {
                    running = true;
                    pid = Some(p.pid);
                    cmdline = Some(p.cmdline.clone());
                    break;
                }
            }
        }

        let status = if !enabled {
            "disabled"
        } else if running {
            "connected"
        } else {
            "disconnected"
        };

        servers.push(McpServerInfo {
            name: name.clone(),
            command,
            args,
            env,
            env_keys,
            enabled,
            source: source.clone(),
            configured: true,
            running,
            pid,
            cmdline,
            status: status.to_string(),
        });
    }

    // Add processes not matched to any configured server.
    for p in running_processes.iter() {
        let mut matched = false;
        for s in servers.iter() {
            if let Some(cmd) = s.command.as_deref() {
                if match_process_to_server(&p.cmdline, cmd, &s.args) {
                    matched = true;
                    break;
                }
            }
        }
        if matched {
            continue;
        }
        let basename = p
            .cmdline
            .split_whitespace()
            .next()
            .and_then(|s| Path::new(s).file_name().and_then(|x| x.to_str()))
            .unwrap_or("mcp-server");
        servers.push(McpServerInfo {
            name: format!("process:{basename}:{}", p.pid),
            command: Some(basename.to_string()),
            args: Vec::new(),
            env: HashMap::new(),
            env_keys: Vec::new(),
            enabled: false,
            source: "process".to_string(),
            configured: false,
            running: true,
            pid: Some(p.pid),
            cmdline: Some(p.cmdline.clone()),
            status: "connected".to_string(),
        });
    }

    // Stable ordering: configured by name, then process-only by pid.
    servers.sort_by(|a, b| match (a.configured, b.configured) {
        (true, true) => a.name.cmp(&b.name),
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (false, false) => a.pid.cmp(&b.pid),
    });

    Ok(McpDiscoveryResult {
        servers,
        global_config_path: global_path_for_ui.to_string_lossy().to_string(),
        project_config_path: project_path_on_disk.map(|p| p.to_string_lossy().to_string()),
        running_processes,
    })
}

fn discover_codex_mcp() -> Result<McpDiscoveryResult> {
    let config_path = codex_config_path()?;
    // Prefer asking Codex for its effective MCP configuration; this matches what the user sees
    // in `codex mcp list` and avoids guessing based on OS process state (Codex can spawn on demand).
    #[derive(Debug, Clone, Deserialize)]
    struct CodexTransport {
        #[serde(rename = "type")]
        #[allow(dead_code)]
        transport_type: String,
        command: Option<String>,
        args: Option<Vec<String>>,
        env: Option<HashMap<String, String>>,
        env_vars: Option<Vec<String>>,
        #[allow(dead_code)]
        cwd: Option<String>,
    }

    #[derive(Debug, Clone, Deserialize)]
    struct CodexServer {
        name: String,
        enabled: bool,
        transport: Option<CodexTransport>,
    }

    fn codex_mcp_list_json() -> Result<Vec<CodexServer>> {
        fn parse_server(v: &Value, fallback_name: Option<&str>) -> Option<CodexServer> {
            if let Ok(s) = serde_json::from_value::<CodexServer>(v.clone()) {
                return Some(s);
            }
            let mut obj = v.as_object()?.clone();
            if !obj.contains_key("name") {
                let name = fallback_name?;
                obj.insert("name".to_string(), Value::String(name.to_string()));
            }
            serde_json::from_value::<CodexServer>(Value::Object(obj)).ok()
        }

        let out = match Command::new("codex")
            .args(["mcp", "list", "--json"])
            .output()
        {
            Ok(v) => v,
            Err(_) => return Ok(Vec::new()),
        };
        if !out.status.success() {
            // If Codex isn't installed or errors, degrade gracefully.
            return Ok(Vec::new());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        if let Ok(parsed) = serde_json::from_str::<Vec<CodexServer>>(trimmed) {
            return Ok(parsed);
        }

        let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
            return Ok(Vec::new());
        };

        if let Some(arr) = v.get("servers").and_then(|x| x.as_array()) {
            return Ok(arr.iter().filter_map(|x| parse_server(x, None)).collect());
        }

        if let Some(obj) = v.as_object() {
            return Ok(obj
                .iter()
                .filter_map(|(name, x)| parse_server(x, Some(name)))
                .collect());
        }

        Ok(Vec::new())
    }

    let running_processes = pgrep_running();
    let mut by_name = BTreeMap::<String, McpServerInfo>::new();

    // Baseline from config.toml so newly added servers appear even if
    // `codex mcp list --json` is unavailable.
    if let Some(text) = read_text_if_exists(&config_path)? {
        if let Ok(doc) = text.parse::<DocumentMut>() {
            if let Some(root) = doc.get("mcp_servers").and_then(|v| v.as_table()) {
                for (name, item) in root.iter() {
                    let Some(tbl) = item.as_table() else {
                        continue;
                    };
                    let command = tbl
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let args = tbl
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let enabled = tbl.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                    let mut env_keys = tbl
                        .get("env")
                        .and_then(|v| v.as_table())
                        .map(|env| env.iter().map(|(k, _)| k.to_string()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    env_keys.sort();
                    env_keys.dedup();

                    let mut running = false;
                    let mut pid = None;
                    let mut cmdline = None;
                    if let Some(cmd) = command.as_deref() {
                        for p in running_processes.iter() {
                            if match_process_to_server(&p.cmdline, cmd, &args) {
                                running = true;
                                pid = Some(p.pid);
                                cmdline = Some(p.cmdline.clone());
                                break;
                            }
                        }
                    }
                    let status = if !enabled {
                        "disabled"
                    } else if running {
                        "connected"
                    } else {
                        "disconnected"
                    };
                    by_name.insert(
                        name.to_string(),
                        McpServerInfo {
                            name: name.to_string(),
                            command,
                            args,
                            env: HashMap::new(),
                            env_keys,
                            enabled,
                            source: "codex".to_string(),
                            configured: true,
                            running,
                            pid,
                            cmdline,
                            status: status.to_string(),
                        },
                    );
                }
            }
        }
    }

    for s in codex_mcp_list_json()? {
        let command = s.transport.as_ref().and_then(|t| t.command.clone());
        let args = s
            .transport
            .as_ref()
            .and_then(|t| t.args.clone())
            .unwrap_or_default();

        // Do not retain secrets. Only surface key names (and env var passthrough names).
        let mut env_keys: Vec<String> = Vec::new();
        if let Some(t) = s.transport.as_ref() {
            if let Some(env) = t.env.as_ref() {
                env_keys.extend(env.keys().cloned());
            }
            if let Some(vars) = t.env_vars.as_ref() {
                env_keys.extend(vars.iter().cloned());
            }
        }
        env_keys.sort();
        env_keys.dedup();

        let mut running = false;
        let mut pid = None;
        let mut cmdline = None;
        if let Some(cmd) = command.as_deref() {
            for p in running_processes.iter() {
                if match_process_to_server(&p.cmdline, cmd, &args) {
                    running = true;
                    pid = Some(p.pid);
                    cmdline = Some(p.cmdline.clone());
                    break;
                }
            }
        }

        let status = if !s.enabled {
            "disabled"
        } else if running {
            "connected"
        } else {
            "disconnected"
        };

        let next = McpServerInfo {
            name: s.name,
            command,
            args,
            env: HashMap::new(),
            env_keys,
            enabled: s.enabled,
            source: "codex".to_string(),
            configured: true,
            running,
            pid,
            cmdline,
            status: status.to_string(),
        };

        match by_name.get_mut(&next.name) {
            Some(existing) => {
                if next.command.is_some() {
                    existing.command = next.command;
                }
                if !next.args.is_empty() {
                    existing.args = next.args;
                }
                if !next.env_keys.is_empty() {
                    existing.env_keys = next.env_keys;
                }
                existing.enabled = next.enabled;
                existing.running = next.running;
                existing.status = next.status;
            }
            None => {
                by_name.insert(next.name.clone(), next);
            }
        }
    }

    let mut servers = by_name.into_values().collect::<Vec<_>>();
    servers.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(McpDiscoveryResult {
        servers,
        global_config_path: config_path.to_string_lossy().to_string(),
        project_config_path: None,
        running_processes,
    })
}

pub fn set_server_enabled(
    project_path: Option<&Path>,
    name: &str,
    enabled: bool,
    scope: Option<&str>, // "global" | "project"
) -> Result<()> {
    let global_write_path = global_mcp_write_path()?;
    let (path, is_project) = match scope {
        Some("project") => {
            let p = project_path.context("projectPath is required for project scope")?;
            (project_mcp_path(p), true)
        }
        Some("global") => (
            global_path_containing_server(name)?.unwrap_or(global_write_path.clone()),
            false,
        ),
        _ => {
            // Default: if the project file contains the server name, update it; else global.
            if let Some(p) = project_path {
                let proj_path = project_mcp_path(p);
                if let Some(text) = read_text_if_exists(&proj_path)? {
                    let root = parse_json_root(&text);
                    if server_config_key_for_name(&root, name).is_some() {
                        (proj_path, true)
                    } else {
                        (
                            global_path_containing_server(name)?
                                .unwrap_or(global_write_path.clone()),
                            false,
                        )
                    }
                } else {
                    (
                        global_path_containing_server(name)?.unwrap_or(global_write_path.clone()),
                        false,
                    )
                }
            } else {
                (
                    global_path_containing_server(name)?.unwrap_or(global_write_path.clone()),
                    false,
                )
            }
        }
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create dir {}", parent.display()))?;
    }

    let mut root: Value = match read_text_if_exists(&path)? {
        Some(text) => parse_json_root(&text),
        None => Value::Object(Default::default()),
    };

    // Preserve existing schema shape when adding new entries, but if this server already
    // exists under one specific key, update that key in place.
    let key = server_config_key_for_name(&root, name).unwrap_or_else(|| {
        if root.get("mcpServers").and_then(|v| v.as_object()).is_some() {
            "mcpServers"
        } else {
            "servers"
        }
    });

    if root.get(key).is_none() || !root[key].is_object() {
        root[key] = Value::Object(Default::default());
    }

    let servers_obj = root[key].as_object_mut().expect("mcp server map is object");
    let Some(server_val) = servers_obj.get_mut(name) else {
        // Don't auto-create unknown servers in Task 2.2; that belongs to "Add MCP Server".
        anyhow::bail!(
            "server not found in {} config: {}",
            if is_project { "project" } else { "global" },
            name
        );
    };

    if !server_val.is_object() {
        *server_val = Value::Object(Default::default());
    }
    let server_obj = server_val.as_object_mut().expect("server is object");
    server_obj.insert("enabled".to_string(), Value::Bool(enabled));

    let text = serde_json::to_string_pretty(&root).context("serialize mcp.json")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}
