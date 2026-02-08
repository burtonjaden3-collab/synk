use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

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
    pub env: HashMap<String, String>,
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

fn global_mcp_path() -> Result<PathBuf> {
    Ok(claude_dir()?.join("mcp.json"))
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
    let Some(servers) = parsed.get("servers").and_then(|v| v.as_object()) else {
        return out;
    };
    for (k, v) in servers {
        out.insert(k.clone(), v.clone());
    }
    out
}

fn parse_server_fields(v: &Value) -> (Option<String>, Vec<String>, HashMap<String, String>, bool) {
    let command = v.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());
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
    let output = Command::new("pgrep")
        .arg("-a")
        .arg("mcp-server")
        .output();
    let Ok(out) = output else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut procs = Vec::new();
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
        procs.push(McpRunningProcess { pid, cmdline });
    }
    procs
}

fn match_process_to_command(cmdline: &str, command: &str) -> bool {
    if command.is_empty() {
        return false;
    }
    if cmdline.contains(command) {
        return true;
    }
    let basename = Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command);
    cmdline.contains(basename)
}

pub fn discover_mcp(project_path: Option<&Path>) -> Result<McpDiscoveryResult> {
    let global_path = global_mcp_path()?;
    let global_text = read_text_if_exists(&global_path)?.unwrap_or_default();
    let global_servers = parse_mcp_config(&global_text);

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
        let mut running = false;
        let mut pid = None;
        let mut cmdline = None;
        if let Some(cmd) = command.as_deref() {
            for p in running_processes.iter() {
                if match_process_to_command(&p.cmdline, cmd) {
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
                if match_process_to_command(&p.cmdline, cmd) {
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
    servers.sort_by(|a, b| {
        match (a.configured, b.configured) {
            (true, true) => a.name.cmp(&b.name),
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (false, false) => a.pid.cmp(&b.pid),
        }
    });

    Ok(McpDiscoveryResult {
        servers,
        global_config_path: global_path.to_string_lossy().to_string(),
        project_config_path: project_path_on_disk.map(|p| p.to_string_lossy().to_string()),
        running_processes,
    })
}

pub fn set_server_enabled(
    project_path: Option<&Path>,
    name: &str,
    enabled: bool,
    scope: Option<&str>, // "global" | "project"
) -> Result<()> {
    let global_path = global_mcp_path()?;
    let (path, is_project) = match scope {
        Some("project") => {
            let p = project_path.context("projectPath is required for project scope")?;
            (project_mcp_path(p), true)
        }
        Some("global") => (global_path.clone(), false),
        _ => {
            // Default: if the project file contains the server name, update it; else global.
            if let Some(p) = project_path {
                let proj_path = project_mcp_path(p);
                if let Some(text) = read_text_if_exists(&proj_path)? {
                    let cfg = parse_mcp_config(&text);
                    if cfg.contains_key(name) {
                        (proj_path, true)
                    } else {
                        (global_path.clone(), false)
                    }
                } else {
                    (global_path.clone(), false)
                }
            } else {
                (global_path.clone(), false)
            }
        }
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create dir {}", parent.display()))?;
    }

    let mut root: Value = match read_text_if_exists(&path)? {
        Some(text) => serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default())),
        None => Value::Object(Default::default()),
    };
    if !root.is_object() {
        root = Value::Object(Default::default());
    }

    if !root.get("servers").is_some() {
        root["servers"] = Value::Object(Default::default());
    }
    if !root["servers"].is_object() {
        root["servers"] = Value::Object(Default::default());
    }

    let servers_obj = root["servers"].as_object_mut().expect("servers is object");
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
