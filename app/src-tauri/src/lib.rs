mod pipeline;
mod setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            setup::start_environment_setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pipeline::start_pipeline,
            pipeline::prepare_playback_file,
            pipeline::log_playback_event,
            setup::get_environment_status,
            setup::retry_environment_setup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
