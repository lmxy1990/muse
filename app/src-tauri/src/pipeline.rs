use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

use crate::setup::{ensure_environment, get_python_dir, log_pipeline};

#[cfg(target_os = "windows")]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(0x08000000);
}

#[cfg(not(target_os = "windows"))]
fn hide_console_window(_command: &mut Command) {}

#[derive(Clone, Serialize)]
pub struct PipelineProgress {
    pub stage: String,
    pub percent: u32,
}

#[derive(Clone, Serialize)]
pub struct PipelineResult {
    pub metadata: PipelineMetadata,
    pub midi_path: Option<String>,
    pub perf_midi_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PipelineMetadata {
    pub key: String,
    #[serde(rename = "timeSignature")]
    pub time_signature: Vec<u32>,
    #[serde(default = "default_tempo")]
    pub tempo: u32,
    #[serde(default)]
    pub instruments: Vec<String>,
}

fn default_tempo() -> u32 {
    120
}

#[derive(Deserialize)]
struct PythonProgress {
    stage: Option<String>,
    percent: Option<u32>,
}

#[derive(Deserialize)]
struct PythonResult {
    midi: Option<String>,
    perf_midi: Option<String>,
    metadata: Option<PipelineMetadata>,
}

#[tauri::command]
pub async fn start_pipeline(
    app: AppHandle,
    input: String,
    backend: Option<String>,
    solo_piano: Option<bool>,
) -> Result<PipelineResult, String> {
    let venv_python = ensure_environment(&app, |percent| {
        let _ = app.emit(
            "pipeline:progress",
            PipelineProgress { stage: "setup".to_string(), percent },
        );
    })?;
    let python_dir = get_python_dir(&app)?;
    let script = python_dir.join("pipeline.py");
    if !script.exists() {
        return Err(format!(
            "Pipeline script not found at {}",
            script.display()
        ));
    }

    log_pipeline(format!(
        "Starting pipeline: input={input}, backend={}, solo_piano={}",
        backend.as_deref().unwrap_or("transkun"),
        solo_piano.unwrap_or(false)
    ));

    let mut args = vec![
        script.to_str().unwrap().to_string(),
        input.clone(),
    ];
    if let Some(ref b) = backend {
        args.push("--backend".to_string());
        args.push(b.clone());
    }
    if solo_piano.unwrap_or(false) {
        args.push("--solo-piano".to_string());
    }

    let mut pipeline_command = Command::new(venv_python.to_str().unwrap());
    pipeline_command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut pipeline_command);

    let mut child = pipeline_command
        .spawn()
        .map_err(|e| {
            log_pipeline(format!("Failed to start pipeline: {e}"));
            format!("Failed to start pipeline: {}", e)
        })?;

    let stderr = child.stderr.take().expect("Failed to capture stderr");
    let stderr_reader = BufReader::new(stderr);
    let app_clone = app.clone();

    let stderr_handle = std::thread::spawn(move || {
        let mut last_error_line = String::new();
        for line in stderr_reader.lines() {
            if let Ok(line) = line {
                if !line.trim().is_empty() {
                    log_pipeline(format!("stderr: {line}"));
                }
                if let Ok(progress) = serde_json::from_str::<PythonProgress>(&line) {
                    if let (Some(stage), Some(percent)) = (progress.stage, progress.percent) {
                        let _ = app_clone.emit(
                            "pipeline:progress",
                            PipelineProgress { stage, percent },
                        );
                    }
                } else if !line.trim().is_empty() {
                    last_error_line = line;
                }
            }
        }
        last_error_line
    });

    let stdout_output = {
        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let reader = BufReader::new(stdout);
        let mut full_output = String::new();
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.trim().is_empty() {
                    log_pipeline(format!("stdout: {line}"));
                }
                if !full_output.is_empty() {
                    full_output.push('\n');
                }
                full_output.push_str(&line);
            }
        }
        full_output
    };

    let status = child
        .wait()
        .map_err(|e| format!("Pipeline process error: {}", e))?;
    let last_error = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        let detail = if last_error.is_empty() {
            "Check that the audio file is valid.".to_string()
        } else {
            last_error
        };
        log_pipeline(format!("Pipeline failed with status {status}: {detail}"));
        return Err(format!("Pipeline failed: {}", detail));
    }

    let mut metadata = PipelineMetadata {
        key: "C".to_string(),
        time_signature: vec![4, 4],
        tempo: 120,
        instruments: vec![],
    };
    let mut midi_path: Option<String> = None;
    let mut perf_midi_path: Option<String> = None;

    for line in stdout_output.lines().rev() {
        if let Ok(result) = serde_json::from_str::<PythonResult>(line) {
            if let Some(meta) = result.metadata {
                metadata = meta;
            }
            if let Some(mp) = result.midi {
                midi_path = Some(mp);
            }
            if let Some(pm) = result.perf_midi {
                perf_midi_path = Some(pm);
            }
            break;
        }
    }

    let _ = app.emit("pipeline:progress", PipelineProgress {
        stage: "done".to_string(),
        percent: 100,
    });

    log_pipeline("Pipeline completed successfully");
    Ok(PipelineResult { metadata, midi_path, perf_midi_path })
}

#[tauri::command]
pub fn prepare_playback_file(path: String) -> Result<String, String> {
    log_pipeline(format!("Playback prepare started: source={path}"));
    let source = PathBuf::from(&path);
    if !source.is_file() {
        log_pipeline(format!("Playback prepare failed: file not found: {path}"));
        return Err(format!("Playback file not found: {path}"));
    }

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("playback.bin");
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let playback_dir = std::env::temp_dir().join("muse-playback");
    if let Err(error) = fs::create_dir_all(&playback_dir) {
        log_pipeline(format!("Playback prepare failed: create directory: {error}"));
        return Err(format!("Failed to create playback directory: {error}"));
    }
    let destination = playback_dir.join(format!("{:x}-{file_name}", hasher.finish()));
    if let Err(error) = fs::copy(&source, &destination) {
        log_pipeline(format!("Playback prepare failed: copy to {}: {error}", destination.display()));
        return Err(format!("Failed to prepare playback file: {error}"));
    }
    let prepared = destination.to_string_lossy().to_string();
    log_pipeline(format!("Playback prepare completed: prepared={prepared}"));
    Ok(prepared)
}

#[tauri::command]
pub fn log_playback_event(message: String) {
    log_pipeline(format!("Playback: {message}"));
}
