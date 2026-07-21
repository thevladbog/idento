# Kiosk K3a — Agent Sidecar + Standalone Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the K1-era sidecar-spawn stub actually work (spawn/monitor/restart/clean-shutdown), add an "external agent" connection mode for standalone (non-bundled) agents on another machine, and give that standalone agent an official Linux/systemd distribution + release artifact.

**Architecture:** Rust (`desktop/src-tauri`) gets thin, testable primitives — `spawn_agent`/`stop_agent`/`restart_agent` commands, and a generalized `agent_request`/`build_agent_url` that can target either the embedded sidecar (127.0.0.1:12345 + the local `~/.idento/agent_config.json` token, today's behavior) or a caller-supplied external `{base_url, token}`, with the existing anti-SSRF hardening preserved for both. All restart/backoff *decision-making* lives in TS (`useAgentSupervisor`), riding on the already-built `useAgentHealth` poller, because this repo's only existing Rust tests are pure functions — an async Rust supervisor would be new, harder-to-test territory, whereas TS hooks with fake timers are an established, proven pattern here (K2a). The standalone agent gets a systemd unit + install script in `agent/dist/`, plus a new per-arch build job in the existing `release.yml` (mirroring its existing `binaries` job).

**Tech Stack:** Rust (tauri 2.11.5, tauri-plugin-shell 2.3.5 — already pinned in `Cargo.lock`, verified against the actual vendored crate source for this plan), React 19 + TypeScript + TanStack Query (existing `desktop` stack, K2a), Go 1.25 (`agent/`, existing), GitHub Actions.

## Global Constraints

- K3a's scope boundary (do not exceed it): sidecar spawn/monitor/external-mode mechanics in code, plus a Linux/systemd standalone distribution + its own CI release job. Do **not** add `tauri-plugin-updater`, minisign signing, a `desktop-v*` release workflow, or automated embedding of the sidecar binary into official Tauri release bundles — all of that is K3b.
- `desktop/src-tauri/tauri.conf.json`'s `bundle.externalBin` stays `[]` (unchanged) for this whole plan. Setting it non-empty would make `npm run tauri build` hard-fail in CI's existing `build-desktop` job (any desktop-touching PR) because no real per-target-triple binary exists in `sidecars/` yet — that automation is explicitly K3b's job. Manual local testing of the sidecar continues to follow `desktop/README.md`'s existing "Bundling the agent" instructions (developer manually sets `externalBin` locally, never commits it).
- Standalone distribution targets Linux/systemd only — no launchd/Windows service (out of scope, not planned).
- Never weaken `commands.rs`'s existing anti-SSRF invariants (path charset restriction, `//` rejection, post-parse re-verification of scheme/host/port/userinfo) for the embedded (`target: None`) case while generalizing for external targets — every existing rejection test must keep passing unmodified in behavior (just gains a second `None` argument).
- `agentGet(path)`/`agentPost(path, body)`'s public signatures (from `desktop/src/lib/agent.ts`) do not change — the external-vs-embedded target is resolved *internally* via `agentConfig.ts`, never threaded through the many existing call sites (`useCheckinFlow.ts`, `useScanInput.ts`, `hooks.ts`, `Equipment.tsx`). This means none of K2a's existing tests that mock `agentGet`/`agentPost`/`checkAgentHealth`/`consumeLastScan` need to change.
- No new npm dependencies are needed anywhere in this plan (`@tanstack/react-query` and `@tauri-apps/api` are already in `desktop/package.json` from K1/K2a).
- No new Rust crates are needed (`serde`'s `derive` feature and `tauri-plugin-shell` are already in `Cargo.toml`).
- Known environment hazard (from K1/K2a): a shell wrapper (RTK) active in this environment can make `npm run lint`/`npm run build` output look like a broken/missing config when it isn't. Verify with `git show HEAD:<path>` or a direct tool invocation before concluding anything is actually broken.
- Commit after every task.

---

### Task 1: Rust — generalize `build_agent_url`/`agent_request` for external targets

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`

**Interfaces:**
- Consumes: nothing new (extends existing `reqwest`/`serde` usage already in the file).
- Produces:

```rust
#[derive(serde::Deserialize)]
pub struct AgentTarget {
    pub base_url: String,
    pub token: String,
}
// build_agent_url(path: &str, target: Option<&AgentTarget>) -> Result<reqwest::Url, String>
// agent_request(method: String, path: String, body: Option<String>, target: Option<AgentTarget>) -> Result<String, String>
```

This is a signature change shared by 8 pre-existing tests, so this task's "red" state is a **compile error**, not a runtime assertion failure — that's expected and is itself the correct TDD signal for a Rust signature change.

- [ ] **Step 1: Update the test module to the new two-argument signature and add external-target cases**

Replace the entire `#[cfg(test)] mod tests { ... }` block at the bottom of `desktop/src-tauri/src/commands.rs` with:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cd desktop/src-tauri && cargo test --lib`
Expected: compile error — `build_agent_url` takes 1 argument but 2 were supplied (and `AgentTarget` doesn't exist yet).

- [ ] **Step 3: Generalize the production code**

Replace `build_agent_url` and `agent_request` (keep `read_agent_token`, `AGENT_PORT`, `AGENT_PORT_STR`, and `get_agent_port` exactly as they are) with:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop/src-tauri && cargo test --lib`
Expected: PASS (15/15 — the original 8, unchanged in behavior, plus 5 new external-target tests; note `cargo test` reported 10 tests before this change in this codebase, so confirm the final count is 10 - 8 + 8 + 5 = 15 by reading the test runner's own summary line rather than assuming).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/commands.rs
git commit -m "feat(desktop): generalize agent_request/build_agent_url for external agent targets"
```

---

### Task 2: Rust — sidecar lifecycle commands + clean shutdown

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `AGENT_PORT_STR` (existing constant in `commands.rs`).
- Produces:

```rust
pub struct AgentProcess(pub std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
// spawn_agent(app: tauri::AppHandle, state: tauri::State<'_, AgentProcess>) -> Result<(), String>
// stop_agent(state: tauri::State<'_, AgentProcess>) -> Result<(), String>
// restart_agent(app: tauri::AppHandle, state: tauri::State<'_, AgentProcess>) -> Result<(), String>
```

No Rust unit tests are added in this task — `spawn`/`kill` require an actual sidecar binary, which this repo's CI environment doesn't have (see Global Constraints). Verification is `cargo build` (compiles) + `cargo test --lib` (Task 1's tests still pass) + a documented manual check.

- [ ] **Step 1: Add the lifecycle commands to `commands.rs`**

Add near the top of `desktop/src-tauri/src/commands.rs`, right after `use std::time::Duration;`:

```rust
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
```

Then add the following at the end of the file, immediately before the `#[cfg(test)]` module:

```rust
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
```

- [ ] **Step 2: Wire the new state/commands into `lib.rs`, and clean up on exit**

Read `desktop/src-tauri/src/lib.rs` first, then replace its contents:

```rust
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
```

- [ ] **Step 3: Verify it builds and existing tests still pass**

```bash
cd desktop/src-tauri && cargo build && cargo test --lib
```

Expected: clean build, 15/15 tests pass (unchanged from Task 1 — this task adds no new Rust tests).

- [ ] **Step 4: Manual verification (documented, not automated)**

No CI runner in this repo can exercise an actual sidecar spawn/kill (no bundled binary, no Tauri runtime). Document in the task's commit/PR description that this was manually checked by: building the agent locally (`cd agent && go build -o ../desktop/src-tauri/sidecars/idento-agent-$(rustc -vV | sed -n 's/host: //p') .`), temporarily setting `"externalBin": ["sidecars/idento-agent"]` in a local (uncommitted) copy of `tauri.conf.json`, running `npm run tauri dev -w idento-desktop`, and confirming: (a) the agent does NOT start until something calls `invoke("spawn_agent")` (nothing does yet until Task 5 wires the boot effect — for this task alone, verify via the Tauri devtools console: `window.__TAURI__.core.invoke("spawn_agent")` starts it, `invoke("stop_agent")` stops it, `invoke("restart_agent")` restarts it), and (b) closing the app window terminates the spawned `idento-agent` process (check via `ps aux | grep idento-agent` before/after closing).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/commands.rs desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): sidecar lifecycle commands (spawn/stop/restart) + clean shutdown on exit"
```

---

### Task 3: TS — agent connection config (`agentConfig.ts`)

**Files:**
- Create: `desktop/src/lib/agentConfig.ts`
- Test: `desktop/src/lib/agentConfig.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type AgentMode = "embedded" | "external";
export interface AgentTarget { base_url: string; token: string }
export function getAgentMode(): AgentMode;
export function setAgentMode(mode: AgentMode): void;
export function getAgentExternalConfig(): { baseUrl: string; token: string };
export function setAgentExternalConfig(baseUrl: string, token: string): void;
export function getAgentTarget(): AgentTarget | null;
```

- [ ] **Step 1: Write the failing tests**

Create `desktop/src/lib/agentConfig.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  getAgentExternalConfig,
  getAgentMode,
  getAgentTarget,
  setAgentExternalConfig,
  setAgentMode,
} from "./agentConfig";

afterEach(() => {
  localStorage.clear();
});

describe("getAgentMode / setAgentMode", () => {
  it("defaults to embedded", () => {
    expect(getAgentMode()).toBe("embedded");
  });

  it("round-trips external", () => {
    setAgentMode("external");
    expect(getAgentMode()).toBe("external");
  });

  it("treats any other stored value as embedded", () => {
    localStorage.setItem("idento_agent_mode", "bogus");
    expect(getAgentMode()).toBe("embedded");
  });
});

describe("setAgentExternalConfig / getAgentExternalConfig", () => {
  it("trims whitespace and strips a trailing slash from the URL", () => {
    setAgentExternalConfig("  http://192.168.1.50:12345/  ", "  tok  ");
    expect(getAgentExternalConfig()).toEqual({ baseUrl: "http://192.168.1.50:12345", token: "tok" });
  });

  it("returns empty strings when nothing has been saved yet", () => {
    expect(getAgentExternalConfig()).toEqual({ baseUrl: "", token: "" });
  });
});

describe("getAgentTarget", () => {
  it("returns null in embedded mode even if external fields are set", () => {
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns null in external mode when the token is missing", () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns null in external mode when the URL is missing", () => {
    setAgentMode("external");
    setAgentExternalConfig("", "tok");
    expect(getAgentTarget()).toBeNull();
  });

  it("returns the target in external mode with both fields set", () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(getAgentTarget()).toEqual({ base_url: "http://192.168.1.50:12345", token: "tok" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/lib/agentConfig.test.ts`
Expected: FAIL (module `./agentConfig` not found).

- [ ] **Step 3: Create `desktop/src/lib/agentConfig.ts`**

```ts
// Persists the operator's choice of agent connection: "embedded" (default --
// Tauri spawns/manages the bundled sidecar on 127.0.0.1:12345) or "external"
// (a standalone agent already running elsewhere, reached over the network --
// see agent/dist/'s systemd install). Mirrors config.ts's
// getBackendUrl/setBackendUrl localStorage pattern.
export type AgentMode = "embedded" | "external";

const MODE_KEY = "idento_agent_mode";
const EXTERNAL_URL_KEY = "idento_agent_external_url";
const EXTERNAL_TOKEN_KEY = "idento_agent_external_token";

export interface AgentTarget {
  base_url: string;
  token: string;
}

export function getAgentMode(): AgentMode {
  try {
    return localStorage.getItem(MODE_KEY) === "external" ? "external" : "embedded";
  } catch {
    return "embedded";
  }
}

export function setAgentMode(mode: AgentMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore (storage unavailable, QuotaExceededError, etc.)
  }
}

export function setAgentExternalConfig(baseUrl: string, token: string): void {
  try {
    localStorage.setItem(EXTERNAL_URL_KEY, baseUrl.trim().replace(/\/$/, ""));
    localStorage.setItem(EXTERNAL_TOKEN_KEY, token.trim());
  } catch {
    // ignore
  }
}

export function getAgentExternalConfig(): { baseUrl: string; token: string } {
  try {
    return {
      baseUrl: localStorage.getItem(EXTERNAL_URL_KEY)?.trim() ?? "",
      token: localStorage.getItem(EXTERNAL_TOKEN_KEY)?.trim() ?? "",
    };
  } catch {
    return { baseUrl: "", token: "" };
  }
}

// Returns the target to hand to agent_request/fetch when in external mode
// AND both fields are non-empty; null in every other case (embedded mode,
// or external mode with incomplete config -- callers fall back to the
// embedded/localhost path rather than sending a half-configured request).
export function getAgentTarget(): AgentTarget | null {
  if (getAgentMode() !== "external") return null;
  const { baseUrl, token } = getAgentExternalConfig();
  if (!baseUrl || !token) return null;
  return { base_url: baseUrl, token };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/lib/agentConfig.test.ts`
Expected: PASS (10/10).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck -w idento-desktop
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/lib/agentConfig.ts desktop/src/lib/agentConfig.test.ts
git commit -m "feat(desktop): agent connection config (embedded/external mode persistence)"
```

---

### Task 4: TS — `agent.ts` routes through the configured target

**Files:**
- Modify: `desktop/src/lib/agent.ts`
- Modify: `desktop/src/lib/agent.test.ts`

**Interfaces:**
- Consumes: `getAgentTarget` from `./agentConfig` (Task 3).
- Produces: no signature changes to `agentGet`/`agentPost`/`checkAgentHealth`/`consumeLastScan` — all existing callers are unaffected.

- [ ] **Step 1: Write the failing tests**

Replace `desktop/src/lib/agent.test.ts` with (this keeps the 2 existing `consumeLastScan` tests verbatim and adds a new describe block):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAgentExternalConfig, setAgentMode } from "./agentConfig";
import { agentGet, agentPost, consumeLastScan } from "./agent";

describe("consumeLastScan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs /scan/consume and returns the code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "EVT-123", time: "2026-07-21T00:00:00Z" })),
    } as Response);

    const result = await consumeLastScan();

    expect(result).toEqual({ code: "EVT-123" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:12345/scan/consume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns an empty code when the buffer was empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ code: "", time: "0001-01-01T00:00:00Z" })),
    } as Response);

    expect(await consumeLastScan()).toEqual({ code: "" });
  });
});

describe("agentGet / agentPost with an external target configured", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("agentGet sends the external base URL and bearer token", async () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok-123");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: () => Promise.resolve("ok") } as Response);

    await agentGet("/health");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:12345/health",
      expect.objectContaining({ headers: { Authorization: "Bearer tok-123" } }),
    );
  });

  it("agentPost sends the external base URL, bearer token, and JSON content-type", async () => {
    setAgentMode("external");
    setAgentExternalConfig("http://192.168.1.50:12345", "tok-123");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: () => Promise.resolve("{}") } as Response);

    await agentPost("/print", "{}");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.50:12345/print",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok-123" },
        body: "{}",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -w idento-desktop -- src/lib/agent.test.ts`
Expected: the 2 pre-existing tests PASS unchanged; the 2 new tests FAIL (fetch called with `http://localhost:12345/...` instead of the external URL, since `agent.ts` doesn't consult `agentConfig` yet).

- [ ] **Step 3: Update `desktop/src/lib/agent.ts`**

Read the file first, then replace its contents:

```ts
/**
 * Agent API: when running in Tauri, use invoke to proxy requests to the local agent (avoids CORS).
 * In browser dev, call localhost:12345 directly (agent must be running and CORS allows origin).
 *
 * Every call resolves the current agent target via agentConfig.ts: "embedded"
 * mode (default) sends `target: null` -- the Rust side (and, in the browser-dev
 * fallback below, the hardcoded FALLBACK_AGENT_URL) treats that as the bundled
 * sidecar at 127.0.0.1:12345 using the locally-persisted token. "external"
 * mode sends the configured { base_url, token } instead.
 */
import { getAgentTarget } from "./agentConfig";

const FALLBACK_AGENT_URL = "http://localhost:12345";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export async function agentGet(path: string): Promise<string> {
  const target = getAgentTarget();
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "GET", path, body: null, target });
  }
  const base = target?.base_url ?? FALLBACK_AGENT_URL;
  const headers = target ? { Authorization: `Bearer ${target.token}` } : undefined;
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.text();
}

export async function agentPost(path: string, body?: string): Promise<string> {
  const target = getAgentTarget();
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_request", { method: "POST", path, body: body ?? null, target });
  }
  // The agent requires Content-Type: application/json on every mutating request,
  // so set it unconditionally (even for body-less POSTs).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target) headers.Authorization = `Bearer ${target.token}`;
  const res = await fetch(`${target?.base_url ?? FALLBACK_AGENT_URL}${path}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) throw new Error(`Agent error: ${res.status}`);
  return res.text();
}

export async function checkAgentHealth(): Promise<boolean> {
  try {
    const text = await agentGet("/health");
    return text.includes("running") || text.includes("Idento");
  } catch {
    return false;
  }
}

// Atomic read+clear of the agent's scan buffer (agent/openapi.yaml's
// POST /scan/consume) -- unlike the older GET /scan/last + POST /scan/clear
// pair, a scan arriving between a separate read and clear can never be lost.
export async function consumeLastScan(): Promise<{ code: string }> {
  const text = await agentPost("/scan/consume");
  const data = JSON.parse(text) as { code?: string } | null;
  return { code: data?.code ?? "" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/lib/agent.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run the full desktop test suite + typecheck to confirm no regression in existing callers**

```bash
npm test -w idento-desktop
npm run typecheck -w idento-desktop
```

Expected: all existing suites (`useCheckinFlow`, `useScanInput`, `hooks`, etc.) still pass unchanged, since they mock `agentGet`/`agentPost`/`checkAgentHealth`/`consumeLastScan` directly and never touch `agentConfig`.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/lib/agent.ts desktop/src/lib/agent.test.ts
git commit -m "feat(desktop): agentGet/agentPost route through the configured agent target"
```

---

### Task 5: TS — restart supervisor hook + app-boot wiring

**Files:**
- Create: `desktop/src/features/checkin/useAgentSupervisor.ts`
- Test: `desktop/src/features/checkin/useAgentSupervisor.test.tsx`
- Create: `desktop/src/components/AgentLifecycle.tsx`
- Modify: `desktop/src/App.tsx`

**Interfaces:**
- Consumes: `useAgentHealth` from `./hooks` (existing, K2a), `getAgentMode` from `../../lib/agentConfig` (Task 3).
- Produces: `useAgentSupervisor(): void`; `AgentLifecycle` component (no props, renders nothing, mounted once at the app root).

- [ ] **Step 1: Write the failing tests**

Create `desktop/src/features/checkin/useAgentSupervisor.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentLib from "../../lib/agent";
import { setAgentMode } from "../../lib/agentConfig";
import { createWrapper } from "../../test/queryWrapper";
import { useAgentSupervisor } from "./useAgentSupervisor";

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("useAgentSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing while the agent stays healthy", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(true);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("restarts after 3 consecutive unhealthy polls, then again after the backoff elapses", async () => {
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });

    await vi.advanceTimersByTimeAsync(0); // poll #1: unhealthy (failureCount=1)
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // poll #2 (failureCount=2)
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // poll #3 (failureCount=3) -> first restart, 1s cooldown starts
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("restart_agent");

    await vi.advanceTimersByTimeAsync(20_000); // next unhealthy poll -- 1s cooldown long since elapsed -> restart #2
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("resets the failure count and backoff after a healthy poll", async () => {
    const healthSpy = vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0); // failureCount=1
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=2 (still under threshold)

    healthSpy.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000); // healthy -> full reset
    expect(invokeMock).not.toHaveBeenCalled();

    healthSpy.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=1 again (fresh run needed)
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=2
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); // failureCount=3 -> restart
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing in external mode", async () => {
    setAgentMode("external");
    vi.spyOn(agentLib, "checkAgentHealth").mockResolvedValue(false);
    renderHook(() => useAgentSupervisor(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/features/checkin/useAgentSupervisor.test.tsx`
Expected: FAIL (module `./useAgentSupervisor` not found).

- [ ] **Step 3: Create `desktop/src/features/checkin/useAgentSupervisor.ts`**

```ts
// Restarts the embedded agent sidecar after sustained health-check
// failures. Rides on the SAME health signal that drives the "agent" status
// chip (useAgentHealth, K2a) instead of polling independently -- one source
// of truth for "is the agent up". A run of FAILURE_THRESHOLD consecutive
// misses triggers the first restart attempt immediately; if the agent is
// still unhealthy afterwards, further attempts are spaced by an
// exponential backoff (1s -> 2s -> 4s ... capped at 30s). The failure count
// and backoff both reset to their initial values on the first healthy
// check. Inactive outside "embedded" mode -- the desktop app doesn't own a
// standalone agent's process lifecycle, only its reachability.
import { useEffect, useRef } from "react";
import { getAgentMode } from "../../lib/agentConfig";
import { useAgentHealth } from "./hooks";

const FAILURE_THRESHOLD = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

async function restartAgentProcess(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("restart_agent");
}

export function useAgentSupervisor(): void {
  const health = useAgentHealth();

  const failureCountRef = useRef(0);
  const recoveringRef = useRef(false);
  const cooldownActiveRef = useRef(false);
  const backoffMsRef = useRef(INITIAL_BACKOFF_MS);
  const cooldownTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(cooldownTimerRef.current);
  }, []);

  useEffect(() => {
    if (health.isLoading) return;
    if (getAgentMode() !== "embedded") return;

    if (health.data === true) {
      failureCountRef.current = 0;
      recoveringRef.current = false;
      cooldownActiveRef.current = false;
      backoffMsRef.current = INITIAL_BACKOFF_MS;
      window.clearTimeout(cooldownTimerRef.current);
      return;
    }

    if (!recoveringRef.current) {
      failureCountRef.current += 1;
      if (failureCountRef.current < FAILURE_THRESHOLD) return;
      recoveringRef.current = true;
    }

    if (cooldownActiveRef.current) return;

    cooldownActiveRef.current = true;
    void restartAgentProcess().catch(() => {
      // A failed restart attempt just means the next unhealthy tick, once
      // the cooldown below elapses, tries again.
    });
    cooldownTimerRef.current = window.setTimeout(() => {
      cooldownActiveRef.current = false;
      backoffMsRef.current = Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
    }, backoffMsRef.current);
    // health.dataUpdatedAt (not just health.data) is a required dependency:
    // checkAgentHealth resolves the same boolean on every consecutive failed
    // poll, so health.data alone never changes value between polls and the
    // effect would never re-run after the first failure -- dataUpdatedAt is
    // a fresh timestamp on every settled poll regardless of whether the
    // value repeats, which is what actually drives this effect forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health.data, health.isLoading, health.dataUpdatedAt]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/useAgentSupervisor.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Create `desktop/src/components/AgentLifecycle.tsx`**

```tsx
// Mounted once at the app root (see App.tsx), regardless of route. Spawns
// the embedded agent sidecar on boot unless the operator has switched to
// "external" mode (Equipment's toggle calls spawn_agent/stop_agent
// directly on a live switch instead of waiting for this effect to
// re-run -- see Task 6), and keeps the restart supervisor
// (useAgentSupervisor) alive for the whole session.
import { useEffect } from "react";
import { getAgentMode } from "../lib/agentConfig";
import { useAgentSupervisor } from "../features/checkin/useAgentSupervisor";

export function AgentLifecycle() {
  useAgentSupervisor();

  useEffect(() => {
    if (getAgentMode() !== "embedded") return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("spawn_agent");
      } catch {
        // Not running under Tauri (e.g. `vite dev` in a plain browser), or
        // the bundled sidecar binary is missing in this dev build -- the
        // existing agent-health chip already surfaces "agent unreachable"
        // to the operator either way.
      }
    })();
  }, []);

  return null;
}
```

- [ ] **Step 6: Mount it in `App.tsx`**

Read `desktop/src/App.tsx` first, then replace its contents:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AgentLifecycle } from "./components/AgentLifecycle";
import LoginPage from "./pages/Login";
import QRLoginPage from "./pages/QRLogin";
import ConnectionPage from "./pages/Connection";
import EquipmentPage from "./pages/Equipment";
import CheckinPage from "./pages/Checkin";
import ModePage from "./pages/Mode";
import RunPage from "./pages/Run";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AgentLifecycle />
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/qr-login" element={<QRLoginPage />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route
          path="/checkin"
          element={
            <ProtectedRoute>
              <CheckinPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/equipment"
          element={
            <ProtectedRoute>
              <EquipmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId/mode"
          element={
            <ProtectedRoute>
              <ModePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin/:eventId"
          element={
            <ProtectedRoute>
              <RunPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 7: Run the full suite, typecheck, and build**

```bash
npm test -w idento-desktop
npm run typecheck -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean. (`AgentLifecycle` renders `null` and has no test of its own beyond typecheck/build — its two behaviors are already covered by `useAgentSupervisor.test.tsx`, Task 2's manual sidecar check, and Task 6's Equipment toggle test.)

- [ ] **Step 8: Commit**

```bash
git add desktop/src/features/checkin/useAgentSupervisor.ts desktop/src/features/checkin/useAgentSupervisor.test.tsx desktop/src/components/AgentLifecycle.tsx desktop/src/App.tsx
git commit -m "feat(desktop): agent restart supervisor + boot-time spawn wiring"
```

---

### Task 6: TS — Equipment: external-agent toggle

**Files:**
- Modify: `desktop/src/pages/Equipment.tsx`
- Modify: `desktop/src/i18n.ts`
- Modify: `desktop/README.md`

**Interfaces:**
- Consumes: `AgentMode`, `getAgentMode`, `getAgentExternalConfig`, `setAgentExternalConfig`, `setAgentMode` from `@/lib/agentConfig` (Task 3).
- Produces: no new exports — this is a leaf page component.

This task has no dedicated component test: this repo has no existing component-level tests for any pre-flight page (K2a's testing is entirely hook-level; `Equipment.tsx` itself has never had a test file). Verification is `npm run typecheck`/`npm run build` plus a documented manual check, matching the existing convention for this file.

- [ ] **Step 1: Add new i18n keys**

In `desktop/src/i18n.ts`, in the `en.translation` block, add right after the `agentNotConnectedDesc` line:

```ts
        agentConnectionTitle: "Agent connection",
        agentModeEmbedded: "Embedded",
        agentModeExternal: "External",
        agentExternalUrlPlaceholder: "http://192.168.1.50:12345",
        agentExternalTokenPlaceholder: "Token",
```

In the `ru.translation` block, add right after its `agentNotConnectedDesc` line:

```ts
        agentConnectionTitle: "Подключение агента",
        agentModeEmbedded: "Встроенный",
        agentModeExternal: "Внешний",
        agentExternalUrlPlaceholder: "http://192.168.1.50:12345",
        agentExternalTokenPlaceholder: "Токен",
```

- [ ] **Step 2: Add imports, state, and handlers to `Equipment.tsx`**

Read `desktop/src/pages/Equipment.tsx` first. Change the import line:

```tsx
import { checkAgentHealth, agentGet, agentPost } from "@/lib/agent";
```

to:

```tsx
import { checkAgentHealth, agentGet, agentPost } from "@/lib/agent";
import {
  type AgentMode,
  getAgentExternalConfig,
  getAgentMode,
  setAgentExternalConfig,
  setAgentMode,
} from "@/lib/agentConfig";
```

Add new state right after the existing `stationId`/`registerStation` block (after the `const registerStation = useRegisterStation(eventId!);` line):

```tsx
  const [agentMode, setAgentModeState] = useState<AgentMode>(getAgentMode);
  const [externalUrl, setExternalUrl] = useState(() => getAgentExternalConfig().baseUrl);
  const [externalToken, setExternalToken] = useState(() => getAgentExternalConfig().token);
```

Add new handlers right after `registerStationAction`'s closing brace:

```tsx
  // Deliberately NOT shared with the mount effect above (which guards its
  // setState calls with a `cancelled` flag for a fast unmount mid-fetch):
  // this function only ever runs from a direct user action (toggling the
  // mode, clicking Save), where an unmount-mid-flight is a much rarer race
  // than during the initial page-load effect, so the extra guard isn't
  // worth threading through a shared helper here.
  const reconnectAgent = async () => {
    setLoading(true);
    const ok = await checkAgentHealth();
    setAgentConnected(ok);
    if (!ok) {
      setPrinters([]);
      setScanners([]);
      setAvailablePorts([]);
      setDefaultPrinter(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchEquipmentData();
      setPrinters(data.printers);
      setScanners(data.scanners);
      setAvailablePorts(data.availablePorts);
      setDefaultPrinter(data.defaultPrinter);
    } catch {
      setPrinters([]);
      setScanners([]);
      setAvailablePorts([]);
      setDefaultPrinter(null);
    }
    setLoading(false);
  };

  const switchAgentMode = async (mode: AgentMode) => {
    if (mode === agentMode) return;
    setAgentMode(mode);
    setAgentModeState(mode);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(mode === "embedded" ? "spawn_agent" : "stop_agent");
    } catch {
      // Not running under Tauri (browser dev) -- nothing to spawn/stop.
    }
    await reconnectAgent();
  };

  const saveExternalConfig = async () => {
    if (!externalUrl.trim() || !externalToken.trim()) return;
    setAgentExternalConfig(externalUrl, externalToken);
    toast.success(t("save"));
    await reconnectAgent();
  };
```

- [ ] **Step 3: Add the "Agent connection" section to the rendered JSX**

Read the file's current `return (...)` block. It currently reads:

```tsx
  return (
    <PreflightShell
      steps={steps}
      activeIndex={3}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      {loading ? (
```

Change it to wrap the existing ternary in a new outer container, with the new section always visible above it:

```tsx
  return (
    <PreflightShell
      steps={steps}
      activeIndex={3}
      footer={
        <div className="flex items-center gap-3">
          {t("language")}: <LanguageSwitcher />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* NEW: agent connection mode (embedded/external) */}
        <section className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-6">
          <div className="font-bold text-kiosk-text">{t("agentConnectionTitle")}</div>
          <div className="mt-3 flex gap-3">
            {(["embedded", "external"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={agentMode === value}
                className={`flex-1 rounded-xl border-2 p-4 text-left ${
                  agentMode === value
                    ? "border-kiosk-brand bg-kiosk-brand/10 text-kiosk-text"
                    : "border-kiosk-border-2 text-kiosk-text-3"
                }`}
                onClick={() => switchAgentMode(value)}
              >
                {value === "embedded" ? t("agentModeEmbedded") : t("agentModeExternal")}
              </button>
            ))}
          </div>
          {agentMode === "external" && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <KioskInput
                placeholder={t("agentExternalUrlPlaceholder")}
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
              />
              <KioskInput
                type="password"
                placeholder={t("agentExternalTokenPlaceholder")}
                value={externalToken}
                onChange={(e) => setExternalToken(e.target.value)}
              />
              <KioskButton
                size="md"
                onClick={saveExternalConfig}
                disabled={!externalUrl.trim() || !externalToken.trim()}
              >
                {t("save")}
              </KioskButton>
            </div>
          )}
        </section>

        {loading ? (
          <p className="text-kiosk-text-3">{t("loading")}</p>
        ) : !agentConnected ? (
          <div className="rounded-2xl border border-kiosk-border-2 bg-kiosk-surface-2 p-8">
            <div className="kiosk-type-verdict-title" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.7)" }}>
              {t("agentNotConnected")}
            </div>
            <p className="mt-2 text-kiosk-text-3">{t("agentNotConnectedDesc")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
```

The rest of the file (the printers/scanners/station/scanner-test cards, and the final "Continue" button) stays exactly as it is today, **except** it now needs one extra closing `</div>` at the very end to match the new outer wrapper. Read the file's current final lines:

```tsx
          <KioskButton
            disabled={!stationId}
            onClick={() => navigate(`/checkin/${eventId}/mode`)}
          >
            {t("continueButton")}
          </KioskButton>
        </div>
      )}
    </PreflightShell>
  );
}
```

Change them to:

```tsx
          <KioskButton
            disabled={!stationId}
            onClick={() => navigate(`/checkin/${eventId}/mode`)}
          >
            {t("continueButton")}
          </KioskButton>
        </div>
      )}
      </div>
    </PreflightShell>
  );
}
```

(The `)}` closes the `loading ? ... : !agentConnected ? ... : (...)` ternary and its enclosing `{...}` JSX expression, exactly as it did before this task; the new final `</div>` closes the new outer wrapper opened in this step, right before `</PreflightShell>`.)

- [ ] **Step 4: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean. (Per Global Constraints, verify any "missing/broken config" report from `lint`/`build` with a direct tool invocation before concluding something is actually broken — this environment's RTK wrapper can mask real output.)

- [ ] **Step 5: Add a short README note**

In `desktop/README.md`, add a new subsection right after the existing "## Bundling the agent (sidecar)" section (before "## Raspberry Pi"):

```markdown
## Connecting to a standalone agent (external mode)

Instead of bundling the agent, a station can connect to one already running
on another machine (e.g. a headless Raspberry Pi wired to a printer/scanner
-- see `agent/dist/`'s systemd install). In the Equipment step of the
pre-flight wizard, switch "Agent connection" to **External** and enter the
standalone agent's base URL (e.g. `http://192.168.1.50:12345`) and its auth
token (printed by `agent/dist/install.sh` on install, or found in
`~/.idento/agent_config.json` on that machine).
```

- [ ] **Step 6: Manual verification (documented, not automated)**

Document in the PR description: ran `npm run tauri dev -w idento-desktop`, navigated to the Equipment step, toggled External, entered a bogus URL/token, confirmed "Agent not connected" still renders (no crash); toggled back to Embedded, confirmed the existing printer/scanner discovery still works exactly as before this task (this task adds a section above the existing UI but does not change any of its logic).

- [ ] **Step 7: Commit**

```bash
git add desktop/src/pages/Equipment.tsx desktop/src/i18n.ts desktop/README.md
git commit -m "feat(desktop): external-agent connection toggle in Equipment"
```

---

### Task 7: TS — agent version/port surfaced in status displays

**Files:**
- Modify: `desktop/src/features/checkin/hooks.ts`
- Modify: `desktop/src/features/checkin/hooks.test.tsx`
- Create: `desktop/src/features/checkin/agentDetail.ts`
- Test: `desktop/src/features/checkin/agentDetail.test.ts`
- Modify: `desktop/src/pages/Run.tsx`

**Interfaces:**
- Consumes: `agentGet` from `../../lib/agent` (existing), `getAgentExternalConfig` from `../../lib/agentConfig` (Task 3).
- Produces:

```ts
export function useAgentInfo(): UseQueryResult<{ machine_id: string; hostname: string; version: string; uptime_seconds: number }>;
export function useAgentPort(): UseQueryResult<number>;
export function formatAgentDetail(mode: "embedded" | "external", version: string | undefined, embeddedPort: number | undefined): string | undefined;
```

- [ ] **Step 1: Write the failing test for `agentDetail.ts`**

Create `desktop/src/features/checkin/agentDetail.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { setAgentExternalConfig } from "../../lib/agentConfig";
import { formatAgentDetail } from "./agentDetail";

afterEach(() => {
  localStorage.clear();
});

describe("formatAgentDetail", () => {
  it("returns undefined when there is nothing to show", () => {
    expect(formatAgentDetail("embedded", undefined, undefined)).toBeUndefined();
  });

  it("shows the version and embedded port", () => {
    expect(formatAgentDetail("embedded", "1.4.0", 12345)).toBe("v1.4.0 · :12345");
  });

  it("shows just the version when the embedded port is unknown", () => {
    expect(formatAgentDetail("embedded", "1.4.0", undefined)).toBe("v1.4.0");
  });

  it("shows the external host:port instead of the embedded port", () => {
    setAgentExternalConfig("http://192.168.1.50:12345", "tok");
    expect(formatAgentDetail("external", "1.4.0", undefined)).toBe("v1.4.0 · 192.168.1.50:12345");
  });

  it("falls back to just the version when the external URL is malformed", () => {
    setAgentExternalConfig("not-a-url", "tok");
    expect(formatAgentDetail("external", "1.4.0", undefined)).toBe("v1.4.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/features/checkin/agentDetail.test.ts`
Expected: FAIL (module `./agentDetail` not found).

- [ ] **Step 3: Create `desktop/src/features/checkin/agentDetail.ts`**

```ts
// Formats the agent's version + effective host:port for display next to the
// "agent" status node (Run.tsx) and Equipment's connection section -- the
// same derivation in both places, so it lives here once instead of twice.
import { getAgentExternalConfig } from "../../lib/agentConfig";

export function formatAgentDetail(
  mode: "embedded" | "external",
  version: string | undefined,
  embeddedPort: number | undefined,
): string | undefined {
  const versionPart = version ? `v${version}` : undefined;

  let addressPart: string | undefined;
  if (mode === "external") {
    try {
      addressPart = new URL(getAgentExternalConfig().baseUrl).host || undefined;
    } catch {
      addressPart = undefined;
    }
  } else if (embeddedPort) {
    addressPart = `:${embeddedPort}`;
  }

  const parts = [versionPart, addressPart].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w idento-desktop -- src/features/checkin/agentDetail.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Write the failing tests for the new hooks**

Append to `desktop/src/features/checkin/hooks.test.tsx` (add to the existing imports and add a new describe block at the end of the file):

Change the import line:

```tsx
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
  useCheckinStations,
  useEvent,
  useMarkAttendeePrinted,
  useRegisterStation,
  useSaveCheckinSettings,
  useStationCheckin,
  useStationHeartbeat,
} from "./hooks";
```

to:

```tsx
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useAgentInfo,
  useAgentPort,
  useCheckinActions,
  useCheckinSettings,
  useCheckinStations,
  useEvent,
  useMarkAttendeePrinted,
  useRegisterStation,
  useSaveCheckinSettings,
  useStationCheckin,
  useStationHeartbeat,
} from "./hooks";
```

Add at the end of the file:

```tsx
describe("useAgentInfo", () => {
  it("parses the agent's /info response", async () => {
    vi.spyOn(agentLib, "agentGet").mockResolvedValue(
      JSON.stringify({ machine_id: "m1", hostname: "kiosk-1", version: "1.4.0", uptime_seconds: 120 }),
    );
    const { result } = renderHook(() => useAgentInfo(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.version).toBe("1.4.0");
  });
});

describe("useAgentPort", () => {
  it("resolves the Tauri get_agent_port command's value", async () => {
    const tauriCore = await import("@tauri-apps/api/core");
    vi.spyOn(tauriCore, "invoke").mockResolvedValue(12345);
    const { result } = renderHook(() => useAgentPort(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(12345);
  });
});
```

- [ ] **Step 6: Run tests to verify the new ones fail**

Run: `npm test -w idento-desktop -- src/features/checkin/hooks.test.tsx`
Expected: the pre-existing tests PASS unchanged; `useAgentInfo`/`useAgentPort` FAIL (not exported yet).

- [ ] **Step 7: Add the new hooks to `desktop/src/features/checkin/hooks.ts`**

Append at the end of the file (after `useAgentHealth`):

```ts
// ---------------------------------------------------------------------------
// Agent info -- GET /info (agent, not backend): version + machine_id.
// ---------------------------------------------------------------------------

export function useAgentInfo() {
  return useQuery({
    queryKey: ["agent", "info"],
    queryFn: async () => {
      const text = await agentGet("/info");
      return JSON.parse(text) as { machine_id: string; hostname: string; version: string; uptime_seconds: number };
    },
    refetchInterval: 20_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Agent port -- Tauri's get_agent_port command (the embedded sidecar's
// fixed port; meaningless outside Tauri, where the query simply errors and
// callers see no port detail).
// ---------------------------------------------------------------------------

export function useAgentPort() {
  return useQuery({
    queryKey: ["agent", "port"],
    queryFn: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<number>("get_agent_port");
    },
    retry: false,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/checkin/hooks.test.tsx`
Expected: PASS (16/16).

- [ ] **Step 9: Wire the detail into Run.tsx's "agent" status node**

Read `desktop/src/pages/Run.tsx` first. Change the import lines:

```tsx
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useCheckinActions,
  useCheckinSettings,
  useEvent,
} from "@/features/checkin/hooks";
```

to:

```tsx
import {
  useAgentDefaultPrinter,
  useAgentHealth,
  useAgentInfo,
  useAgentPort,
  useCheckinActions,
  useCheckinSettings,
  useEvent,
} from "@/features/checkin/hooks";
import { formatAgentDetail } from "@/features/checkin/agentDetail";
import { getAgentMode } from "@/lib/agentConfig";
```

Add two new hook calls right after the existing `const agentHealth = useAgentHealth();` line:

```tsx
  const agentInfo = useAgentInfo();
  const agentPort = useAgentPort();
```

Change the `nodes` array's `agent` entry from:

```tsx
      { id: "agent", label: t("runNodeAgent"), level: agentHealth.data ? "ok" : "error" },
```

to:

```tsx
      {
        id: "agent",
        label: t("runNodeAgent"),
        level: agentHealth.data ? "ok" : "error",
        detail: agentHealth.data ? formatAgentDetail(getAgentMode(), agentInfo.data?.version, agentPort.data) : undefined,
      },
```

And update the `useMemo`'s dependency array from:

```tsx
    [t, connection.online, agentHealth.data, settings.print_on_checkin, settings.scan_input, printer.data, scannerDegraded],
```

to:

```tsx
    [
      t,
      connection.online,
      agentHealth.data,
      settings.print_on_checkin,
      settings.scan_input,
      printer.data,
      scannerDegraded,
      agentInfo.data?.version,
      agentPort.data,
    ],
```

- [ ] **Step 10: Run typecheck, full test suite, and build**

```bash
npm run typecheck -w idento-desktop
npm test -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean.

- [ ] **Step 11: Commit**

```bash
git add desktop/src/features/checkin/hooks.ts desktop/src/features/checkin/hooks.test.tsx desktop/src/features/checkin/agentDetail.ts desktop/src/features/checkin/agentDetail.test.ts desktop/src/pages/Run.tsx
git commit -m "feat(desktop): surface agent version/port in the run screen's status detail"
```

---

### Task 8: Go — standalone Linux distribution (systemd + install script)

**Files:**
- Create: `agent/dist/idento-agent.service`
- Create: `agent/dist/install.sh`

**Interfaces:**
- Consumes: the `idento-agent` binary (built separately — see Task 9's CI job, or manually via `cd agent && go build -o dist/idento-agent .` for local testing).
- Produces: no code interfaces — these are static/shell artifacts consumed by Task 9's CI job and by an operator installing on a headless Linux box.

- [ ] **Step 1: Create `agent/dist/idento-agent.service`**

```ini
# Installed by install.sh, which substitutes __IDENTO_AGENT_USER__ with the
# invoking (non-root) user before copying this file to
# /etc/systemd/system/idento-agent.service.
[Unit]
Description=Idento hardware agent (printers/scanners)
After=network.target

[Service]
Type=simple
User=__IDENTO_AGENT_USER__
ExecStart=/usr/local/bin/idento-agent --host 0.0.0.0 --port 12345
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create `agent/dist/install.sh`**

```bash
#!/usr/bin/env bash
# Installs the Idento hardware agent as a systemd service on a headless
# Linux box (typically a Raspberry Pi next to a printer/scanner). Run this
# as the user who should own the agent process (NOT root, e.g. `./install.sh`
# or `sudo ./install.sh` -- either works, the target user is detected
# either way). That user is baked into the installed unit and added to
# `dialout` for serial scanner/printer access.
#
# --host 0.0.0.0 in the unit (see idento-agent.service) is required for the
# kiosk app on another machine to reach this agent at all; the agent's own
# bearer-token auth (httpauth.go) is the real access gate, not the bind
# address -- see agent/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_SRC="${SCRIPT_DIR}/idento-agent"
BINARY_DEST="/usr/local/bin/idento-agent"
UNIT_SRC="${SCRIPT_DIR}/idento-agent.service"
UNIT_DEST="/etc/systemd/system/idento-agent.service"

INSTALL_USER="${SUDO_USER:-$(whoami)}"
INSTALL_HOME="$(getent passwd "${INSTALL_USER}" | cut -d: -f6)"

if [ ! -f "${BINARY_SRC}" ]; then
  echo "error: ${BINARY_SRC} not found -- run this script from the extracted agent-standalone bundle" >&2
  exit 1
fi
if [ -z "${INSTALL_HOME}" ]; then
  echo "error: could not resolve a home directory for user '${INSTALL_USER}'" >&2
  exit 1
fi

echo "Installing idento-agent for user '${INSTALL_USER}'..."

sudo install -m 0755 "${BINARY_SRC}" "${BINARY_DEST}"
sed "s/__IDENTO_AGENT_USER__/${INSTALL_USER}/" "${UNIT_SRC}" | sudo tee "${UNIT_DEST}" > /dev/null

sudo usermod -a -G dialout "${INSTALL_USER}" || true

sudo systemctl daemon-reload
sudo systemctl enable --now idento-agent.service

echo ""
echo "idento-agent is now running as a systemd service (idento-agent.service)."
echo "If '${INSTALL_USER}' was just added to the 'dialout' group, log out and back in"
echo "before using a serial scanner (group membership doesn't apply to the current session)."
echo ""
echo "To connect the kiosk app to this agent, use its 'External agent' setting"
echo "(Equipment step) with:"
echo ""

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  Base URL: http://${HOST_IP:-<this-machine-ip>}:12345"

CONFIG_FILE="${INSTALL_HOME}/.idento/agent_config.json"
TOKEN=""
for _ in 1 2 3 4 5; do
  if [ -f "${CONFIG_FILE}" ]; then
    TOKEN="$(grep -o '"auth_token"[[:space:]]*:[[:space:]]*"[^"]*"' "${CONFIG_FILE}" | sed 's/.*"\([^"]*\)"$/\1/')"
    [ -n "${TOKEN}" ] && break
  fi
  sleep 1
done
if [ -n "${TOKEN}" ]; then
  echo "  Token: ${TOKEN}"
else
  echo "  Token: (not generated yet -- run 'cat ${CONFIG_FILE}' in a few seconds, or"
  echo "          'curl http://localhost:12345/info' once the service is fully up)"
fi
```

- [ ] **Step 3: Make the install script executable and verify basic shell syntax**

```bash
chmod +x agent/dist/install.sh
bash -n agent/dist/install.sh
```

Expected: `bash -n` (syntax check only, does not execute) reports no errors.

- [ ] **Step 4: Manual verification (documented, not automated)**

No CI runner in this repo has systemd or a headless Linux target to fully exercise this. Document in the PR description: ran (or, if no Linux box is available, plan to run before relying on this in production) `cd agent && go build -o dist/idento-agent .`, then `./dist/install.sh` on a real (or VM) Linux machine, confirmed `systemctl status idento-agent` shows active/running, `curl http://localhost:12345/health` responds, and the printed Base URL + Token work when pasted into the kiosk app's Equipment → External agent fields (Task 6).

- [ ] **Step 5: Commit**

```bash
git add agent/dist/idento-agent.service agent/dist/install.sh
git commit -m "feat(agent): systemd unit + install script for standalone Linux distribution"
```

---

### Task 9: CI — standalone agent release bundle

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `agent/dist/idento-agent.service`, `agent/dist/install.sh` (Task 8), `agent/go.mod` (existing).
- Produces: a new `agent-standalone-bundle` job, and one new entry in the `release` job's `needs:` list. No changes to the `release` job's body — its `download-artifact` step already globs `idento-*`, which the new artifact name matches.

- [ ] **Step 1: Add the new job**

Read `.github/workflows/release.yml` first. Add a new job named `agent-standalone-bundle`, placed after the existing `onprem-bundle` job and before the `release` job:

```yaml
  agent-standalone-bundle:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      matrix:
        goarch: [amd64, arm64]
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-go@v6
        with:
          go-version-file: agent/go.mod
      - name: Build
        working-directory: agent
        env:
          CGO_ENABLED: "0"
          GOOS: linux
          GOARCH: ${{ matrix.goarch }}
        run: |
          go build -trimpath \
            -ldflags "-s -w -X main.agentVersion=${{ github.ref_name }}" \
            -o "idento-agent" .
      - name: Package bundle
        working-directory: agent
        run: |
          BUNDLE="idento-agent-standalone_linux_${{ matrix.goarch }}"
          mkdir -p "dist-out/${BUNDLE}"
          cp idento-agent "dist-out/${BUNDLE}/"
          cp dist/idento-agent.service "dist-out/${BUNDLE}/"
          cp dist/install.sh "dist-out/${BUNDLE}/"
          chmod +x "dist-out/${BUNDLE}/install.sh"
          tar -czf "${BUNDLE}.tar.gz" -C "dist-out/${BUNDLE}" .
      - uses: actions/upload-artifact@v6
        with:
          name: idento-agent-standalone_linux_${{ matrix.goarch }}
          path: agent/idento-agent-standalone_linux_${{ matrix.goarch }}.tar.gz
```

- [ ] **Step 2: Add it to the `release` job's dependencies**

Change:

```yaml
  release:
    needs: [backend-image, web-image, binaries, onprem-bundle]
```

to:

```yaml
  release:
    needs: [backend-image, web-image, binaries, onprem-bundle, agent-standalone-bundle]
```

- [ ] **Step 3: Validate the YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"
```

Expected: `YAML OK` (this only checks syntax, not GitHub Actions semantics — the real test is the next real tagged release, or a manual `workflow_dispatch`/PR-preview if the team has one; note this limitation in the PR description rather than claiming it as verified).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build and publish a standalone agent bundle per architecture"
```

---
