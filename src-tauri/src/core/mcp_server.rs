use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};

#[derive(Debug)]
struct ChildEntry {
    pid: u32,
    started_at: Instant,
    _child: Child,
}

#[derive(Debug, Default)]
pub struct McpRuntime {
    children: HashMap<String, ChildEntry>,
}

pub type SharedMcpRuntime = Arc<Mutex<McpRuntime>>;

fn is_pid_running_unix(pid: u32) -> bool {
    // `kill -0` checks existence without sending a signal.
    let status = Command::new("kill").arg("-0").arg(pid.to_string()).status();
    status.map(|s| s.success()).unwrap_or(false)
}

fn terminate_pid(pid: u32) -> Result<()> {
    if cfg!(windows) {
        // Best-effort, terminate process tree.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
        return Ok(());
    }

    // SIGTERM, then SIGKILL if still alive.
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();
    std::thread::sleep(Duration::from_millis(300));
    if is_pid_running_unix(pid) {
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .status();
    }
    Ok(())
}

impl McpRuntime {
    pub fn is_starting(&self, name: &str, max_age: Duration) -> bool {
        self.children
            .get(name)
            .map(|c| c.started_at.elapsed() <= max_age)
            .unwrap_or(false)
    }

    pub fn start_server(
        &mut self,
        name: &str,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<u32> {
        if let Some(existing) = self.children.get(name) {
            // If we still track it and the pid is alive, treat as already running.
            if cfg!(windows) || is_pid_running_unix(existing.pid) {
                return Ok(existing.pid);
            }
        }

        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(env)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = cmd
            .spawn()
            .with_context(|| format!("spawn MCP server {name} ({command})"))?;
        let pid = child.id();
        self.children.insert(
            name.to_string(),
            ChildEntry {
                pid,
                started_at: Instant::now(),
                _child: child,
            },
        );
        Ok(pid)
    }

    pub fn stop_server(&mut self, name: &str, fallback_pid: Option<u32>) -> Result<()> {
        if let Some(entry) = self.children.remove(name) {
            terminate_pid(entry.pid)?;
            return Ok(());
        }

        if let Some(pid) = fallback_pid {
            terminate_pid(pid)?;
        }
        Ok(())
    }

    pub fn shutdown_all(&mut self) {
        let names: Vec<String> = self.children.keys().cloned().collect();
        for n in names {
            if let Some(entry) = self.children.remove(&n) {
                let _ = terminate_pid(entry.pid);
            }
        }
    }
}
