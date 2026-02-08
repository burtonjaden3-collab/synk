use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::core::process_pool::{ProcessPool, PtyHandle, SharedProcessPool};
use crate::core::agent_detection::{AgentType, SharedAgentRegistry};
use crate::events::{SessionExitEvent, SessionOutputEvent};

pub type SharedSessionManager = Arc<std::sync::Mutex<SessionManager>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionArgs {
    #[serde(alias = "agent_type")]
    pub agent_type: AgentType,
    pub project_path: String,
    pub branch: Option<String>,
    pub working_dir: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: usize,
    pub pane_index: usize,
    pub agent_type: AgentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: usize,
    pub pane_index: usize,
    pub agent_type: AgentType,
    pub project_path: String,
    pub branch: Option<String>,
    pub working_dir: Option<String>,
}

struct SessionRecord {
    info: SessionInfo,
    handle: PtyHandle,
    stop: Arc<AtomicBool>,
    output_thread: JoinHandle<()>,
    scrollback: Arc<std::sync::Mutex<VecDeque<u8>>>,
}

pub struct SessionManager {
    pool: SharedProcessPool,
    agents: SharedAgentRegistry,
    next_session_id: usize,
    sessions: HashMap<usize, SessionRecord>,
}

fn is_valid_env_var_name(name: &str) -> bool {
    let mut it = name.chars();
    let Some(first) = it.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    it.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl SessionManager {
    pub fn new(pool: SharedProcessPool, agents: SharedAgentRegistry) -> Self {
        Self {
            pool,
            agents,
            next_session_id: 1,
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(
        &mut self,
        app: tauri::AppHandle,
        args: CreateSessionArgs,
    ) -> Result<CreateSessionResponse> {
        // Enforce the pool-configured max. The pool also enforces this, but doing it here
        // gives a stable error message for the frontend and keeps pane indexing bounded.
        let max_sessions: usize = ProcessPool::max_active(self.pool.clone());
        if self.sessions.len() >= max_sessions {
            return Err(anyhow!("max sessions reached ({max_sessions})"));
        }

        let session_id = self.alloc_session_id();
        let pane_index = self.alloc_pane_index(max_sessions)?;

        let mut handle = ProcessPool::claim(self.pool.clone(), session_id)?;

        let (effective_agent_type, warning) = self.resolve_agent(&args.agent_type);

        // If anything fails after we claim the PTY, return it to the pool so we don't leak.
        let built =
            (|| -> Result<(SessionInfo, Arc<AtomicBool>, JoinHandle<()>, Arc<std::sync::Mutex<VecDeque<u8>>>)> {
            // Session bootstrap: cd + env exports.
            let wd = args
                .working_dir
                .clone()
                .unwrap_or_else(|| args.project_path.clone());

            if let Some(env) = &args.env {
                for (k, v) in env {
                    if !is_valid_env_var_name(k) {
                        return Err(anyhow!("invalid env var name: {k}"));
                    }
                    handle.write_str(&format!(
                        "export {}='{}'\r\n",
                        k,
                        shell_single_quote_escape(v)
                    ))?;
                }
            }

            handle.write_str(&format!("export SYNK_SESSION_ID='{}'\r\n", session_id))?;
            handle.write_str(&format!(
                "export SYNK_AGENT_TYPE='{}'\r\n",
                agent_type_to_env_value(effective_agent_type)
            ))?;
            handle.write_str(&format!(
                "export SYNK_PROJECT_PATH='{}'\r\n",
                shell_single_quote_escape(&args.project_path)
            ))?;

            handle.write_str(&format!("cd '{}'\r\n", shell_single_quote_escape(&wd)))?;

            if let Some(w) = &warning {
                // Make the warning visible in the terminal itself, too.
                handle.write_str(&format!(
                    "echo '[synk] {}'\r\n",
                    shell_single_quote_escape(w)
                ))?;
            }

            // Launch the agent CLI inside the claimed shell.
            if effective_agent_type != AgentType::Terminal {
                if let Some(cmd) = effective_agent_type.cli_command() {
                    let full = agent_command_with_model(effective_agent_type, cmd, args.model.as_deref());
                    handle.write_str(&format!("{full}\r\n"))?;
                }
            }

            // Start output pump before we insert the session record, so we can return
            // a fully-active session.
            let stop = Arc::new(AtomicBool::new(false));
            let scrollback: Arc<std::sync::Mutex<VecDeque<u8>>> =
                Arc::new(std::sync::Mutex::new(VecDeque::new()));
            let output_thread = spawn_output_pump(
                app,
                session_id,
                stop.clone(),
                scrollback.clone(),
                &mut handle, // used only to clone fd/reader
            )?;

            let info = SessionInfo {
                session_id,
                pane_index,
                agent_type: effective_agent_type,
                project_path: args.project_path,
                branch: args.branch,
                working_dir: Some(wd),
            };

            Ok((info, stop, output_thread, scrollback))
        })();

        let (info, stop, output_thread, scrollback) = match built {
            Ok(v) => v,
            Err(err) => {
                let _ = ProcessPool::release(self.pool.clone(), session_id, handle);
                return Err(err);
            }
        };

        self.sessions.insert(
            session_id,
            SessionRecord {
                info,
                handle,
                stop,
                output_thread,
                scrollback,
            },
        );

        Ok(CreateSessionResponse {
            session_id,
            pane_index,
            agent_type: effective_agent_type,
            warning,
        })
    }

    pub fn write(&mut self, session_id: usize, data: &str) -> Result<()> {
        let rec = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;
        rec.handle.write_all(data.as_bytes())?;
        Ok(())
    }

    pub fn resize(&mut self, session_id: usize, cols: u16, rows: u16) -> Result<()> {
        let rec = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;
        rec.handle.resize(cols, rows)?;
        Ok(())
    }

    pub fn destroy_session(&mut self, app: tauri::AppHandle, session_id: usize) -> Result<()> {
        let rec = self
            .sessions
            .remove(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;

        // Update pool accounting immediately so the user can close a session at the max limit
        // and immediately open a new one without racing recycle/kill timeouts.
        let pool = self.pool.clone();
        let pool_config = ProcessPool::detach_active(pool.clone(), session_id);

        // Destroying a session can involve waiting for recycle/kill timeouts (seconds).
        // If we do that work on the Tauri command thread it can freeze the app UI.
        // Instead, remove the session from the manager immediately (above) and finish
        // cleanup in the background.
        std::thread::spawn(move || {
            rec.stop.store(true, Ordering::Relaxed);
            let _ = rec.output_thread.join();

            // Return the PTY to the pool (recycle-or-kill is decided by PoolConfig).
            if let Err(err) = ProcessPool::release_detached(pool, rec.handle, pool_config, false) {
                eprintln!("session_destroy: failed to release pty: {err:#}");
            }

            // Best-effort: if the frontend cares, it can mark the pane closed.
            let _ = app.emit(
                "session:exit",
                SessionExitEvent {
                    session_id,
                    exit_code: 0,
                },
            );
        });

        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut out: Vec<_> = self.sessions.values().map(|r| r.info.clone()).collect();
        out.sort_by_key(|s| s.pane_index);
        out
    }

    pub fn scrollback_b64(&self, session_id: usize) -> Result<String> {
        let rec = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;
        let guard = rec.scrollback.lock().expect("scrollback mutex poisoned");
        let (a, b) = guard.as_slices();
        let mut bytes = Vec::with_capacity(guard.len());
        bytes.extend_from_slice(a);
        bytes.extend_from_slice(b);
        Ok(STANDARD.encode(bytes))
    }

    pub fn shutdown(&mut self) {
        // Best-effort: stop all output pumps and kill session PTYs without attempting
        // to recycle/refill the pool.
        let sessions = std::mem::take(&mut self.sessions);
        for (session_id, mut rec) in sessions {
            rec.stop.store(true, Ordering::Relaxed);
            let _ = rec.output_thread.join();

            // Ensure pool accounting is cleared immediately.
            let _ = ProcessPool::detach_active(self.pool.clone(), session_id);

            rec.handle.kill();
        }
    }

    fn alloc_session_id(&mut self) -> usize {
        // Keep it simple for Phase 1: monotonically increasing session IDs.
        let id = self.next_session_id;
        self.next_session_id += 1;
        id
    }

    fn alloc_pane_index(&self, max: usize) -> Result<usize> {
        let mut used = HashSet::with_capacity(self.sessions.len());
        for rec in self.sessions.values() {
            used.insert(rec.info.pane_index);
        }
        for idx in 0..max {
            if !used.contains(&idx) {
                return Ok(idx);
            }
        }
        Err(anyhow!("no free pane index"))
    }

    fn resolve_agent(&self, requested: &AgentType) -> (AgentType, Option<String>) {
        if *requested == AgentType::Terminal {
            return (AgentType::Terminal, None);
        }

        let guard = self.agents.lock().expect("agent registry mutex poisoned");
        if guard.is_installed(*requested) {
            return (*requested, None);
        }

        let cmd = requested
            .cli_command()
            .unwrap_or_else(|| requested.display_name());
        (
            AgentType::Terminal,
            Some(format!(
                "{} not found (missing `{}` on PATH); falling back to Terminal",
                requested.display_name(),
                cmd
            )),
        )
    }
}

fn spawn_output_pump(
    app: tauri::AppHandle,
    session_id: usize,
    stop: Arc<AtomicBool>,
    scrollback: Arc<std::sync::Mutex<VecDeque<u8>>>,
    handle: &mut PtyHandle,
) -> Result<JoinHandle<()>> {
    #[cfg(not(unix))]
    {
        let _ = app;
        let _ = session_id;
        let _ = stop;
        let _ = handle;
        return Err(anyhow!(
            "session output streaming is only implemented for unix targets"
        ));
    }

    #[cfg(unix)]
    {
        let fd = handle.master_fd()?;
        let mut reader = handle.clone_reader()?;

        let t = thread::spawn(move || {
            const SCROLLBACK_CAP_BYTES: usize = 512 * 1024;
            let mut buf = [0u8; 16 * 1024];

            while !stop.load(Ordering::Relaxed) {
                let mut pfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };

                let rc = unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, 100) };
                if rc < 0 {
                    break;
                }
                if rc == 0 {
                    continue;
                }
                if (pfd.revents & libc::POLLIN) == 0 {
                    continue;
                }

                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Keep a bounded in-memory scrollback so the UI can restore content
                        // after React unmounts/remounts (e.g. Home -> Workspace navigation).
                        if let Ok(mut sb) = scrollback.lock() {
                            for &b in &buf[..n] {
                                sb.push_back(b);
                            }
                            while sb.len() > SCROLLBACK_CAP_BYTES {
                                sb.pop_front();
                            }
                        }

                        let data_b64 = STANDARD.encode(&buf[..n]);
                        let _ = app.emit(
                            "session:output",
                            SessionOutputEvent {
                                session_id,
                                data_b64,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }

            if !stop.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "session:exit",
                    SessionExitEvent {
                        session_id,
                        exit_code: -1,
                    },
                );
            }
        });

        Ok(t)
    }
}

fn shell_single_quote_escape(s: &str) -> String {
    // Bash-safe single-quote escaping: ' -> '\''.
    s.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::is_valid_env_var_name;

    #[test]
    fn env_var_name_validation() {
        assert!(is_valid_env_var_name("A"));
        assert!(is_valid_env_var_name("_A"));
        assert!(is_valid_env_var_name("A1_B2"));
        assert!(!is_valid_env_var_name(""));
        assert!(!is_valid_env_var_name("1ABC"));
        assert!(!is_valid_env_var_name("A-B"));
        assert!(!is_valid_env_var_name("A B"));
        assert!(!is_valid_env_var_name("A;rm -rf /"));
    }
}

fn agent_type_to_env_value(t: AgentType) -> &'static str {
    match t {
        AgentType::ClaudeCode => "claude_code",
        AgentType::GeminiCli => "gemini_cli",
        AgentType::Codex => "codex",
        AgentType::Terminal => "terminal",
    }
}

fn agent_command_with_model(agent: AgentType, base_cmd: &str, model: Option<&str>) -> String {
    let Some(model) = model.map(str::trim).filter(|s| !s.is_empty()) else {
        return base_cmd.to_string();
    };
    let m = shell_single_quote_escape(model);
    match agent {
        AgentType::ClaudeCode => format!("{base_cmd} --model '{m}'"),
        AgentType::GeminiCli => format!("{base_cmd} --model '{m}'"),
        AgentType::Codex => format!("{base_cmd} --model '{m}'"),
        AgentType::Terminal => base_cmd.to_string(),
    }
}
