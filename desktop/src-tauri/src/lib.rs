//! Idento Kiosk - Tauri desktop app for check-in and equipment settings.

mod commands;

use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::agent_request,
            commands::get_agent_port,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            if let Ok(sidecar) = app.shell().sidecar("idento-agent") {
                if let Err(e) = sidecar
                    .args(["--port", commands::AGENT_PORT_STR])
                    .spawn()
                {
                    log::error!(
                        "failed to spawn idento-agent (port {}): {}",
                        commands::AGENT_PORT_STR,
                        e
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Idento Kiosk");
}
