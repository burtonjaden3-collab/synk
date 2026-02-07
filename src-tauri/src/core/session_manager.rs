use std::collections::{HashMap, HashSet};
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
use crate::events::{SessionExitEvent, SessionOutputEvent};

pub type SharedSessionManager = Arc<std::sync::Mutex<SessionManager>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    GeminiCli,
    Codex,
    Terminal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionArgs {
    #[serde(alias = "agent_type")]
    pub agent_type: AgentType,
    pub project_path: String,
    pub branch: Option<String>,
    pub working_dir: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: usize,
    pub pane_index: usize,
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
}

pub struct SessionManager {
    pool: SharedProcessPool,
    next_session_id: usize,
    sessions: HashMap<usize, SessionRecord>,
}

impl SessionManager {
    pub fn new(pool: SharedProcessPool) -> Self {
        Self {
            pool,
            next_session_id: 1,
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(
        &mut self,
        app: tauri::AppHandle,
        args: CreateSessionArgs,
    ) -> Result<CreateSessionResponse> {
        // Enforce the spec max (12). The pool also enforces this, but doing it here
        // gives a stable error message for the frontend.
        const MAX_SESSIONS: usize = 12;
        if self.sessions.len() >= MAX_SESSIONS {
            return Err(anyhow!("max sessions reached ({MAX_SESSIONS})"));
        }

        let session_id = self.alloc_session_id();
        let pane_index = self.alloc_pane_index(MAX_SESSIONS)?;

        let mut handle = ProcessPool::claim(self.pool.clone(), session_id)?;

        // If anything fails after we claim the PTY, return it to the pool so we don't leak.
        let built = (|| -> Result<(SessionInfo, Arc<AtomicBool>, JoinHandle<()>)> {
            // Session bootstrap: cd + env exports.
            let wd = args
                .working_dir
                .clone()
                .unwrap_or_else(|| args.project_path.clone());

            if let Some(env) = &args.env {
                for (k, v) in env {
                    handle.write_str(&format!(
                        "export {}='{}'\r\n",
                        k,
                        shell_single_quote_escape(v)
                    ))?;
                }
            }

            handle.write_str(&format!("export SYNK_SESSION_ID='{}'\r\n", session_id))?;
            handle.write_str(&format!(
                "export SYNK_PROJECT_PATH='{}'\r\n",
                shell_single_quote_escape(&args.project_path)
            ))?;

            handle.write_str(&format!("cd '{}'\r\n", shell_single_quote_escape(&wd)))?;

            // Start output pump before we insert the session record, so we can return
            // a fully-active session.
            let stop = Arc::new(AtomicBool::new(false));
            let output_thread = spawn_output_pump(
                app,
                session_id,
                stop.clone(),
                &mut handle, // used only to clone fd/reader
            )?;

            let info = SessionInfo {
                session_id,
                pane_index,
                agent_type: args.agent_type,
                project_path: args.project_path,
                branch: args.branch,
                working_dir: Some(wd),
            };

            Ok((info, stop, output_thread))
        })();

        let (info, stop, output_thread) = match built {
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
            },
        );

        Ok(CreateSessionResponse {
            session_id,
            pane_index,
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

        rec.stop.store(true, Ordering::Relaxed);
        let _ = rec.output_thread.join();

        // Return the PTY to the pool (recycle-or-kill is decided by PoolConfig).
        ProcessPool::release(self.pool.clone(), session_id, rec.handle)?;

        // Best-effort: if the frontend cares, it can mark the pane closed.
        let _ = app.emit(
            "session:exit",
            SessionExitEvent {
                session_id,
                exit_code: 0,
            },
        );

        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut out: Vec<_> = self.sessions.values().map(|r| r.info.clone()).collect();
        out.sort_by_key(|s| s.pane_index);
        out
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
}

fn spawn_output_pump(
    app: tauri::AppHandle,
    session_id: usize,
    stop: Arc<AtomicBool>,
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
