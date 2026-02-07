use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub initial_pool_size: usize, // default: 2
    pub max_pool_size: usize,     // default: 4
    pub max_active: usize,        // default: 12
    pub recycle_enabled: bool,    // default: true
    pub max_pty_age: Duration,    // default: 30 minutes

    pub warmup_delay: Duration,          // default: 100ms between spawns
    pub warmup_timeout: Duration,        // default: 5s
    pub recycle_ready_timeout: Duration, // default: 2s
    pub refill_after_claim_delay: Duration, // default: 100ms
    pub spawn_shell_login_arg: Option<String>, // default: Some("--login")
    pub default_shell: String,           // default: $SHELL or /bin/bash
    pub default_pty_size: PtySize,       // default: 80x24
}

impl Default for PoolConfig {
    fn default() -> Self {
        let default_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        Self {
            initial_pool_size: 2,
            max_pool_size: 4,
            max_active: 12,
            recycle_enabled: true,
            max_pty_age: Duration::from_secs(30 * 60),
            warmup_delay: Duration::from_millis(100),
            warmup_timeout: Duration::from_secs(5),
            recycle_ready_timeout: Duration::from_secs(2),
            refill_after_claim_delay: Duration::from_millis(100),
            spawn_shell_login_arg: Some("--login".to_string()),
            default_shell,
            default_pty_size: PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PoolStats {
    pub idle: usize,
    pub active: usize,
    pub spawning_idle: usize,
}

#[derive(Debug)]
pub enum PtyState {
    Warming,
    Idle,
    Active,
    Recycling,
    Dead,
}

pub struct PtyHandle {
    pub pid: Option<u32>,
    pub shell: String,
    pub created_at: Instant,
    pub state: PtyState,

    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl PtyHandle {
    fn age(&self) -> Duration {
        self.created_at.elapsed()
    }

    pub fn kill(&mut self) {
        // Best-effort graceful termination on unix, with a hard kill fallback.
        // Matches Task 1.2: SIGTERM then SIGKILL after ~3s.
        self.terminate(Duration::from_secs(3));
        self.state = PtyState::Dead;
    }

    pub fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        Ok(())
    }

    pub fn write_str(&mut self, s: &str) -> Result<()> {
        self.write_all(s.as_bytes())
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn clone_reader(&mut self) -> Result<Box<dyn Read + Send>> {
        self.master.try_clone_reader().context("try_clone_reader")
    }

    #[cfg(unix)]
    pub fn master_fd(&self) -> Result<i32> {
        self.master
            .as_raw_fd()
            .ok_or_else(|| anyhow!("MasterPty::as_raw_fd() not available"))
    }

    fn wait_for_marker(&mut self, marker: &str, timeout: Duration) -> Result<String> {
        #[cfg(not(unix))]
        {
            let _ = marker;
            let _ = timeout;
            return Err(anyhow!(
                "PTY readiness polling is only implemented for unix targets"
            ));
        }

        #[cfg(unix)]
        {
            let fd = self
                .master
                .as_raw_fd()
                .ok_or_else(|| anyhow!("MasterPty::as_raw_fd() not available"))?;

            let mut reader = self.master.try_clone_reader().context("try_clone_reader")?;

            let start = Instant::now();
            let mut captured = String::new();

            while start.elapsed() < timeout {
                let remaining = timeout.saturating_sub(start.elapsed());
                let timeout_ms: i32 = remaining
                    .as_millis()
                    .min(i32::MAX as u128)
                    .try_into()
                    .unwrap_or(i32::MAX);

                let mut pfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };

                let rc = unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, timeout_ms) };
                if rc < 0 {
                    return Err(anyhow!(std::io::Error::last_os_error()))
                        .context("poll(master_fd)");
                }
                if rc == 0 {
                    continue; // keep waiting until overall timeout expires
                }

                if (pfd.revents & libc::POLLIN) == 0 {
                    continue;
                }

                let mut buf = [0u8; 4096];
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                captured.push_str(&String::from_utf8_lossy(&buf[..n]));
                if captured.contains(marker) {
                    return Ok(captured);
                }
            }

            Err(anyhow!("timeout waiting for marker"))
                .with_context(|| format!("marker={marker} timeout={timeout:?}"))
        }
    }

    fn wait_for_ready(&mut self, marker: &str, timeout: Duration) -> Result<String> {
        #[cfg(not(unix))]
        {
            let _ = marker;
            let _ = timeout;
            return Err(anyhow!(
                "PTY readiness polling is only implemented for unix targets"
            ));
        }

        #[cfg(unix)]
        {
            let fd = self
                .master
                .as_raw_fd()
                .ok_or_else(|| anyhow!("MasterPty::as_raw_fd() not available"))?;

            let mut reader = self.master.try_clone_reader().context("try_clone_reader")?;

            let start = Instant::now();
            let mut captured = String::new();

            while start.elapsed() < timeout {
                let remaining = timeout.saturating_sub(start.elapsed());
                let timeout_ms: i32 = remaining
                    .as_millis()
                    .min(i32::MAX as u128)
                    .try_into()
                    .unwrap_or(i32::MAX);

                let mut pfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };

                let rc = unsafe { libc::poll(&mut pfd as *mut libc::pollfd, 1, timeout_ms) };
                if rc < 0 {
                    return Err(anyhow!(std::io::Error::last_os_error()))
                        .context("poll(master_fd)");
                }
                if rc == 0 {
                    continue;
                }

                if (pfd.revents & libc::POLLIN) == 0 {
                    continue;
                }

                let mut buf = [0u8; 4096];
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }

                captured.push_str(&String::from_utf8_lossy(&buf[..n]));

                // Avoid unbounded growth if a misbehaving shell spews output.
                const CAPTURE_MAX: usize = 1024 * 1024; // 1 MiB
                if captured.len() > CAPTURE_MAX {
                    captured.drain(..captured.len().saturating_sub(CAPTURE_MAX));
                }

                if captured.contains(marker) {
                    return Ok(captured);
                }
                if tail_looks_like_prompt(&captured) {
                    return Ok(captured);
                }
            }

            Err(anyhow!("timeout waiting for readiness"))
                .with_context(|| format!("marker={marker} timeout={timeout:?}"))
        }
    }

    fn send_ready_marker(&mut self, token: &str) -> Result<String> {
        // Use %s so the exact "__SYNK_READY__:<token>" does not appear in the echoed input.
        let cmd = format!("printf \"__SYNK_READY__:%s\\\\n\" \"{token}\"\r\n");
        self.write_str(&cmd)?;
        Ok(format!("__SYNK_READY__:{token}"))
    }

    fn warm_to_idle(&mut self, token: &str, timeout: Duration) -> Result<()> {
        self.state = PtyState::Warming;
        let marker = self.send_ready_marker(token)?;
        let _ = self.wait_for_ready(&marker, timeout)?;
        self.state = PtyState::Idle;
        Ok(())
    }

    fn recycle_to_idle(&mut self, token: &str, timeout: Duration) -> Result<()> {
        self.state = PtyState::Recycling;
        // Best-effort cleanup; failures are handled by timeout/kill path in caller.
        let _ = self.write_all(b"\x03"); // Ctrl+C
        let _ = self.write_str("cd ~\r\nclear\r\nreset\r\n");

        let marker = self.send_ready_marker(token)?;
        let _ = self.wait_for_ready(&marker, timeout)?;
        self.state = PtyState::Idle;
        Ok(())
    }

    pub fn debug_roundtrip_echo(&mut self, timeout: Duration) -> Result<String> {
        let token = unique_token("echo");
        let marker = format!("__SYNK_ECHO__:{token}");
        self.write_str(&format!("echo {marker}\r\n"))?;
        self.wait_for_marker(&marker, timeout)
    }

    fn terminate(&mut self, grace: Duration) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }

        let start = Instant::now();
        while start.elapsed() < grace {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => {}
                Err(_) => break,
            }
            thread::sleep(Duration::from_millis(50));
        }

        #[cfg(unix)]
        if let Some(pid) = self.pid {
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }

        let _ = self.child.kill();

        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(500) {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
}

pub struct ProcessPool {
    idle_pool: VecDeque<PtyHandle>,
    // Session key -> pid (debug/stats only). Actual handles are owned by SessionManager.
    active: HashMap<usize, Option<u32>>,
    config: PoolConfig,
    spawning_idle: usize,
}

pub type SharedProcessPool = Arc<Mutex<ProcessPool>>;

impl ProcessPool {
    pub fn new(config: PoolConfig) -> Self {
        Self {
            idle_pool: VecDeque::new(),
            active: HashMap::new(),
            config,
            spawning_idle: 0,
        }
    }

    pub fn stats(&self) -> PoolStats {
        PoolStats {
            idle: self.idle_pool.len(),
            active: self.active.len(),
            spawning_idle: self.spawning_idle,
        }
    }

    pub fn warmup_in_background(pool: SharedProcessPool) {
        thread::spawn(move || {
            let (config, target) = {
                let guard = pool.lock().expect("pool mutex poisoned");
                (guard.config.clone(), guard.config.initial_pool_size)
            };

            for i in 0..target {
                match spawn_shell_pty(&config)
                    .and_then(|mut h| {
                        let token = unique_token(&format!("warm{i}"));
                        h.warm_to_idle(&token, config.warmup_timeout)?;
                        Ok(h)
                    })
                    .with_context(|| format!("warmup spawn {i}/{target}"))
                {
                    Ok(handle) => {
                        let mut guard = pool.lock().expect("pool mutex poisoned");
                        if guard.idle_pool.len() < guard.config.max_pool_size {
                            guard.idle_pool.push_back(handle);
                        } else {
                            // Avoid leaving an unmanaged child process running.
                            drop(guard);
                            let mut h = handle;
                            h.kill();
                        }
                    }
                    Err(err) => {
                        eprintln!("process_pool warmup failed: {err:#}");
                    }
                }

                thread::sleep(config.warmup_delay);
            }
        });
    }

    pub fn claim(pool: SharedProcessPool, session_key: usize) -> Result<PtyHandle> {
        {
            let guard = pool.lock().expect("pool mutex poisoned");
            if guard.active.contains_key(&session_key) {
                return Err(anyhow!("session_key {session_key} already active"));
            }
        }

        // Fast path: take from idle if available.
        let claimed_from_idle: Option<PtyHandle> = {
            let mut guard = pool.lock().expect("pool mutex poisoned");

            if guard.active.len() >= guard.config.max_active {
                return Err(anyhow!(
                    "max sessions reached ({})",
                    guard.config.max_active
                ));
            }

            let mut claimed: Option<PtyHandle> = None;
            while let Some(mut h) = guard.idle_pool.pop_front() {
                if h.age() > guard.config.max_pty_age {
                    h.kill();
                    continue;
                }
                h.state = PtyState::Active;
                guard.active.insert(session_key, h.pid);
                claimed = Some(h);
                break;
            }
            claimed
        };

        let handle = if let Some(h) = claimed_from_idle {
            h
        } else {
            // On-demand spawn fallback.
            let config = { pool.lock().expect("pool mutex poisoned").config.clone() };
            let mut h = spawn_shell_pty(&config)?;
            let token = unique_token("ondemand");
            h.warm_to_idle(&token, config.warmup_timeout)?;
            h.state = PtyState::Active;

            let mut guard = pool.lock().expect("pool mutex poisoned");
            guard.active.insert(session_key, h.pid);
            h
        };

        schedule_refill_if_needed(pool);
        Ok(handle)
    }

    pub fn release(pool: SharedProcessPool, session_key: usize, handle: PtyHandle) -> Result<()> {
        Self::release_inner(pool, session_key, handle, false)
    }

    pub fn recycle(pool: SharedProcessPool, session_key: usize, handle: PtyHandle) -> Result<()> {
        // Explicit API for the Task 1.2 deliverable.
        // This forces the recycle path even if recycle is disabled in the global config.
        Self::release_inner(pool, session_key, handle, true)
    }

    fn release_inner(
        pool: SharedProcessPool,
        session_key: usize,
        mut handle: PtyHandle,
        force_recycle: bool,
    ) -> Result<()> {
        let config = {
            let mut guard = pool.lock().expect("pool mutex poisoned");
            let _pid = guard
                .active
                .remove(&session_key)
                .ok_or_else(|| anyhow!("unknown session_key {session_key}"))?;
            guard.config.clone()
        };

        let should_recycle =
            (config.recycle_enabled || force_recycle) && handle.age() < config.max_pty_age;
        if should_recycle {
            let token = unique_token("recycle");
            if handle
                .recycle_to_idle(&token, config.recycle_ready_timeout)
                .is_ok()
            {
                {
                    let mut guard = pool.lock().expect("pool mutex poisoned");
                    if guard.idle_pool.len() < guard.config.max_pool_size {
                        guard.idle_pool.push_back(handle);
                    } else {
                        // Pool full; kill so we don't leave it running unmanaged.
                        drop(guard);
                        let mut h = handle;
                        h.kill();
                    }
                }

                schedule_refill_if_needed(pool);
                return Ok(());
            }
        }

        // Fall back to killing and letting refill happen if needed.
        handle.kill();
        schedule_refill_if_needed(pool);
        Ok(())
    }

    pub fn shutdown(pool: SharedProcessPool) -> Result<()> {
        // Drain all handles out of the pool so we don't hold the mutex while waiting for exits.
        let (idle, active_pids) = {
            let mut guard = pool.lock().expect("pool mutex poisoned");
            (
                std::mem::take(&mut guard.idle_pool),
                std::mem::take(&mut guard.active),
            )
        };

        for mut h in idle {
            h.kill();
        }

        // Best-effort kill of active sessions by pid. SessionManager owns the handles,
        // so we don't have access to portable-pty Child handles here.
        for (_k, pid) in active_pids {
            #[cfg(unix)]
            if let Some(pid) = pid {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                thread::sleep(Duration::from_millis(50));
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
        }

        Ok(())
    }

    pub fn debug_roundtrip(pool: SharedProcessPool) -> Result<String> {
        let session_key = 9999usize;
        let mut handle = Self::claim(pool.clone(), session_key)?;
        let output = handle.debug_roundtrip_echo(Duration::from_secs(2))?;
        Self::release(pool, session_key, handle)?;
        Ok(output)
    }
}

fn schedule_refill_if_needed(pool: SharedProcessPool) {
    let should_spawn = {
        let mut guard = pool.lock().expect("pool mutex poisoned");
        let cfg = &guard.config;

        let current_idle = guard.idle_pool.len();
        let inflight = guard.spawning_idle;
        let desired = cfg.initial_pool_size.min(cfg.max_pool_size);

        if current_idle + inflight >= desired {
            return;
        }

        guard.spawning_idle += 1;
        true
    };

    if !should_spawn {
        return;
    }

    thread::spawn(move || {
        let cfg = { pool.lock().expect("pool mutex poisoned").config.clone() };
        thread::sleep(cfg.refill_after_claim_delay);

        let spawned = spawn_shell_pty(&cfg).and_then(|mut h| {
            let token = unique_token("refill");
            h.warm_to_idle(&token, cfg.warmup_timeout)?;
            Ok(h)
        });

        let mut guard = pool.lock().expect("pool mutex poisoned");
        guard.spawning_idle = guard.spawning_idle.saturating_sub(1);

        match spawned {
            Ok(h) => {
                let desired = guard
                    .config
                    .initial_pool_size
                    .min(guard.config.max_pool_size);
                if guard.idle_pool.len() < desired {
                    guard.idle_pool.push_back(h);
                } else {
                    drop(guard);
                    let mut h = h;
                    h.kill();
                }
            }
            Err(err) => {
                eprintln!("process_pool refill spawn failed: {err:#}");
            }
        }
    });
}

fn spawn_shell_pty(config: &PoolConfig) -> Result<PtyHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(config.default_pty_size)?;

    let mut cmd = CommandBuilder::new(&config.default_shell);
    if let Some(arg) = &config.spawn_shell_login_arg {
        cmd.arg(arg);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).context("spawn_command")?;
    drop(pair.slave);

    let writer = pair.master.take_writer().context("take_writer")?;
    let pid = child.process_id();

    Ok(PtyHandle {
        pid,
        shell: config.default_shell.clone(),
        created_at: Instant::now(),
        state: PtyState::Warming,
        master: pair.master,
        writer,
        child,
    })
}

fn unique_token(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_nanos();
    format!("{prefix}-{nanos}")
}

fn tail_looks_like_prompt(captured: &str) -> bool {
    // Best-effort ANSI stripping. The deterministic marker is the primary signal;
    // this is a fallback for unusual shells/configs.
    let clean = strip_ansi(captured);
    let clean_lines = clean.replace('\r', "\n");
    let tail = clean_lines
        .lines()
        .last()
        .unwrap_or("")
        .trim_end_matches('\n');

    // Common prompt endings: "$ " (bash), "# " (root), "% " (zsh), "> " (ps-like).
    tail.ends_with("$ ") || tail.ends_with("# ") || tail.ends_with("% ") || tail.ends_with("> ")
}

fn strip_ansi(s: &str) -> String {
    // Minimal ANSI CSI stripping: ESC [ ... <final byte>.
    // This is intentionally conservative; it doesn't try to handle every sequence.
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\x1b' {
            out.push(ch);
            continue;
        }

        if chars.peek() == Some(&'[') {
            let _ = chars.next(); // consume '['
            while let Some(c) = chars.next() {
                if ('@'..='~').contains(&c) {
                    break;
                }
            }
            continue;
        }

        // Not CSI: keep the ESC.
        out.push(ch);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::{strip_ansi, tail_looks_like_prompt};

    #[test]
    fn strip_ansi_removes_simple_csi() {
        let s = "hi\x1b[31mred\x1b[0m!";
        assert_eq!(strip_ansi(s), "hired!");
    }

    #[test]
    fn prompt_detection_matches_common_suffixes() {
        assert!(tail_looks_like_prompt("user@host:~$ "));
        assert!(tail_looks_like_prompt("root@host:~# "));
        assert!(tail_looks_like_prompt("zsh% "));
        assert!(tail_looks_like_prompt("PS> "));
        assert!(!tail_looks_like_prompt("not a prompt\nhello world\n"));
    }
}
