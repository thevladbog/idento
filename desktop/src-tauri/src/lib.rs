//! Idento Kiosk - Tauri desktop app for check-in and equipment settings.

mod commands;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(commands::AgentProcess::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_request,
            commands::get_agent_port,
            commands::spawn_agent,
            commands::stop_agent,
            commands::restart_agent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Idento Kiosk")
        .run(|app_handle, event| {
            // tauri-plugin-shell's own on_event hook kills children it
            // spawned via its JS-invoked IPC command on RunEvent::Exit --
            // it does not cover commands::spawn_agent, which calls
            // Command::spawn() directly from Rust (see AgentProcess's own
            // doc comment). RunEvent::Exit (not ExitRequested) matches the
            // shell plugin's own choice: Exit fires only once the app is
            // definitely closing, whereas ExitRequested can be intercepted
            // and the exit cancelled.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<commands::AgentProcess>() {
                    commands::kill_agent_process(&state);
                }
            }
        });
}
