use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct EnvironmentStatus {
    pub ready: bool,
    pub running: bool,
    pub percent: u32,
    pub error: Option<String>,
    pub log_path: String,
}

static ENVIRONMENT_STATUS: OnceLock<Mutex<EnvironmentStatus>> = OnceLock::new();
static ENVIRONMENT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const ENVIRONMENT_MARKER: &str = "muse-environment-v3";

fn audio2sheets_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".audio2sheets")
}

pub fn get_venv_python() -> PathBuf {
    let venv = audio2sheets_dir().join("venv");
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

pub fn environment_log_path() -> PathBuf {
    audio2sheets_dir().join("logs").join("environment.log")
}

pub fn pipeline_log_path() -> PathBuf {
    audio2sheets_dir().join("logs").join("pipeline.log")
}

fn status_store() -> &'static Mutex<EnvironmentStatus> {
    ENVIRONMENT_STATUS.get_or_init(|| Mutex::new(EnvironmentStatus {
        ready: false,
        running: false,
        percent: 0,
        error: None,
        log_path: environment_log_path().to_string_lossy().to_string(),
    }))
}

pub fn environment_status() -> EnvironmentStatus {
    status_store().lock().unwrap().clone()
}

fn set_status(update: impl FnOnce(&mut EnvironmentStatus)) {
    if let Ok(mut status) = status_store().lock() {
        update(&mut status);
    }
}

fn emit_environment_status(app: &AppHandle) {
    let _ = app.emit("environment:status", environment_status());
}

fn log_environment(message: impl AsRef<str>) {
    append_log(&environment_log_path(), message);
}

pub fn log_pipeline(message: impl AsRef<str>) {
    append_log(&pipeline_log_path(), message);
}

fn append_log(path: &PathBuf, message: impl AsRef<str>) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|_| "unknown-time".to_string());
        let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
    }
}

fn mark_progress<F>(on_progress: &mut F, percent: u32)
where
    F: FnMut(u32),
{
    set_status(|status| {
        status.percent = percent;
        status.error = None;
    });
    on_progress(percent);
}

pub fn get_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("python");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not locate application resources: {e}"))?
        .join("python");
    if resource_path.exists() {
        return Ok(resource_path);
    }
    Err(format!("Python resources not found at {}", resource_path.display()))
}

fn find_system_python() -> Result<(String, Vec<String>), String> {
    let candidates = [
        ("python", Vec::new()),
        ("py", vec!["-3".to_string()]),
        ("python3", Vec::new()),
    ];
    for (program, prefix) in candidates {
        let mut command = Command::new(program);
        command.args(&prefix).arg("--version");
        if let Ok(output) = command.output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                let version = if version.trim().is_empty() {
                    String::from_utf8_lossy(&output.stderr).to_string()
                } else {
                    version.to_string()
                };
                let parts: Vec<_> = version.trim().split_whitespace().nth(1)
                    .unwrap_or("").split('.').collect();
                if parts.len() >= 2 && parts[0] == "3" && parts[1].parse::<u32>().unwrap_or(0) >= 10 {
                    return Ok((program.to_string(), prefix));
                }
            }
        }
    }
    Err("Python 3.10 or newer is required. Install Python from python.org and try again.".to_string())
}

fn run_command(mut command: Command, label: &str) -> Result<(), String> {
    log_environment(format!("Starting {label}: {command:?}"));
    let output = command
        .output()
        .map_err(|e| format!("Failed to start {label}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        log_environment(format!("{label} stdout: {stdout}"));
    }
    if !stderr.is_empty() {
        log_environment(format!("{label} stderr: {stderr}"));
    }
    if output.status.success() {
        log_environment(format!("{label} completed successfully"));
        return Ok(());
    }
    let detail = stderr;
    log_environment(format!("{label} exited with status {}", output.status));
    Err(format!("{label} failed{}", if detail.is_empty() { String::new() } else { format!(": {detail}") }))
}

pub fn ensure_environment<F>(app: &AppHandle, mut on_progress: F) -> Result<PathBuf, String>
where
    F: FnMut(u32),
{
    let _lock = ENVIRONMENT_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    set_status(|status| {
        status.running = true;
        status.error = None;
    });
    log_environment("Environment setup check started");

    let venv_python = get_venv_python();
    let result = ensure_environment_locked(app, &mut on_progress, &venv_python);
    match &result {
        Ok(_) => {
            set_status(|status| {
                status.ready = true;
                status.running = false;
                status.percent = 100;
                status.error = None;
            });
            log_environment("Environment is ready");
        }
        Err(error) => {
            set_status(|status| {
                status.ready = false;
                status.running = false;
                status.error = Some(error.clone());
            });
            log_environment(format!("Environment setup failed: {error}"));
        }
    }
    result
}

pub fn start_environment_setup(app: &AppHandle) {
    let current = environment_status();
    if current.ready || current.running {
        return;
    }

    set_status(|status| {
        status.running = true;
        status.error = None;
        status.percent = 0;
    });
    log_environment("Starting background environment setup");
    emit_environment_status(app);

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let progress_app = app_handle.clone();
        let _ = ensure_environment(&app_handle, |percent| {
            set_status(|status| {
                status.running = true;
                status.percent = percent;
                status.error = None;
            });
            emit_environment_status(&progress_app);
        });
        emit_environment_status(&app_handle);
    });
}

#[tauri::command]
pub fn get_environment_status() -> EnvironmentStatus {
    environment_status()
}

#[tauri::command]
pub fn retry_environment_setup(app: AppHandle) -> EnvironmentStatus {
    start_environment_setup(&app);
    environment_status()
}

fn ensure_environment_locked<F>(
    app: &AppHandle,
    on_progress: &mut F,
    venv_python: &PathBuf,
) -> Result<PathBuf, String>
where
    F: FnMut(u32),
{
    let python_dir = get_python_dir(app)?;
    let marker = audio2sheets_dir().join(".environment-ready");
    let marker_matches = std::fs::read_to_string(&marker)
        .map(|content| content.trim() == ENVIRONMENT_MARKER)
        .unwrap_or(false);
    if venv_python.exists() && marker_matches {
        mark_progress(on_progress, 100);
        return Ok(venv_python.clone());
    }

    let requirements = python_dir.join("requirements.txt");
    let setup_script = python_dir.join("setup.py");
    if !requirements.exists() || !setup_script.exists() {
        return Err(format!("Python setup files are missing from {}", python_dir.display()));
    }

    std::fs::create_dir_all(audio2sheets_dir())
        .map_err(|e| format!("Could not create {}: {e}", audio2sheets_dir().display()))?;
    let (system_python, prefix) = find_system_python()?;

    log_environment(format!("Using Python resources from {}", python_dir.display()));
    mark_progress(on_progress, 2);
    if !venv_python.exists() {
        let mut command = Command::new(&system_python);
        command.args(&prefix).args(["-m", "venv"]);
        command.arg(venv_python.parent().unwrap().parent().unwrap());
        run_command(command, "Python virtual environment creation")?;
    }

    mark_progress(on_progress, 8);
    let pm2s_dir = audio2sheets_dir().join("pm2s");
    let mut setup = Command::new(&venv_python);
    setup
        .arg(&setup_script)
        .args(["--requirements", requirements.to_str().unwrap()])
        .args(["--pm2s-dir", pm2s_dir.to_str().unwrap()])
        .stderr(Stdio::piped())
        .stdout(Stdio::null());
    log_environment(format!("Starting Python setup script: {setup:?}"));
    let mut child = setup.spawn().map_err(|e| format!("Failed to start Python setup: {e}"))?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture Python setup output".to_string())?;
    let mut last_error = String::new();
    for line in BufReader::new(stderr).lines() {
        let line = line.unwrap_or_default();
        if !line.trim().is_empty() {
            log_environment(format!("setup.py: {line}"));
        }
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(percent) = event.get("percent").and_then(|value| value.as_u64()) {
                mark_progress(on_progress, percent as u32);
            }
        } else if !line.trim().is_empty() {
            last_error = line;
        }
    }
    let status = child.wait().map_err(|e| format!("Python setup process error: {e}"))?;
    if !status.success() {
        return Err(if last_error.is_empty() {
            "Python dependency setup failed. Check your network connection and Python installation.".to_string()
        } else {
            format!("Python setup failed: {last_error}")
        });
    }
    std::fs::write(&marker, ENVIRONMENT_MARKER)
        .map_err(|e| format!("Could not save setup status: {e}"))?;
    mark_progress(on_progress, 100);
    Ok(venv_python.clone())
}
