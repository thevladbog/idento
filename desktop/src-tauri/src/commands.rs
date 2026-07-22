//! Tauri commands: agent proxy and sidecar lifecycle.

use std::time::Duration;

use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

pub const AGENT_PORT: u16 = 12345;
pub const AGENT_PORT_STR: &str = "12345";

/// Read the shared agent auth token written by the agent to
/// `~/.idento/agent_config.json` (key `auth_token`).
fn read_agent_token() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let path = format!("{}/.idento/agent_config.json", home);
    let data = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    v.get("auth_token")?.as_str().map(|s| s.to_string())
}

/// Connection details for a standalone agent running on another machine
/// ("external agent" mode, K3a). `None` in `agent_request`'s `target`
/// parameter means "use the embedded/bundled agent" -- 127.0.0.1:AGENT_PORT
/// plus the locally-persisted token -- preserving the pre-K3a behavior
/// exactly.
#[derive(serde::Deserialize)]
pub struct AgentTarget {
    pub base_url: String,
    pub token: String,
}

/// Build a safe URL for a request to the agent, given a caller-supplied
/// `path` (fully controlled by WebView JS via `invoke("agent_request", ...)`)
/// and an optional external `target`.
///
/// Naively concatenating a base URL with `path` is unsafe: a `path` like
/// `"@evil.example.com/x"` produces `"http://127.0.0.1:12345@evil.example.com/x"`,
/// which URL parsers treat as userinfo `127.0.0.1:12345` + host
/// `evil.example.com`. That would send the agent's Bearer token (and the
/// request itself) to an attacker-controlled host -- a token-leaking SSRF
/// from the native process. To prevent this we (1) restrict `path` to a
/// strict, host-injection-proof charset, and (2) re-verify the
/// fully-parsed URL still targets the SAME scheme/host/port as `target`
/// (or the embedded default) with no userinfo before it is ever used.
///
/// None of the current agent endpoints require query strings (all dynamic
/// values -- printer/scanner names, IPs, ports -- travel in the JSON body,
/// never in `path`), so the allowed charset is deliberately path-only:
/// `^/[A-Za-z0-9/_\-]*$`. `@`, `\`, `:`, whitespace, `.` and repeated `/`
/// (`//`) are all rejected.
fn build_agent_url(path: &str, target: Option<&AgentTarget>) -> Result<reqwest::Url, String> {
    if !path.starts_with('/') {
        return Err(format!("Invalid agent path (must start with '/'): {}", path));
    }
    if path.contains("//") {
        return Err(format!("Invalid agent path (contains '//'): {}", path));
    }
    let is_safe_charset = path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-'));
    if !is_safe_charset {
        return Err(format!("Invalid agent path (disallowed characters): {}", path));
    }

    let base = match target {
        None => reqwest::Url::parse(&format!("http://127.0.0.1:{}/", AGENT_PORT))
            .map_err(|e| e.to_string())?,
        Some(t) => {
            let parsed = reqwest::Url::parse(&t.base_url)
                .map_err(|e| format!("Invalid external agent URL: {}", e))?;
            if parsed.scheme() != "http" && parsed.scheme() != "https" {
                return Err(format!(
                    "Invalid external agent URL scheme: {}",
                    parsed.scheme()
                ));
            }
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return Err("Invalid external agent URL: userinfo not allowed".to_string());
            }
            parsed
        }
    };

    let url = base
        .join(path.trim_start_matches('/'))
        .map_err(|e| e.to_string())?;

    // Defense in depth: re-verify the fully-parsed URL still points at
    // exactly the base we started from, even after the charset check above.
    let points_at_target = url.scheme() == base.scheme()
        && url.host_str() == base.host_str()
        && url.port_or_known_default() == base.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none();
    if !points_at_target {
        return Err(format!(
            "Invalid agent path (resolved to unexpected URL): {}",
            path
        ));
    }

    Ok(url)
}

/// Proxy a request to the agent (avoids CORS from WebView). `target: None`
/// talks to the embedded/bundled agent (today's behavior, unchanged);
/// `Some` talks to a configured external agent instead, using the
/// caller-supplied bearer token rather than the local
/// `~/.idento/agent_config.json` token.
/// Body: { "method": "GET"|"POST", "path": "/health", "body": optional_string, "target": optional_{base_url,token} }
#[tauri::command]
pub async fn agent_request(
    method: String,
    path: String,
    body: Option<String>,
    target: Option<AgentTarget>,
) -> Result<String, String> {
    let url = build_agent_url(&path, target.as_ref())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let token = match &target {
        Some(t) => Some(t.token.clone()),
        None => read_agent_token(),
    };

    let response = match method.to_uppercase().as_str() {
        "GET" => {
            let mut req = client.get(url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            req.send().await
        }
        "POST" => {
            // The agent requires Content-Type: application/json on every mutating
            // request, so set it unconditionally (even for body-less POSTs).
            let mut req = client
                .post(url)
                .header("Content-Type", "application/json");
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            if let Some(ref b) = body {
                req = req.body(b.clone());
            }
            req.send().await
        }
        _ => return Err(format!("Unsupported method: {}", method)),
    }
    .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Agent error {}: {}", status, text));
    }
    Ok(text)
}

#[tauri::command]
pub fn get_agent_port() -> u16 {
    AGENT_PORT
}

/// Tracks the embedded agent's child process, if one is currently running.
/// Managed as Tauri app state (see `lib.rs`'s `.manage(...)`). `None` means
/// "not running" -- either never spawned, running in external mode, or
/// already stopped.
///
/// `tauri-plugin-shell`'s own internal `Shell.children` map (which it kills
/// automatically on `RunEvent::Exit`) only tracks processes spawned through
/// its JS-invoked `plugin:shell|spawn` IPC command -- NOT processes spawned
/// by calling `Command::spawn()` directly from Rust, as `spawn_agent` does
/// below. So this state, and `lib.rs`'s own `RunEvent::Exit` handler, are
/// both required; the plugin's built-in cleanup does not cover this case.
#[derive(Default)]
pub struct AgentProcess(pub Mutex<Option<CommandChild>>);

/// Kills the tracked child process, if any. Shared by `stop_agent` and
/// `lib.rs`'s exit-cleanup handler.
pub fn kill_agent_process(state: &AgentProcess) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.take() {
            if let Err(e) = child.kill() {
                log::error!("failed to kill idento-agent sidecar: {}", e);
            }
        }
    }
}

/// Spawns the bundled agent sidecar on AGENT_PORT, unless one is already
/// tracked as running. Idempotent: safe to call again (e.g. when switching
/// from external mode back to embedded) without risking a duplicate spawn.
/// A no-op error (never panics) when the sidecar binary isn't bundled --
/// e.g. a dev build that hasn't set `externalBin` locally (see
/// `desktop/README.md`).
#[tauri::command]
pub fn spawn_agent(app: AppHandle, state: State<'_, AgentProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let sidecar = app
        .shell()
        .sidecar("idento-agent")
        .map_err(|e| e.to_string())?;
    let (_rx, child) = sidecar
        .args(["--port", AGENT_PORT_STR])
        .spawn()
        .map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok(())
}

/// Stops the tracked embedded agent process, if any. A no-op if nothing is
/// currently running (already stopped, or running in external mode).
#[tauri::command]
pub fn stop_agent(state: State<'_, AgentProcess>) -> Result<(), String> {
    kill_agent_process(&state);
    Ok(())
}

/// Stops the tracked process (if any) and immediately spawns a fresh one.
/// Used by the restart-after-health-check-failure supervisor (TS side,
/// `useAgentSupervisor`).
#[tauri::command]
pub fn restart_agent(app: AppHandle, state: State<'_, AgentProcess>) -> Result<(), String> {
    kill_agent_process(&state);
    spawn_agent(app, state)
}

/// Information about a checked update, sent back to JS. Deliberately does
/// NOT include the raw `tauri_plugin_updater::Update` handle itself (not
/// meaningfully serializable, and would leak internal signing/URL details
/// to the webview) -- the handle stays server-side in `UpdateHandleState`,
/// referenced only by `install_update`.
#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: String,
    pub notes: Option<String>,
}

/// Tracks the most recently checked `Update`, if one is available and not
/// yet installed. Managed as Tauri app state (see `lib.rs`'s `.manage(...)`),
/// the same pattern as K3a's `AgentProcess`.
#[derive(Default)]
pub struct UpdateHandleState(pub Mutex<Option<tauri_plugin_updater::Update>>);

/// Validates an operator-supplied update-manifest URL override (Equipment's
/// "closed network / mirror" setting) before it's ever used to build an
/// updater endpoint. Mirrors the same discipline as K3a's external-agent
/// URL validation: restrict to http/https, reject embedded userinfo -- an
/// operator-entered URL is a different trust domain than the app's own
/// compiled-in default, so it gets the same scrutiny before use.
fn validate_endpoint_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid update endpoint URL: {}", e))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("Invalid update endpoint URL scheme: {}", parsed.scheme()));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Invalid update endpoint URL: userinfo not allowed".to_string());
    }
    Ok(parsed)
}

/// Checks for an available update, optionally against a caller-supplied
/// endpoint override instead of the compiled-in default (see
/// `validate_endpoint_url`). On success, stashes the checked `Update`
/// handle in `UpdateHandleState` so a later `install_update` call can
/// install it without re-checking; returns only serializable info to JS.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateHandleState>,
    endpoint_override: Option<String>,
) -> Result<UpdateInfo, String> {
    let mut builder = app.updater_builder();
    if let Some(url) = endpoint_override {
        let parsed = validate_endpoint_url(&url)?;
        builder = builder.endpoints(vec![parsed]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    let info = match &update {
        Some(u) => UpdateInfo {
            available: true,
            version: u.version.clone(),
            notes: u.body.clone(),
        },
        None => UpdateInfo {
            available: false,
            version: String::new(),
            notes: None,
        },
    };

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = update;
    Ok(info)
}

/// Downloads and installs the `Update` handle stashed by the most recent
/// `check_for_update` call, then restarts the app. `request_restart()` is a
/// core `tauri::AppHandle` method (no `tauri-plugin-process` dependency
/// needed) -- it triggers `RunEvent::Exit`, which already runs the K3a
/// sidecar-cleanup handler in `lib.rs` unmodified. On Windows the installer
/// itself already exits the process during `download_and_install`, so the
/// `request_restart()` call there is effectively a no-op by the time it
/// runs; on macOS/Linux it's what actually triggers the relaunch.
///
/// `Update::download_and_install` takes `&self`, so the handle taken out of
/// `UpdateHandleState` isn't consumed by the call -- on failure (e.g. a
/// dropped connection or a signature mismatch) it's restored so the next
/// `install_update` call can retry without forcing a fresh `check_for_update`
/// round-trip first.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateHandleState>) -> Result<(), String> {
    let update = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    let update = update.ok_or_else(|| "No update available to install".to_string())?;
    if let Err(e) = update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(update);
        return Err(e.to_string());
    }
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Assert the URL is a same-origin request to the embedded agent: plain
    /// `http`, host `127.0.0.1`, exactly `AGENT_PORT`, and no userinfo.
    fn assert_points_at_agent(url: &reqwest::Url) {
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.port(), Some(AGENT_PORT));
        assert!(url.username().is_empty());
        assert!(url.password().is_none());
    }

    #[test]
    fn accepts_known_agent_paths() {
        let paths = [
            "/health",
            "/printers",
            "/printers/default",
            "/printers/add",
            "/printers/remove",
            "/print",
            "/scanners",
            "/scanners/add",
            "/scanners/ports",
            "/scan/last",
            "/scan/clear",
            // Hyphenated/underscored & nested segments, e.g. a
            // "/printers/{name}/fonts"-style path.
            "/printers/COM3/fonts",
            "/printers/my-printer_1/fonts",
        ];
        for path in paths {
            let url = build_agent_url(path, None)
                .unwrap_or_else(|e| panic!("expected {:?} to be accepted, got: {}", path, e));
            assert_points_at_agent(&url);
            assert_eq!(url.path(), path, "path round-tripped for {:?}", path);
        }
    }

    #[test]
    fn rejects_userinfo_host_injection() {
        // The original bug: naive concatenation of
        // "http://127.0.0.1:12345" + "@evil.example.com/x" produces a URL
        // whose host is evil.example.com and whose userinfo is
        // 127.0.0.1:12345.
        assert!(build_agent_url("@evil.example.com/x", None).is_err());
    }

    #[test]
    fn rejects_protocol_relative_double_slash() {
        assert!(build_agent_url("//evil.example.com", None).is_err());
    }

    #[test]
    fn rejects_embedded_scheme() {
        assert!(build_agent_url("http://evil", None).is_err());
    }

    #[test]
    fn rejects_at_sign_mid_path() {
        assert!(build_agent_url("/x@y", None).is_err());
    }

    #[test]
    fn rejects_path_traversal_with_backslashes() {
        assert!(build_agent_url("..\\..", None).is_err());
    }

    #[test]
    fn rejects_empty_path() {
        assert!(build_agent_url("", None).is_err());
    }

    #[test]
    fn rejects_path_missing_leading_slash() {
        assert!(build_agent_url("printers", None).is_err());
    }

    #[test]
    fn rejects_query_strings() {
        // No current agent endpoint needs query params; keep it path-only.
        assert!(build_agent_url("/health?x=1", None).is_err());
    }

    #[test]
    fn rejects_whitespace_and_control_chars() {
        assert!(build_agent_url("/health \t", None).is_err());
        assert!(build_agent_url("/heal\nth", None).is_err());
    }

    fn external_target() -> AgentTarget {
        AgentTarget {
            base_url: "http://192.168.1.50:12345".to_string(),
            token: "tok".to_string(),
        }
    }

    #[test]
    fn accepts_known_paths_against_an_external_target() {
        let target = external_target();
        let url = build_agent_url("/health", Some(&target)).expect("should be accepted");
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("192.168.1.50"));
        assert_eq!(url.port(), Some(12345));
        assert_eq!(url.path(), "/health");
    }

    #[test]
    fn external_target_defaults_the_port_for_https() {
        let target = AgentTarget {
            base_url: "https://pi.local".to_string(),
            token: "tok".to_string(),
        };
        let url = build_agent_url("/health", Some(&target)).expect("should be accepted");
        assert_eq!(url.port_or_known_default(), Some(443));
    }

    #[test]
    fn rejects_external_target_with_disallowed_scheme() {
        let target = AgentTarget {
            base_url: "file:///etc/passwd".to_string(),
            token: "tok".to_string(),
        };
        assert!(build_agent_url("/health", Some(&target)).is_err());
    }

    #[test]
    fn rejects_external_target_with_userinfo() {
        let target = AgentTarget {
            base_url: "http://user:pass@192.168.1.50:12345".to_string(),
            token: "tok".to_string(),
        };
        assert!(build_agent_url("/health", Some(&target)).is_err());
    }

    #[test]
    fn rejects_userinfo_host_injection_against_an_external_target() {
        // Same injection shape as rejects_userinfo_host_injection, but
        // proving the post-parse re-verification also holds when the base
        // isn't the hardcoded embedded constant.
        let target = external_target();
        assert!(build_agent_url("@evil.example.com/x", Some(&target)).is_err());
    }
}

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn accepts_https_endpoint() {
        assert!(validate_endpoint_url("https://example.com/latest.json").is_ok());
    }

    #[test]
    fn accepts_http_endpoint_for_a_local_mirror() {
        assert!(validate_endpoint_url("http://192.168.1.50:8080/latest.json").is_ok());
    }

    #[test]
    fn rejects_non_http_scheme() {
        assert!(validate_endpoint_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_userinfo() {
        assert!(validate_endpoint_url("https://user:pass@evil.example/latest.json").is_err());
    }

    #[test]
    fn rejects_malformed_url() {
        assert!(validate_endpoint_url("not a url").is_err());
    }
}
