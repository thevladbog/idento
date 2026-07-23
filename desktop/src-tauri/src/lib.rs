//! Idento Kiosk - Tauri desktop app for check-in and equipment settings.

mod commands;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::AgentProcess::default())
        .manage(commands::UpdateHandleState::default())
        .manage(commands::LockdownState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent_request,
            commands::get_agent_port,
            commands::spawn_agent,
            commands::stop_agent,
            commands::restart_agent,
            commands::check_for_update,
            commands::install_update,
            commands::enter_lockdown,
            commands::exit_lockdown,
        ])
        .on_window_event(|window, event| {
            // Self-service lockdown (K2b): while LockdownState is true,
            // block window-close outright at the event level rather than
            // relying on set_closable alone (documented Linux caveat: GTK+
            // "will do its best", not a guarantee). Fails open (does NOT
            // prevent_close) if the state can't be read at all, since a
            // poisoned lockdown flag should never be able to trap the app
            // closed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let locked = window
                    .try_state::<commands::LockdownState>()
                    .map(|state| state.0.lock().map(|guard| *guard).unwrap_or(false))
                    .unwrap_or(false);
                if locked {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Idento Kiosk")
        .run(|app_handle, event| match &event {
            // tauri-plugin-shell's own on_event hook kills children it
            // spawned via its JS-invoked IPC command on RunEvent::Exit --
            // it does not cover commands::spawn_agent, which calls
            // Command::spawn() directly from Rust (see AgentProcess's own
            // doc comment). RunEvent::Exit (not ExitRequested) matches the
            // shell plugin's own choice: Exit fires only once the app is
            // definitely closing, whereas ExitRequested can be intercepted
            // and the exit cancelled. install_update's request_restart()
            // also triggers this same Exit event, so the sidecar is
            // cleanly stopped before the app relaunches post-update, with
            // no special-casing needed here.
            RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<commands::AgentProcess>() {
                    commands::kill_agent_process(&state);
                }
            }
            // Self-service lockdown (K2b), the app-level counterpart to
            // on_window_event's CloseRequested guard above: macOS Cmd+Q
            // and other "quit the whole app" paths raise ExitRequested
            // directly, never routing through a window's CloseRequested
            // event at all -- on_window_event alone does not cover them.
            // Same fail-open semantics as the close guard. Safe against
            // K3b's auto-update restart: AppHandle::request_restart()
            // raises ExitRequested with code Some(RESTART_EXIT_CODE), and
            // ExitRequestApi::prevent_exit() is a documented no-op for
            // that code (verified in the vendored tauri-2.11.5 source) --
            // calling it here unconditionally can never block a restart.
            RunEvent::ExitRequested { api, .. } => {
                let locked = app_handle
                    .try_state::<commands::LockdownState>()
                    .map(|state| state.0.lock().map(|guard| *guard).unwrap_or(false))
                    .unwrap_or(false);
                if locked {
                    api.prevent_exit();
                }
            }
            _ => {}
        });
}
