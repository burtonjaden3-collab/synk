use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

use crate::core::agent_detection::{AgentType, SharedAgentRegistry};
use crate::core::process_pool::{ProcessPool, PtyHandle, SharedProcessPool};
use crate::events::{SessionExitEvent, SessionOutputEvent};

pub type SharedSessionManager = Arc<std::sync::Mutex<SessionManager>>;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CodexProvider {
    Openai,
    Openrouter,
}

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
    #[serde(default)]
    pub codex_provider: Option<CodexProvider>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_provider: Option<CodexProvider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
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

type BuiltSession = (
    SessionInfo,
    Arc<AtomicBool>,
    JoinHandle<()>,
    Arc<std::sync::Mutex<VecDeque<u8>>>,
);

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
        let built = (|| -> Result<BuiltSession> {
            // Session bootstrap: cd + env exports.
            let wd = args
                .working_dir
                .clone()
                .unwrap_or_else(|| args.project_path.clone());
            let launch_model = normalized_model(args.model.as_deref());

            // Configure Codex provider env from Synk settings (OpenAI vs OpenRouter).
            let codex_provider = match effective_agent_type {
                AgentType::Codex => args.codex_provider,
                AgentType::Openrouter => Some(CodexProvider::Openrouter),
                _ => None,
            };
            let codex_uses_openrouter = apply_codex_provider_env(
                &mut handle,
                &app,
                effective_agent_type,
                codex_provider,
                launch_model.as_deref(),
            )?;

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

            // Start output pump before launching any agent so we can respond to terminal
            // handshake requests (e.g. DSR) immediately on process start.
            let stop = Arc::new(AtomicBool::new(false));
            let scrollback: Arc<std::sync::Mutex<VecDeque<u8>>> =
                Arc::new(std::sync::Mutex::new(VecDeque::new()));
            let output_thread = spawn_output_pump(
                app.clone(),
                session_id,
                stop.clone(),
                scrollback.clone(),
                &mut handle, // used only to clone fd/reader
            )?;

            // Launch the agent CLI inside the claimed shell.
            if effective_agent_type != AgentType::Terminal {
                if let Some(cmd) = effective_agent_type.cli_command() {
                    let full =
                        agent_command_with_model(
                            effective_agent_type,
                            cmd,
                            launch_model.as_deref(),
                            codex_uses_openrouter,
                        );
                    if let Err(err) = handle.write_str(&format!("{full}\r\n")) {
                        stop.store(true, Ordering::Relaxed);
                        let _ = output_thread.join();
                        return Err(err);
                    }
                }
            }

            let info = SessionInfo {
                session_id,
                pane_index,
                agent_type: effective_agent_type,
                codex_provider,
                model: launch_model,
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

    pub fn restart_session(
        &mut self,
        app: tauri::AppHandle,
        session_id: usize,
        dir: String,
        branch: Option<String>,
        model: Option<String>,
        codex_provider: Option<CodexProvider>,
    ) -> Result<SessionInfo> {
        let dir = dir.trim();
        if dir.is_empty() {
            return Err(anyhow!("dir is empty"));
        }

        let mut rec = self
            .sessions
            .remove(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;

        // Stop old output pump.
        rec.stop.store(true, Ordering::Relaxed);
        let _ = rec.output_thread.join();

        // Temporarily detach pool accounting so we can claim a new handle under the same key.
        let pool = self.pool.clone();
        let pool_config = ProcessPool::detach_active(pool.clone(), session_id);

        // Try to claim a fresh PTY.
        let claimed = ProcessPool::claim(pool.clone(), session_id);
        let mut handle = match claimed {
            Ok(h) => h,
            Err(err) => {
                // Restore accounting and resume output streaming on the existing handle.
                let _ = ProcessPool::attach_active(pool.clone(), session_id, rec.handle.pid);
                let stop = Arc::new(AtomicBool::new(false));
                let output_thread = spawn_output_pump(
                    app.clone(),
                    session_id,
                    stop.clone(),
                    rec.scrollback.clone(),
                    &mut rec.handle,
                )?;
                rec.stop = stop;
                rec.output_thread = output_thread;
                self.sessions.insert(session_id, rec);
                return Err(err);
            }
        };

        let pane_index = rec.info.pane_index;
        let agent_type = rec.info.agent_type;
        let codex_provider = codex_provider.or(rec.info.codex_provider);
        let launch_model = normalized_model(model.as_deref()).or(rec.info.model.clone());
        let project_path = rec.info.project_path.clone();

        // Hand old handle back to the pool in the background (recycle/kill may take time).
        std::thread::spawn(move || {
            if let Err(err) = ProcessPool::release_detached(pool, rec.handle, pool_config, false) {
                eprintln!("session_restart: failed to release old pty: {err:#}");
            }
        });

        // Bootstrap new session: env exports + cd.
        handle.write_str(&format!("export SYNK_SESSION_ID='{}'\r\n", session_id))?;
        handle.write_str(&format!(
            "export SYNK_AGENT_TYPE='{}'\r\n",
            agent_type_to_env_value(agent_type)
        ))?;
        handle.write_str(&format!(
            "export SYNK_PROJECT_PATH='{}'\r\n",
            shell_single_quote_escape(&project_path)
        ))?;
        // Re-apply Codex provider env for restarted sessions.
        let codex_uses_openrouter = apply_codex_provider_env(
            &mut handle,
            &app,
            agent_type,
            codex_provider,
            launch_model.as_deref(),
        )?;
        handle.write_str(&format!("cd '{}'\r\n", shell_single_quote_escape(dir)))?;

        // Relaunch agent CLI (if any).
        if agent_type != AgentType::Terminal {
            if let Some(cmd) = agent_type.cli_command() {
                let full = agent_command_with_model(
                    agent_type,
                    cmd,
                    launch_model.as_deref(),
                    codex_uses_openrouter,
                );
                handle.write_str(&format!("{full}\r\n"))?;
            }
        }

        // Start streaming for the new session.
        let stop = Arc::new(AtomicBool::new(false));
        let scrollback: Arc<std::sync::Mutex<VecDeque<u8>>> =
            Arc::new(std::sync::Mutex::new(VecDeque::new()));
        let output_thread = spawn_output_pump(
            app,
            session_id,
            stop.clone(),
            scrollback.clone(),
            &mut handle,
        )?;

        let info = SessionInfo {
            session_id,
            pane_index,
            agent_type,
            codex_provider,
            model: launch_model,
            project_path,
            branch,
            working_dir: Some(dir.to_string()),
        };

        self.sessions.insert(
            session_id,
            SessionRecord {
                info: info.clone(),
                handle,
                stop,
                output_thread,
                scrollback,
            },
        );

        Ok(info)
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut out: Vec<_> = self.sessions.values().map(|r| r.info.clone()).collect();
        out.sort_by_key(|s| s.pane_index);
        out
    }

    pub fn get_session_info(&self, session_id: usize) -> Option<SessionInfo> {
        self.sessions.get(&session_id).map(|r| r.info.clone())
    }

    pub fn set_session_git_context(
        &mut self,
        session_id: usize,
        branch: Option<String>,
        working_dir: Option<String>,
    ) -> Result<()> {
        let rec = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;
        rec.info.branch = branch;
        rec.info.working_dir = working_dir;
        Ok(())
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

        // Minimal filter for terminal Device Status Report queries.
        // Some TUIs (including Codex CLI via crossterm) query cursor position via
        // `ESC [ 6 n` and expect a fast reply. In a webview terminal, the
        // "terminal replies on stdin" roundtrip can be too slow; answering at the
        // PTY layer avoids startup crashes.
        struct DsrFilter {
            pending: Vec<u8>,
        }

        impl DsrFilter {
            fn new() -> Self {
                Self { pending: Vec::new() }
            }

            fn flush_pending(&mut self, out: &mut Vec<u8>) {
                if !self.pending.is_empty() {
                    out.extend_from_slice(&self.pending);
                    self.pending.clear();
                }
            }

            fn respond(fd: i32, bytes: &[u8]) {
                // Best-effort: this is small; if we can't write immediately we just drop.
                let mut off = 0usize;
                for _ in 0..3 {
                    while off < bytes.len() {
                        let rc = unsafe {
                            libc::write(
                                fd,
                                bytes[off..].as_ptr() as *const _,
                                bytes.len().saturating_sub(off),
                            )
                        };
                        if rc > 0 {
                            off += rc as usize;
                            continue;
                        }
                        if rc == 0 {
                            return;
                        }
                        let err = std::io::Error::last_os_error();
                        match err.raw_os_error() {
                            Some(libc::EINTR) => continue,
                            Some(errno) if errno == libc::EAGAIN || errno == libc::EWOULDBLOCK => {
                                // Give the PTY a moment to become writable.
                                let mut pfd = libc::pollfd {
                                    fd,
                                    events: libc::POLLOUT,
                                    revents: 0,
                                };
                                let _ = unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, 5) };
                                break;
                            }
                            _ => return,
                        }
                    }
                    if off >= bytes.len() {
                        return;
                    }
                }
            }

            fn feed(&mut self, fd: i32, input: &[u8], out: &mut Vec<u8>) {
                for &b in input {
                    if self.pending.is_empty() {
                        if b == 0x1b {
                            self.pending.push(b);
                            continue;
                        }
                        out.push(b);
                        continue;
                    }

                    match self.pending.as_slice() {
                        [0x1b] => {
                            if b == b'[' {
                                self.pending.push(b);
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        [0x1b, b'['] => {
                            if b == b'?' || b == b'5' || b == b'6' {
                                self.pending.push(b);
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        [0x1b, b'[', b'?'] => {
                            if b == b'5' || b == b'6' {
                                self.pending.push(b);
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        // ESC [ 6
                        [0x1b, b'[', b'6'] => {
                            if b == b'n' {
                                Self::respond(fd, b"\x1b[1;1R");
                                self.pending.clear();
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        // ESC [ 5
                        [0x1b, b'[', b'5'] => {
                            if b == b'n' {
                                Self::respond(fd, b"\x1b[0n");
                                self.pending.clear();
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        // ESC [ ? 6
                        [0x1b, b'[', b'?', b'6'] => {
                            if b == b'n' {
                                // DECXCPR variant; reply with the private response form.
                                Self::respond(fd, b"\x1b[?1;1R");
                                self.pending.clear();
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        // ESC [ ? 5
                        [0x1b, b'[', b'?', b'5'] => {
                            if b == b'n' {
                                // Best-effort: respond with "OK".
                                Self::respond(fd, b"\x1b[0n");
                                self.pending.clear();
                            } else {
                                self.flush_pending(out);
                                if b == 0x1b {
                                    self.pending.push(b);
                                } else {
                                    out.push(b);
                                }
                            }
                        }
                        _ => {
                            // Unknown / too long; flush and restart.
                            self.flush_pending(out);
                            if b == 0x1b {
                                self.pending.push(b);
                            } else {
                                out.push(b);
                            }
                        }
                    }
                }
            }
        }

        let t = thread::spawn(move || {
            const SCROLLBACK_CAP_BYTES: usize = 512 * 1024;
            let mut buf = [0u8; 16 * 1024];
            let mut dsr = DsrFilter::new();

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
                        let mut filtered: Vec<u8> = Vec::with_capacity(n);
                        dsr.feed(fd, &buf[..n], &mut filtered);
                        if filtered.is_empty() {
                            continue;
                        }

                        // Keep a bounded in-memory scrollback so the UI can restore content
                        // after React unmounts/remounts (e.g. Home -> Workspace navigation).
                        if let Ok(mut sb) = scrollback.lock() {
                            for &b in &filtered {
                                sb.push_back(b);
                            }
                            while sb.len() > SCROLLBACK_CAP_BYTES {
                                sb.pop_front();
                            }
                        }

                        let data_b64 = STANDARD.encode(&filtered);
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

fn normalized_model(model: Option<&str>) -> Option<String> {
    model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn agent_type_to_env_value(t: AgentType) -> &'static str {
    match t {
        AgentType::ClaudeCode => "claude_code",
        AgentType::GeminiCli => "gemini_cli",
        AgentType::Codex => "codex",
        AgentType::Openrouter => "openrouter",
        AgentType::Terminal => "terminal",
    }
}

fn agent_command_with_model(
    agent: AgentType,
    base_cmd: &str,
    model: Option<&str>,
    force_api_login: bool,
) -> String {
    match agent {
        AgentType::ClaudeCode => {
            let Some(model) = model.map(str::trim).filter(|s| !s.is_empty()) else {
                return base_cmd.to_string();
            };
            let m = shell_single_quote_escape(model);
            format!("{base_cmd} --model '{m}'")
        }
        AgentType::GeminiCli => {
            let Some(model) = model.map(str::trim).filter(|s| !s.is_empty()) else {
                return base_cmd.to_string();
            };
            let m = shell_single_quote_escape(model);
            format!("{base_cmd} --model '{m}'")
        }
        // Codex CLI supports config overrides via `-c key=value` (TOML parsed).
        // We set sandbox/approval defaults so file writes inside the workspace do not
        // trigger repeated permission prompts, plus reasoning/model consistency.
        // Example from codex help: `-c model="o3"`.
        AgentType::Codex | AgentType::Openrouter => {
            let mut cmd = format!(
                "{base_cmd} --sandbox workspace-write --ask-for-approval on-failure -c 'model_reasoning_effort=\"high\"'"
            );
            if let Some(model) = model.map(str::trim).filter(|s| !s.is_empty()) {
                let m = shell_single_quote_escape(model);
                cmd.push_str(&format!(" -c 'model=\"{m}\"'"));
            }
            if force_api_login {
                cmd.push_str(" -c 'forced_login_method=\"api\"'");
            }
            cmd
        }
        AgentType::Terminal => base_cmd.to_string(),
    }
}

fn openrouter_codex_home(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .resolve("synk/codex-openrouter", BaseDirectory::Config)
        .map_err(|e| anyhow!("resolve config path for openrouter codex home: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| anyhow!("create openrouter codex home {}: {e}", dir.display()))?;
    Ok(dir)
}

fn set_or_unset_env(handle: &mut PtyHandle, key: &str, value: Option<&str>) -> Result<()> {
    if !is_valid_env_var_name(key) {
        return Err(anyhow!("invalid env var name: {key}"));
    }
    match value {
        Some(v) => handle.write_str(&format!(
            "export {}='{}'\r\n",
            key,
            shell_single_quote_escape(v)
        ))?,
        None => handle.write_str(&format!("unset {}\r\n", key))?,
    }
    Ok(())
}

fn apply_codex_provider_env(
    handle: &mut PtyHandle,
    app: &tauri::AppHandle,
    agent: AgentType,
    codex_provider: Option<CodexProvider>,
    model: Option<&str>,
) -> Result<bool> {
    if agent != AgentType::Codex && agent != AgentType::Openrouter {
        return Ok(false);
    }

    let settings = match crate::core::settings::settings_get(app) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };

    let default_provider = settings.ai_providers.default.trim().to_ascii_lowercase();
    let model_looks_openrouter = model
        .map(str::trim)
        .map(|m| m.to_ascii_lowercase().starts_with("openrouter/"))
        .unwrap_or(false);
    let use_openrouter = match agent {
        AgentType::Openrouter => true,
        AgentType::Codex => match codex_provider {
            Some(CodexProvider::Openrouter) => true,
            Some(CodexProvider::Openai) => false,
            None => default_provider == "openrouter" || model_looks_openrouter,
        },
        _ => false,
    };

    if use_openrouter {
        let key = settings.ai_providers.openrouter.api_key.unwrap_or_default();
        let key = key.trim();
        let codex_home = openrouter_codex_home(app)?;
        set_or_unset_env(
            handle,
            "OPENAI_BASE_URL",
            Some("https://openrouter.ai/api/v1"),
        )?;
        set_or_unset_env(
            handle,
            "OPENAI_API_KEY",
            if key.is_empty() { None } else { Some(key) },
        )?;
        set_or_unset_env(
            handle,
            "OPENROUTER_API_KEY",
            if key.is_empty() { None } else { Some(key) },
        )?;
        set_or_unset_env(
            handle,
            "CODEX_HOME",
            Some(codex_home.to_string_lossy().as_ref()),
        )?;
    } else {
        let key = settings.ai_providers.openai.api_key.unwrap_or_default();
        let key = key.trim();
        set_or_unset_env(handle, "OPENAI_BASE_URL", None)?;
        set_or_unset_env(
            handle,
            "OPENAI_API_KEY",
            if key.is_empty() { None } else { Some(key) },
        )?;
        set_or_unset_env(handle, "OPENROUTER_API_KEY", None)?;
        set_or_unset_env(handle, "CODEX_HOME", None)?;
    }

    Ok(use_openrouter)
}

#[cfg(test)]
mod tests {
    use super::{agent_command_with_model, is_valid_env_var_name, AgentType};

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

    #[test]
    fn codex_command_defaults_to_workspace_write_without_model() {
        let cmd = agent_command_with_model(AgentType::Codex, "codex", None, false);
        assert!(cmd.contains("--sandbox workspace-write"));
        assert!(cmd.contains("--ask-for-approval on-failure"));
        assert!(cmd.contains("-c 'model_reasoning_effort=\"high\"'"));
    }

    #[test]
    fn codex_command_adds_model_override() {
        let cmd = agent_command_with_model(
            AgentType::Codex,
            "codex",
            Some("gpt-5.3-codex"),
            false,
        );
        assert!(cmd.contains("-c 'model=\"gpt-5.3-codex\"'"));
    }

    #[test]
    fn codex_command_can_force_api_login() {
        let cmd = agent_command_with_model(AgentType::Codex, "codex", None, true);
        assert!(cmd.contains("-c 'forced_login_method=\"api\"'"));
    }
}
