use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

use crate::events::{
    now_rfc3339, LocalhostSessionLogEvent, LocalhostSessionStatusEvent, LOCALHOST_LOG_EVENT_NAME,
    LOCALHOST_STATUS_EVENT_NAME,
};

pub type SharedLocalhostRuntime = Arc<Mutex<LocalhostRuntime>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalhostSessionType {
    Web,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalhostPortMode {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalhostSessionStatus {
    Stopped,
    Starting,
    Running,
    Exited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostSessionSpec {
    pub id: String,
    pub project_path: String,
    pub working_dir: String,
    pub source_label: String,
    pub r#type: LocalhostSessionType,
    pub port_mode: LocalhostPortMode,
    pub preferred_port: Option<u16>,
    pub auto_install_deps: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostSessionView {
    #[serde(flatten)]
    pub spec: LocalhostSessionSpec,
    pub status: LocalhostSessionStatus,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub url: Option<String>,
    pub last_exit_code: Option<i32>,
    pub cmdline: Option<String>,
}

#[derive(Debug)]
struct RunningSession {
    spec: LocalhostSessionSpec,
    status: LocalhostSessionStatus,
    port: Option<u16>,
    pid: Option<u32>,
    url: Option<String>,
    last_exit_code: Option<i32>,
    cmdline: Option<String>,

    // Best-effort process control.
    child: Option<Child>,
    stop: Arc<AtomicBool>,

    // Small in-memory log buffer for debugging.
    logs: VecDeque<String>,
}

#[derive(Debug, Default)]
pub struct LocalhostRuntime {
    // Keyed by "<project_path>::<id>" so multiple projects can coexist.
    running: HashMap<String, RunningSession>,
}

fn rt_key(project_path: &str, id: &str) -> String {
    format!("{project_path}::{id}")
}

fn project_slug(project_path: &Path) -> String {
    project_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn sessions_path(app: &tauri::AppHandle, project_path: &Path) -> Result<PathBuf> {
    let project = project_slug(project_path);
    app.path()
        .resolve(format!("synk/localhost/{project}/sessions.json"), BaseDirectory::Config)
        .context("resolve localhost sessions path")
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).with_context(|| format!("create {}", p.display()))?;
    }
    Ok(())
}

fn load_specs(app: &tauri::AppHandle, project_path: &Path) -> Result<Vec<LocalhostSessionSpec>> {
    let path = sessions_path(app, project_path)?;
    let text = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let parsed: Vec<LocalhostSessionSpec> = serde_json::from_str(&text).unwrap_or_default();
    Ok(parsed)
}

fn save_specs(app: &tauri::AppHandle, project_path: &Path, specs: &[LocalhostSessionSpec]) -> Result<()> {
    let path = sessions_path(app, project_path)?;
    ensure_parent(&path)?;
    let text = serde_json::to_string_pretty(specs).context("serialize localhost sessions")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{n}")
}

fn npm_cmd() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn npx_cmd() -> &'static str {
    if cfg!(windows) {
        "npx.cmd"
    } else {
        "npx"
    }
}

fn is_node_modules_present(dir: &Path) -> bool {
    dir.join("node_modules").is_dir()
}

fn is_port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn pick_free_port(preferred: Option<u16>) -> Result<u16> {
    if let Some(p) = preferred {
        if is_port_free(p) {
            return Ok(p);
        }
        return Err(anyhow!("port {p} is not available"));
    }

    for p in 1430u16..=1530u16 {
        if is_port_free(p) {
            return Ok(p);
        }
    }
    Err(anyhow!("unable to find a free port (tried 1430-1530)"))
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        let addr = format!("127.0.0.1:{port}");
        let to = Duration::from_millis(250);
        if TcpStream::connect_timeout(&addr.parse().unwrap(), to).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

#[cfg(unix)]
fn terminate_process_group(pid: u32) {
    unsafe {
        // Negative pid targets the process group.
        let _ = libc::kill(-(pid as i32), libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(350));
    // If still alive, SIGKILL.
    let still_alive = unsafe { libc::kill(-(pid as i32), 0) == 0 };
    if still_alive {
        unsafe {
            let _ = libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

impl LocalhostRuntime {
    pub fn get_spec(
        &self,
        app: &tauri::AppHandle,
        project_path: &Path,
        id: &str,
    ) -> Result<Option<LocalhostSessionSpec>> {
        let specs = load_specs(app, project_path)?;
        Ok(specs.into_iter().find(|s| s.id == id))
    }

    pub fn list(
        &self,
        app: &tauri::AppHandle,
        project_path: &Path,
    ) -> Result<Vec<LocalhostSessionView>> {
        let specs = load_specs(app, project_path)?;
        let mut out = Vec::new();
        for spec in specs {
            let key = rt_key(&spec.project_path, &spec.id);
            if let Some(r) = self.running.get(&key) {
                out.push(LocalhostSessionView {
                    spec: r.spec.clone(),
                    status: r.status,
                    port: r.port,
                    pid: r.pid,
                    url: r.url.clone(),
                    last_exit_code: r.last_exit_code,
                    cmdline: r.cmdline.clone(),
                });
            } else {
                out.push(LocalhostSessionView {
                    spec,
                    status: LocalhostSessionStatus::Stopped,
                    port: None,
                    pid: None,
                    url: None,
                    last_exit_code: None,
                    cmdline: None,
                });
            }
        }
        Ok(out)
    }

    pub fn upsert_spec(
        &mut self,
        app: &tauri::AppHandle,
        mut spec: LocalhostSessionSpec,
    ) -> Result<Vec<LocalhostSessionSpec>> {
        let project_path_str = spec.project_path.clone();
        let project_path = Path::new(&project_path_str);
        let mut specs = load_specs(app, project_path)?;

        if spec.id.trim().is_empty() {
            spec.id = new_id();
        }
        if spec.created_at.is_none() {
            spec.created_at = Some(now_rfc3339());
        }

        let mut replaced = false;
        for s in specs.iter_mut() {
            if s.id == spec.id {
                *s = spec.clone();
                replaced = true;
                break;
            }
        }
        if !replaced {
            specs.push(spec);
        }

        save_specs(app, project_path, &specs)?;
        Ok(specs)
    }

    pub fn delete_spec(
        &mut self,
        app: &tauri::AppHandle,
        project_path: &Path,
        id: &str,
    ) -> Result<Vec<LocalhostSessionSpec>> {
        let mut specs = load_specs(app, project_path)?;
        specs.retain(|s| s.id != id);
        save_specs(app, project_path, &specs)?;
        Ok(specs)
    }

    pub fn logs(&self, project_path: &str, id: &str) -> Vec<String> {
        let key = rt_key(project_path, id);
        let Some(r) = self.running.get(&key) else {
            return Vec::new();
        };
        r.logs.iter().cloned().collect()
    }

    pub fn is_running(&self, project_path: &str, id: &str) -> bool {
        let key = rt_key(project_path, id);
        self.running
            .get(&key)
            .map(|r| matches!(r.status, LocalhostSessionStatus::Starting | LocalhostSessionStatus::Running))
            .unwrap_or(false)
    }

    pub fn stop(&mut self, app: tauri::AppHandle, project_path: &str, id: &str) -> Result<()> {
        let key = rt_key(project_path, id);
        let Some(r) = self.running.remove(&key) else {
            return Ok(());
        };

        r.stop.store(true, Ordering::Relaxed);
        if let Some(pid) = r.pid {
            // Best-effort termination of the whole process tree.
            terminate_process_group(pid);
        }

        // Emit a final "stopped" status.
        let _ = app.emit(
            LOCALHOST_STATUS_EVENT_NAME,
            LocalhostSessionStatusEvent {
                project_path: project_path.to_string(),
                id: id.to_string(),
                status: LocalhostSessionStatus::Stopped,
                port: None,
                pid: None,
                url: None,
                last_exit_code: None,
            },
        );
        Ok(())
    }

    pub fn start(
        &mut self,
        app: tauri::AppHandle,
        spec: LocalhostSessionSpec,
    ) -> Result<LocalhostSessionView> {
        if spec.project_path.trim().is_empty() {
            return Err(anyhow!("missing projectPath"));
        }
        if spec.working_dir.trim().is_empty() {
            return Err(anyhow!("missing workingDir"));
        }

        let port = match spec.port_mode {
            LocalhostPortMode::Manual => pick_free_port(spec.preferred_port)?,
            LocalhostPortMode::Auto => pick_free_port(None)?,
        };

        let url = Some(format!("http://localhost:{port}"));
        let key = rt_key(&spec.project_path, &spec.id);
        if self.is_running(&spec.project_path, &spec.id) {
            return Err(anyhow!("session already running"));
        }

        let stop = Arc::new(AtomicBool::new(false));
        self.running.insert(
            key.clone(),
            RunningSession {
                spec: spec.clone(),
                status: LocalhostSessionStatus::Starting,
                port: Some(port),
                pid: None,
                url: url.clone(),
                last_exit_code: None,
                cmdline: None,
                child: None,
                stop: stop.clone(),
                logs: VecDeque::new(),
            },
        );

        // Emit initial status immediately so the UI flips to "starting".
        let _ = app.emit(
            LOCALHOST_STATUS_EVENT_NAME,
            LocalhostSessionStatusEvent {
                project_path: spec.project_path.clone(),
                id: spec.id.clone(),
                status: LocalhostSessionStatus::Starting,
                port: Some(port),
                pid: None,
                url: url.clone(),
                last_exit_code: None,
            },
        );

        Ok(LocalhostSessionView {
            spec,
            status: LocalhostSessionStatus::Starting,
            port: Some(port),
            pid: None,
            url,
            last_exit_code: None,
            cmdline: None,
        })
    }

    pub fn start_with_runtime(
        runtime: SharedLocalhostRuntime,
        app: tauri::AppHandle,
        spec: LocalhostSessionSpec,
    ) -> Result<LocalhostSessionView> {
        let mut guard = runtime.lock().expect("localhost runtime mutex poisoned");
        let view = guard.start(app.clone(), spec.clone())?;
        drop(guard);

        // Background worker: install deps (optional), then spawn long-running dev process,
        // stream logs, and update status when ready/exited.
        std::thread::spawn(move || {
            if let Err(err) = run_localhost_session(runtime.clone(), app.clone(), spec.clone()) {
                push_log(
                    &runtime,
                    &app,
                    &spec,
                    "stderr",
                    &format!("[synk] localhost session crashed: {err:#}"),
                );
                set_status(
                    &runtime,
                    &app,
                    &spec,
                    LocalhostSessionStatus::Exited,
                    None,
                    Some(1),
                );
            }
        });

        Ok(view)
    }

    pub fn shutdown_all(&mut self, app: tauri::AppHandle) {
        let keys: Vec<String> = self.running.keys().cloned().collect();
        for key in keys {
            if let Some(r) = self.running.remove(&key) {
                if let Some(pid) = r.pid {
                    terminate_process_group(pid);
                }
                let _ = app.emit(
                    LOCALHOST_STATUS_EVENT_NAME,
                    LocalhostSessionStatusEvent {
                        project_path: r.spec.project_path.clone(),
                        id: r.spec.id.clone(),
                        status: LocalhostSessionStatus::Stopped,
                        port: None,
                        pid: None,
                        url: None,
                        last_exit_code: None,
                    },
                );
            }
        }
    }
}

fn push_log(runtime: &SharedLocalhostRuntime, app: &tauri::AppHandle, spec: &LocalhostSessionSpec, stream: &str, line: &str) {
    let key = rt_key(&spec.project_path, &spec.id);
    if let Ok(mut guard) = runtime.lock() {
        if let Some(r) = guard.running.get_mut(&key) {
            r.logs.push_back(line.to_string());
            while r.logs.len() > 600 {
                r.logs.pop_front();
            }
        }
    }

    let _ = app.emit(
        LOCALHOST_LOG_EVENT_NAME,
        LocalhostSessionLogEvent {
            project_path: spec.project_path.clone(),
            id: spec.id.clone(),
            stream: stream.to_string(),
            line: line.to_string(),
            timestamp: now_rfc3339(),
        },
    );
}

fn set_status(
    runtime: &SharedLocalhostRuntime,
    app: &tauri::AppHandle,
    spec: &LocalhostSessionSpec,
    status: LocalhostSessionStatus,
    pid: Option<u32>,
    last_exit_code: Option<i32>,
) {
    let key = rt_key(&spec.project_path, &spec.id);
    let mut port = None;
    let mut url = None;
    if let Ok(mut guard) = runtime.lock() {
        if let Some(r) = guard.running.get_mut(&key) {
            r.status = status;
            if pid.is_some() {
                r.pid = pid;
            }
            if last_exit_code.is_some() {
                r.last_exit_code = last_exit_code;
            }
            port = r.port;
            url = r.url.clone();
        }
    }

    let _ = app.emit(
        LOCALHOST_STATUS_EVENT_NAME,
        LocalhostSessionStatusEvent {
            project_path: spec.project_path.clone(),
            id: spec.id.clone(),
            status,
            port,
            pid,
            url,
            last_exit_code,
        },
    );
}

fn run_localhost_session(runtime: SharedLocalhostRuntime, app: tauri::AppHandle, spec: LocalhostSessionSpec) -> Result<()> {
    let working_dir = PathBuf::from(&spec.working_dir);
    let port = {
        let guard = runtime.lock().expect("localhost runtime mutex poisoned");
        let key = rt_key(&spec.project_path, &spec.id);
        guard
            .running
            .get(&key)
            .and_then(|r| r.port)
            .ok_or_else(|| anyhow!("missing port for running session"))?
    };

    // Optional: install deps if node_modules missing.
    if spec.auto_install_deps && !is_node_modules_present(&working_dir) {
        push_log(
            &runtime,
            &app,
            &spec,
            "stdout",
            "[synk] node_modules missing; running npm install…",
        );

        let mut cmd = Command::new(npm_cmd());
        cmd.current_dir(&working_dir)
            .arg("install")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().context("spawn npm install")?;
        let pid = child.id();
        push_log(&runtime, &app, &spec, "stdout", &format!("[synk] npm install pid={pid}"));

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            let runtime2 = runtime.clone();
            let app2 = app.clone();
            let spec2 = spec.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().flatten() {
                    push_log(&runtime2, &app2, &spec2, "stdout", &line);
                }
            });
        }
        if let Some(err) = stderr {
            let runtime2 = runtime.clone();
            let app2 = app.clone();
            let spec2 = spec.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    push_log(&runtime2, &app2, &spec2, "stderr", &line);
                }
            });
        }

        let status = child.wait().context("wait npm install")?;
        if !status.success() {
            return Err(anyhow!("npm install failed with {status}"));
        }
        push_log(&runtime, &app, &spec, "stdout", "[synk] npm install complete");
    }

    let mut envs = HashMap::<String, String>::new();
    envs.insert("SYNK_VITE_PORT".to_string(), port.to_string());
    envs.insert("SYNK_VITE_HMR_PORT".to_string(), (port + 1).to_string());

    // Spawn long-running dev process.
    let (cmdline, child) = match spec.r#type {
        LocalhostSessionType::Web => {
            let mut c = Command::new(npm_cmd());
            c.current_dir(&working_dir)
                .arg("run")
                .arg("dev")
                .envs(envs.iter())
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let cmdline = format!("{} run dev", npm_cmd());
            let child = spawn_detached_process_group(c).context("spawn npm run dev")?;
            (cmdline, child)
        }
        LocalhostSessionType::Desktop => {
            // Use a unique identifier per running instance so multiple desktop previews
            // can run side-by-side without the OS treating them as a single app instance.
            let merged = serde_json::json!({
                "identifier": format!("com.jaden-burton.synk.dev{port}"),
                "build": { "devUrl": format!("http://localhost:{port}") }
            });
            let mut c = Command::new(npx_cmd());
            c.current_dir(&working_dir)
                .arg("tauri")
                .arg("dev")
                .arg("-c")
                .arg(merged.to_string())
                .envs(envs.iter())
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let cmdline = format!("{} tauri dev -c <json>", npx_cmd());
            let child = spawn_detached_process_group(c).context("spawn npx tauri dev")?;
            (cmdline, child)
        }
    };

    let pid = child.id();
    push_log(&runtime, &app, &spec, "stdout", &format!("[synk] started pid={pid} ({cmdline})"));

    // Store child handle/cmdline + pid.
    let (stdout, stderr) = {
        let key = rt_key(&spec.project_path, &spec.id);
        let mut stdout = None;
        let mut stderr = None;
        if let Ok(mut guard) = runtime.lock() {
            if let Some(r) = guard.running.get_mut(&key) {
                r.pid = Some(pid);
                r.cmdline = Some(cmdline.clone());
                r.child = Some(child);
                stdout = r.child.as_mut().and_then(|c| c.stdout.take());
                stderr = r.child.as_mut().and_then(|c| c.stderr.take());
            }
        }
        (stdout, stderr)
    };
    set_status(&runtime, &app, &spec, LocalhostSessionStatus::Starting, Some(pid), None);

    if let Some(out) = stdout {
        let runtime2 = runtime.clone();
        let app2 = app.clone();
        let spec2 = spec.clone();
        thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().flatten() {
                push_log(&runtime2, &app2, &spec2, "stdout", &line);
            }
        });
    }
    if let Some(err) = stderr {
        let runtime2 = runtime.clone();
        let app2 = app.clone();
        let spec2 = spec.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().flatten() {
                push_log(&runtime2, &app2, &spec2, "stderr", &line);
            }
        });
    }

    // Wait until the server responds before flipping to "running".
    if wait_for_port(port, Duration::from_secs(25)) {
        set_status(&runtime, &app, &spec, LocalhostSessionStatus::Running, Some(pid), None);
    }

    // Monitor exit.
    loop {
        // If asked to stop, exit background monitor; stop command already sent SIGTERM/SIGKILL.
        if let Ok(guard) = runtime.lock() {
            let key = rt_key(&spec.project_path, &spec.id);
            if let Some(r) = guard.running.get(&key) {
                if r.stop.load(Ordering::Relaxed) {
                    break;
                }
            } else {
                break;
            }
        }

        let exit_opt = {
            let mut guard = runtime.lock().expect("localhost runtime mutex poisoned");
            let key = rt_key(&spec.project_path, &spec.id);
            let Some(r) = guard.running.get_mut(&key) else {
                break;
            };

            let mut exit_opt = None;
            if let Some(child) = r.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        exit_opt = Some(status.code().unwrap_or(0));
                    }
                    Ok(None) => {}
                    Err(_) => {}
                }
            }
            exit_opt
        };

        if let Some(code) = exit_opt {
            set_status(
                &runtime,
                &app,
                &spec,
                LocalhostSessionStatus::Exited,
                Some(pid),
                Some(code),
            );
            break;
        }

        std::thread::sleep(Duration::from_millis(250));
    }

    Ok(())
}

#[cfg(unix)]
fn spawn_detached_process_group(mut cmd: Command) -> Result<Child> {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            // Create a new process group so we can terminate the whole tree.
            let rc = libc::setpgid(0, 0);
            if rc != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().context("spawn detached child")
}

#[cfg(not(unix))]
fn spawn_detached_process_group(cmd: Command) -> Result<Child> {
    cmd.spawn().context("spawn child")
}
