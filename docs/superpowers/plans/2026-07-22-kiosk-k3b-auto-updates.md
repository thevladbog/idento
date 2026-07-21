# Kiosk K3b — Auto-Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `tauri-plugin-updater` + minisign signing into the desktop app, add a quiet update-check/install UX that never interrupts the run screen, and stand up a `desktop-v*` release workflow that signs and publishes Tauri bundles across the full 5-platform matrix with the Go agent sidecar automatically embedded.

**Architecture:** All update logic (check/install) runs through two new custom Tauri commands (`check_for_update`/`install_update`, mirroring K3a's `agent_request`/`spawn_agent` pattern) rather than calling `@tauri-apps/plugin-updater`'s JS API directly — verified that the JS `check()` has no runtime endpoint override, which the closed-network "manifest URL override" requirement needs. The update-check chip is a new `banner` slot on the shared `PreflightShell` (`packages/ui`), visible across all 5 pre-flight screens without touching each one's layout. The release workflow delegates the actual multi-platform build+sign+publish+`latest.json`-merge to the official `tauri-apps/tauri-action`, with a fully custom pre-step that cross-compiles the Go agent per platform and injects it via `--config` (never touching the committed `tauri.conf.json`'s `externalBin: []`).

**Tech Stack:** `tauri-plugin-updater` 2.10.1, `tauri-plugin-single-instance` 2.4.3 (Rust; verified against docs.rs for 2.11.5 compatibility), core `tauri::AppHandle::request_restart()` (no `tauri-plugin-process` needed), `@tanstack/react-query` (existing data layer), `tauri-apps/tauri-action@v0` (GitHub Action).

## Global Constraints

- **No new npm packages.** All update logic goes through `invoke()` to custom Rust commands — never `@tauri-apps/plugin-updater`'s or `@tauri-apps/plugin-process`'s JS APIs directly. Do not add either package to `desktop/package.json`.
- `desktop/src-tauri/tauri.conf.json`'s `bundle.externalBin` stays `[]` in the committed repo state (K3a's constraint, still binding) — the release workflow injects it via `--config` at build time only, never by editing this file.
- OS-level code signing (Windows Authenticode / macOS notarization) is explicitly out of scope — do not add certificate/notarization steps to the release workflow.
- The minisign keypair is generated and stored by the user, not by the implementer. Task 5's `tauri.conf.json` change uses a literal placeholder string for `pubkey` that MUST be replaced with a real public key before the first real release — this is a deliberate, documented placeholder (not a planning gap), called out explicitly in that task's steps and in `desktop/README.md`.
- Update-check UX must never block or interrupt `/checkin/:eventId` (the Run screen) — the update chip only renders inside `PreflightShell` (all 6 pre-flight pages: Connection, Login, QRLogin, Equipment, Checkin, Mode) and is absent from `Run.tsx`.
- `AppHandle::request_restart()` (core `tauri` crate, not a plugin) is the correct call for post-install relaunch — it triggers `RunEvent::Exit`, which already runs K3a's existing sidecar-cleanup handler in `lib.rs` unmodified.
- Known environment hazard (from K1/K2a/K3a): a shell wrapper (RTK) active in this environment can make `npm run lint`/`npm run build`/`cargo build` output look like a broken/missing config when it isn't. Verify with a direct tool invocation before concluding anything is actually broken.
- Commit after every task.

---

### Task 1: Rust — updater/single-instance plugins + check/install commands

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/src/commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing new from earlier K3b tasks (this is the first task). Reuses `AGENT_PORT`-adjacent patterns from K3a's `commands.rs` (already in the file) only as a style reference, not a dependency.
- Produces:

```rust
pub struct UpdateInfo { pub available: bool, pub version: String, pub notes: Option<String> } // Serialize
pub struct UpdateHandleState(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>); // Default
// check_for_update(app: AppHandle, state: State<'_, UpdateHandleState>, endpoint_override: Option<String>) -> Result<UpdateInfo, String>
// install_update(app: AppHandle, state: State<'_, UpdateHandleState>) -> Result<(), String>
```

- [ ] **Step 1: Add the crate dependencies**

Read `desktop/src-tauri/Cargo.toml` first, then add to `[dependencies]` (after the existing `tauri-plugin-shell = "2"` line):

```toml
tauri-plugin-updater = "2"
tauri-plugin-single-instance = "2"
```

- [ ] **Step 2: Write the failing tests for endpoint URL validation**

Add a new test module at the end of `desktop/src-tauri/src/commands.rs`, after the existing `#[cfg(test)] mod tests { ... }` block (do not modify that block — this is a separate module for the new update-domain logic):

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cd desktop/src-tauri && cargo test --lib update_tests`
Expected: compile error — `validate_endpoint_url` doesn't exist yet.

- [ ] **Step 3: Implement the validation function and the two commands**

Add near the top of `desktop/src-tauri/src/commands.rs`, right after the existing `use tauri_plugin_shell::ShellExt;` line:

```rust
use tauri_plugin_updater::UpdaterExt;
```

Then add the following at the end of the file, immediately before the `#[cfg(test)] mod tests` block (i.e., between the existing `AgentProcess`/`spawn_agent`/`stop_agent`/`restart_agent` code and the first test module):

```rust
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
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateHandleState>) -> Result<(), String> {
    let update = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    let update = update.ok_or_else(|| "No update available to install".to_string())?;
    update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.request_restart();
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop/src-tauri && cargo test --lib`
Expected: PASS — 15 pre-existing tests (unchanged) + 5 new `update_tests` = 20 total. Read the runner's own summary line to confirm the exact count rather than assuming.

- [ ] **Step 5: Register the plugins, state, and commands in `lib.rs`**

Read `desktop/src-tauri/src/lib.rs` first, then replace its contents:

```rust
//! Idento Kiosk - Tauri desktop app for check-in and equipment settings.

mod commands;

use tauri::{Manager, RunEvent};

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
        .invoke_handler(tauri::generate_handler![
            commands::agent_request,
            commands::get_agent_port,
            commands::spawn_agent,
            commands::stop_agent,
            commands::restart_agent,
            commands::check_for_update,
            commands::install_update,
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
            // and the exit cancelled. install_update's request_restart()
            // also triggers this same Exit event, so the sidecar is
            // cleanly stopped before the app relaunches post-update, with
            // no special-casing needed here.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<commands::AgentProcess>() {
                    commands::kill_agent_process(&state);
                }
            }
        });
}
```

- [ ] **Step 6: Verify it builds and all tests still pass**

```bash
cd desktop/src-tauri && cargo build && cargo test --lib
```

Expected: clean build, 20/20 tests pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock desktop/src-tauri/src/commands.rs desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): updater/single-instance plugins + check_for_update/install_update commands"
```

---

### Task 2: TS — update-check config + TanStack Query hooks

**Files:**
- Create: `desktop/src/lib/updateConfig.ts`
- Test: `desktop/src/lib/updateConfig.test.ts`
- Create: `desktop/src/features/updates/useUpdateCheck.ts`
- Test: `desktop/src/features/updates/useUpdateCheck.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier K3b tasks (Task 1's Rust commands are consumed only via their string names, `"check_for_update"`/`"install_update"`, and JSON shape `{available, version, notes}` — no TS import needed).
- Produces:

```ts
// updateConfig.ts
export function getManifestUrlOverride(): string;
export function setManifestUrlOverride(url: string): void;

// useUpdateCheck.ts
export interface UpdateInfo { available: boolean; version: string; notes: string | null }
export function useUpdateCheck(): UseQueryResult<UpdateInfo>;
export function useInstallUpdate(): UseMutationResult<void, unknown, void>;
```

- [ ] **Step 1: Write the failing tests for `updateConfig.ts`**

Create `desktop/src/lib/updateConfig.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getManifestUrlOverride, setManifestUrlOverride } from "./updateConfig";

afterEach(() => {
  localStorage.clear();
});

describe("getManifestUrlOverride / setManifestUrlOverride", () => {
  it("defaults to an empty string", () => {
    expect(getManifestUrlOverride()).toBe("");
  });

  it("round-trips a trimmed value", () => {
    setManifestUrlOverride("  https://mirror.example.internal/latest.json  ");
    expect(getManifestUrlOverride()).toBe("https://mirror.example.internal/latest.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w idento-desktop -- src/lib/updateConfig.test.ts`
Expected: FAIL (module `./updateConfig` not found).

- [ ] **Step 3: Create `desktop/src/lib/updateConfig.ts`**

```ts
// Persists the operator's optional override for the update-manifest URL
// (Equipment/Mode's "closed network / mirror" setting). Empty means "use
// the app's compiled-in default (tauri.conf.json's plugins.updater
// endpoints)". Mirrors config.ts's getBackendUrl/setBackendUrl pattern.
const MANIFEST_URL_KEY = "idento_update_manifest_url";

export function getManifestUrlOverride(): string {
  try {
    return localStorage.getItem(MANIFEST_URL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setManifestUrlOverride(url: string): void {
  try {
    localStorage.setItem(MANIFEST_URL_KEY, url.trim());
  } catch {
    // ignore (storage unavailable, QuotaExceededError, etc.)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w idento-desktop -- src/lib/updateConfig.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Write the failing tests for `useUpdateCheck.ts`**

Create `desktop/src/features/updates/useUpdateCheck.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setManifestUrlOverride } from "../../lib/updateConfig";
import { createWrapper } from "../../test/queryWrapper";
import { useInstallUpdate, useUpdateCheck } from "./useUpdateCheck";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("useUpdateCheck", () => {
  afterEach(() => {
    invokeMock.mockClear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("checks with endpointOverride: null when no manifest override is configured", async () => {
    invokeMock.mockResolvedValue({ available: false, version: "", notes: null });
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith("check_for_update", { endpointOverride: null });
    expect(result.current.data?.available).toBe(false);
  });

  it("checks with the configured endpointOverride when a manifest URL is set", async () => {
    setManifestUrlOverride("https://mirror.example.internal/latest.json");
    invokeMock.mockResolvedValue({ available: true, version: "1.4.0", notes: "Bug fixes" });
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith("check_for_update", {
      endpointOverride: "https://mirror.example.internal/latest.json",
    });
    expect(result.current.data?.version).toBe("1.4.0");
  });
});

describe("useInstallUpdate", () => {
  afterEach(() => {
    invokeMock.mockClear();
    vi.restoreAllMocks();
  });

  it("invokes install_update", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useInstallUpdate(), { wrapper: createWrapper() });
    await result.current.mutateAsync();
    expect(invokeMock).toHaveBeenCalledWith("install_update");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -w idento-desktop -- src/features/updates/useUpdateCheck.test.tsx`
Expected: FAIL (module `./useUpdateCheck` not found).

- [ ] **Step 7: Create `desktop/src/features/updates/useUpdateCheck.ts`**

```ts
// TanStack Query wrapper for the update-check/install Tauri commands
// (Task 1). Using useQuery (not a bespoke effect/interval hook) means the
// SAME cached result is shared no matter how many pre-flight pages mount
// the update chip during one session -- each page unmounts/remounts its
// own PreflightShell as the operator navigates between the 5 pre-flight
// steps, so a naive per-component boot-effect would re-check on every
// single page transition. refetchInterval covers the "recheck daily"
// requirement; the initial fetch on first mount covers "check at boot".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getManifestUrlOverride } from "../../lib/updateConfig";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string | null;
}

async function invokeCheckForUpdate(): Promise<UpdateInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  const override = getManifestUrlOverride();
  return invoke<UpdateInfo>("check_for_update", { endpointOverride: override || null });
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ["update", "check"],
    queryFn: invokeCheckForUpdate,
    refetchInterval: CHECK_INTERVAL_MS,
    retry: false,
  });
}

export function useInstallUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["update", "check"] });
    },
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -w idento-desktop -- src/features/updates/useUpdateCheck.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 9: Run the full suite + typecheck**

```bash
npm test -w idento-desktop
npm run typecheck -w idento-desktop
```

Expected: all clean (72 pre-existing + 2 + 3 = 77 tests).

- [ ] **Step 10: Commit**

```bash
git add desktop/src/lib/updateConfig.ts desktop/src/lib/updateConfig.test.ts desktop/src/features/updates/useUpdateCheck.ts desktop/src/features/updates/useUpdateCheck.test.tsx
git commit -m "feat(desktop): update-check config + TanStack Query hooks"
```

---

### Task 3: packages/ui — `PreflightShell`'s new `banner` slot

**Files:**
- Modify: `packages/ui/src/kiosk/preflight-shell.tsx`
- Modify: `packages/ui/src/kiosk/preflight-shell.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `PreflightShellProps` gains an optional `banner?: React.ReactNode`, rendered in the shell's top-right corner, independent of the existing `footer` slot.

- [ ] **Step 1: Write the failing tests**

Read `packages/ui/src/kiosk/preflight-shell.test.tsx` first, then add two new `it` blocks inside the existing `describe("PreflightShell", ...)`:

```tsx
  it("renders the banner when provided", () => {
    render(
      <PreflightShell steps={steps} activeIndex={2} banner={<div>Update available</div>}>
        <div>Тело шага</div>
      </PreflightShell>,
    );
    expect(screen.getByText("Update available")).toBeInTheDocument();
  });

  it("renders nothing extra when banner is omitted", () => {
    render(
      <PreflightShell steps={steps} activeIndex={2}>
        <div>Тело шага</div>
      </PreflightShell>,
    );
    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npm test -w @idento/ui -- src/kiosk/preflight-shell.test.tsx`
Expected: the pre-existing test passes; "renders the banner when provided" FAILS (`banner` prop doesn't exist / not rendered).

- [ ] **Step 3: Add the `banner` prop**

Read `packages/ui/src/kiosk/preflight-shell.tsx` first, then replace its contents:

```tsx
import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";

export interface PreflightShellProps {
  steps: { label: string }[];
  activeIndex: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  banner?: React.ReactNode;
  className?: string;
}

/** Хребет pre-flight (1r): рейка из 5 шагов, один активный, карточка 820px по центру. */
export function PreflightShell({ steps, activeIndex, children, footer, banner, className }: PreflightShellProps) {
  return (
    <div className={cn("relative flex h-full flex-col items-center bg-kiosk-bg text-kiosk-text", className)} style={{ fontFamily: "var(--kiosk-font)" }}>
      {banner && <div className="absolute right-8 top-8">{banner}</div>}
      <ol className="mt-[7vh] flex items-center gap-9 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
        {steps.map((step, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={step.label} data-state={state} aria-current={state === "active" ? "step" : undefined} className={cn("flex items-center gap-3", state !== "pending" && "font-bold text-kiosk-text")}>
              {i > 0 && <span aria-hidden className="-ml-6 mr-3 h-0.5 w-14 bg-kiosk-border-2" />}
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full font-extrabold", state === "pending" ? "border-2 border-kiosk-border-2" : "bg-kiosk-brand text-kiosk-text")}>
                {state === "done" ? <Check aria-hidden className="size-5" strokeWidth={3.5} /> : i + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="my-auto w-[min(820px,92vw)] rounded-3xl border border-kiosk-border bg-kiosk-surface p-14">{children}</div>
      {footer && (
        <div className="mb-12 text-kiosk-text-4" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}
```

(Only two changes from the current file: `banner?: React.ReactNode;` added to the props interface, and the destructured `banner` param + `{banner && <div className="absolute right-8 top-8">{banner}</div>}` line + `relative` added to the outer `className`. Everything else is byte-identical to the current file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @idento/ui -- src/kiosk/preflight-shell.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full `@idento/ui` suite + typecheck**

```bash
npm test -w @idento/ui
npm run typecheck -w @idento/ui
```

Expected: all clean (no other component reads `PreflightShellProps` exhaustively, so this additive change can't break anything else).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/kiosk/preflight-shell.tsx packages/ui/src/kiosk/preflight-shell.test.tsx
git commit -m "feat(ui): PreflightShell gains an optional banner slot"
```

---

### Task 4: desktop — `UpdateChip` + wiring into all 6 pre-flight pages + Mode's manifest-URL field

**Files:**
- Create: `desktop/src/components/UpdateChip.tsx`
- Modify: `desktop/src/pages/Connection.tsx`
- Modify: `desktop/src/pages/Login.tsx`
- Modify: `desktop/src/pages/QRLogin.tsx`
- Modify: `desktop/src/pages/Equipment.tsx`
- Modify: `desktop/src/pages/Checkin.tsx`
- Modify: `desktop/src/pages/Mode.tsx`
- Modify: `desktop/src/i18n.ts`

**Interfaces:**
- Consumes: `useUpdateCheck`/`useInstallUpdate` from `../features/updates/useUpdateCheck` (Task 2), `PreflightShell`'s new `banner` prop (Task 3), `getManifestUrlOverride`/`setManifestUrlOverride` from `../lib/updateConfig` (Task 2).
- Produces: `UpdateChip` component (no props), used identically across all 6 pages.

This task has no dedicated component test (no pre-flight page has ever had one in this codebase — same convention K3a's Task 6 followed). Verification is typecheck/lint/build plus a documented manual check.

- [ ] **Step 1: Add the new i18n keys**

Read `desktop/src/i18n.ts` first. In the `en.translation` block, add right after the `modeSaveAndStart` line:

```ts
        updateAvailable: "Update available: {{version}}",
        updateReview: "Review",
        updateInstall: "Install and restart",
        modeUpdateManifestUrlTitle: "Update manifest URL (advanced)",
        modeUpdateManifestUrlPlaceholder: "https://mirror.example.internal/latest.json",
```

In the `ru.translation` block, add right after its `modeSaveAndStart` line:

```ts
        updateAvailable: "Доступно обновление: {{version}}",
        updateReview: "Подробнее",
        updateInstall: "Установить и перезапустить",
        modeUpdateManifestUrlTitle: "URL манифеста обновлений (расширенно)",
        modeUpdateManifestUrlPlaceholder: "https://mirror.example.internal/latest.json",
```

- [ ] **Step 2: Create `desktop/src/components/UpdateChip.tsx`**

```tsx
// Quiet update-availability chip: renders nothing when no update is
// available, so it's safe to mount on every pre-flight page (Task 4) --
// never shown on the Run screen, per the "run mode never interrupted"
// policy. Tap to review the version, then confirm to install (download +
// install + relaunch all happen inside install_update, see Task 1/2).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KioskButton } from "@idento/ui/kiosk";
import { useInstallUpdate, useUpdateCheck } from "@/features/updates/useUpdateCheck";

export function UpdateChip() {
  const { t } = useTranslation();
  const { data } = useUpdateCheck();
  const install = useInstallUpdate();
  const [confirming, setConfirming] = useState(false);

  if (!data?.available) return null;

  return (
    <div className="flex items-center gap-3 rounded-full border border-kiosk-border-2 bg-kiosk-surface-2 px-4 py-2 text-kiosk-text-3" style={{ fontSize: "var(--kiosk-fs-chrome)" }}>
      <span>{t("updateAvailable", { version: data.version })}</span>
      {confirming ? (
        <>
          <KioskButton size="md" onClick={() => install.mutate()} disabled={install.isPending}>
            {t("updateInstall")}
          </KioskButton>
          <KioskButton size="md" variant="ghost" onClick={() => setConfirming(false)} disabled={install.isPending}>
            {t("cancel")}
          </KioskButton>
        </>
      ) : (
        <KioskButton size="md" variant="ghost" onClick={() => setConfirming(true)}>
          {t("updateReview")}
        </KioskButton>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire `banner={<UpdateChip />}` into all 6 pre-flight pages**

For each of the following 6 files, read the file first, add the import `import { UpdateChip } from "@/components/UpdateChip";` alongside the other `@/...` imports, and add `banner={<UpdateChip />}` as a new prop on the existing `<PreflightShell ...>` opening tag (keep every other existing prop exactly as-is).

`desktop/src/pages/Connection.tsx` — change:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={0}
      footer={
```
to:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={0}
      banner={<UpdateChip />}
      footer={
```

`desktop/src/pages/Login.tsx` — change:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={1}
      footer={
```
to:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={1}
      banner={<UpdateChip />}
      footer={
```

`desktop/src/pages/QRLogin.tsx` — same as Login.tsx (identical `activeIndex={1}` + `footer={` shape):
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={1}
      banner={<UpdateChip />}
      footer={
```

`desktop/src/pages/Checkin.tsx` — change:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={2}
      footer={
```
to:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={2}
      banner={<UpdateChip />}
      footer={
```

`desktop/src/pages/Equipment.tsx` — change:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={3}
      footer={
```
to:
```tsx
    <PreflightShell
      steps={steps}
      activeIndex={3}
      banner={<UpdateChip />}
      footer={
```

`desktop/src/pages/Mode.tsx` — this one has no `footer` prop today. Change:
```tsx
    <PreflightShell steps={steps} activeIndex={4}>
```
to:
```tsx
    <PreflightShell steps={steps} activeIndex={4} banner={<UpdateChip />}>
```

- [ ] **Step 4: Add the manifest-URL-override field to Mode.tsx**

Read `desktop/src/pages/Mode.tsx` first (in full — this step also needs Step 3's `UpdateChip` import/banner prop already applied to this same file, so make both edits together in one pass over the file).

Add a new import alongside the existing ones:
```ts
import { getManifestUrlOverride, setManifestUrlOverride } from "@/lib/updateConfig";
```

Add new state right after the existing `const [settings, setSettings] = useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);` line:
```ts
  const [updateManifestUrl, setUpdateManifestUrl] = useState(() => getManifestUrlOverride());
```

Change `saveAndStart` from:
```ts
  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      navigate(`/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinSettingsSaveFailed"));
    }
  };
```
to:
```ts
  const saveAndStart = async () => {
    try {
      await saveSettings.mutateAsync(settings);
      localStorage.setItem(RUN_LAYOUT_KEY, layout);
      setManifestUrlOverride(updateManifestUrl);
      navigate(`/checkin/${eventId}`);
    } catch {
      toast.error(t("checkinSettingsSaveFailed"));
    }
  };
```

Add a new field in the JSX, right before the final `<KioskButton onClick={saveAndStart} disabled={saveSettings.isPending}>` button (i.e., after the existing `verdict_auto_dismiss_sec` slider `<div>` block):
```tsx
          <div>
            <label htmlFor="update-manifest-url" className="text-kiosk-text">
              {t("modeUpdateManifestUrlTitle")}
            </label>
            <KioskInput
              id="update-manifest-url"
              placeholder={t("modeUpdateManifestUrlPlaceholder")}
              value={updateManifestUrl}
              onChange={(e) => setUpdateManifestUrl(e.target.value)}
              className="mt-2"
            />
          </div>
```

Since this file doesn't currently import `KioskInput` (only `PreflightShell`, `KioskButton`), update the import line from:
```ts
import { PreflightShell, KioskButton } from "@idento/ui/kiosk";
```
to:
```ts
import { PreflightShell, KioskButton, KioskInput } from "@idento/ui/kiosk";
```

- [ ] **Step 5: Run typecheck, lint, and build**

```bash
npm run typecheck -w idento-desktop
npm run lint -w idento-desktop
npm run build -w idento-desktop
```

Expected: all clean. Per the Global Constraints, verify any "missing/broken config" report from `lint`/`build` with a direct tool invocation before concluding something is actually broken.

- [ ] **Step 6: Manual verification (documented, not automated)**

Document in the PR description: ran `npm run tauri dev -w idento-desktop`, walked through all 6 pre-flight screens confirming no visible chip when `check_for_update` errors/returns `available: false` (expected in local dev, since there's no real signed release to check against), and confirmed the Mode screen's new manifest-URL field renders and persists across a save.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/UpdateChip.tsx desktop/src/pages/Connection.tsx desktop/src/pages/Login.tsx desktop/src/pages/QRLogin.tsx desktop/src/pages/Equipment.tsx desktop/src/pages/Checkin.tsx desktop/src/pages/Mode.tsx desktop/src/i18n.ts
git commit -m "feat(desktop): update chip on all pre-flight screens + manifest-URL override setting"
```

---

### Task 5: Config + docs — `tauri.conf.json`'s updater plugin block + minisign setup instructions

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: no code interfaces — static config + documentation consumed by an operator running the manual key-generation steps, and by Task 6's release workflow (which reads `plugins.updater.endpoints`' tag scheme when reasoning about `desktop-v*`).

- [ ] **Step 1: Add the `plugins.updater` block to `tauri.conf.json`**

Read `desktop/src-tauri/tauri.conf.json` first. Change:
```json
  "plugins": {}
```
to:
```json
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_MINISIGN_PUBLIC_KEY_FROM_tauri_signer_generate",
      "endpoints": [
        "https://github.com/thevladbog/idento/releases/latest/download/latest.json"
      ]
    }
  }
```

The `pubkey` value is a deliberate placeholder — it MUST be replaced with the real public key printed by Step 2's `tauri signer generate` command before the first `desktop-v*` tag is pushed. An update check against this placeholder value will simply fail signature verification (safe failure mode: no update ever installs), not silently succeed with an unverified binary.

- [ ] **Step 2: Add the minisign/secrets setup section to `desktop/README.md`**

Read `desktop/README.md` first. Add a new section right after the existing "## Connecting to a standalone agent (external mode)" section (before "## Raspberry Pi"):

```markdown
## Auto-updates (one-time setup, before the first release)

The desktop app checks for updates against signed release manifests. Before
tagging the first `desktop-v*` release, generate a minisign keypair and wire
it into this repo (**run these yourself** -- not automated):

```bash
# From the repo root, with the Tauri CLI already installed (npm ci first):
npx tauri signer generate -w ~/.tauri/idento-kiosk.key
```

This prints a public key and writes the private key to
`~/.tauri/idento-kiosk.key` (you'll be prompted for a password -- remember
it). Then:

1. Replace `REPLACE_WITH_MINISIGN_PUBLIC_KEY_FROM_tauri_signer_generate` in
   `src-tauri/tauri.conf.json`'s `plugins.updater.pubkey` with the printed
   public key, and commit that change.
2. Set the two GitHub secrets the release workflow reads:
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/idento-kiosk.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   # (paste the password you chose above when prompted)
   ```

Keep `~/.tauri/idento-kiosk.key` somewhere safe outside the repo -- it's
never committed, and losing it means future releases can't be verified as
continuations of past ones (operators would need to manually reinstall).

Update checks happen at app boot and once every 24 hours; the run screen is
never interrupted. An "Update manifest URL (advanced)" field in the Mode
pre-flight step lets a station point at a self-hosted mirror instead of
GitHub Releases, for closed networks -- it must serve the same `latest.json`
format Tauri's updater expects (`file://` paths are not supported; the
mirror needs to be a plain HTTP(S) server).
```

- [ ] **Step 3: Validate the JSON syntax**

```bash
python3 -c "import json; json.load(open('desktop/src-tauri/tauri.conf.json'))" && echo "JSON OK"
```

Expected: `JSON OK`.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/tauri.conf.json desktop/README.md
git commit -m "feat(desktop): updater plugin config + minisign setup docs"
```

---

### Task 6: CI — `desktop-v*` release workflow (5-platform matrix via `tauri-apps/tauri-action`)

**Files:**
- Create: `.github/workflows/release-desktop.yml`

**Interfaces:**
- Consumes: `agent/main.go`'s `agentVersion` build-time symbol (same `-X main.agentVersion=` convention as K3a's `agent-standalone-bundle` job), `desktop/src-tauri/tauri.conf.json`'s `bundle.externalBin: []` (untouched — injected via `--config` at build time only), the placeholder `pubkey` from Task 5 (a real release requires Task 5's manual key-generation step to have already happened — this task's own verification does not require it, since no real tag is pushed here).
- Produces: no code interfaces — a new GitHub Actions workflow file, triggered by `desktop-v*` tags (never fired by this plan's own work, since no such tag is pushed).

No automated test exists for a GitHub Actions workflow beyond syntax validation — the same honest scoping K3a's `agent-standalone-bundle` job used. Real functional verification only happens on the first genuine `desktop-v*` tag push.

- [ ] **Step 1: Create `.github/workflows/release-desktop.yml`**

```yaml
name: Release Desktop

on:
  push:
    tags: ["desktop-v*"]

# Least privilege: only this one job needs to write (create the release);
# nothing here needs any other permission.
permissions: {}

jobs:
  release-desktop:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-14
            goos: darwin
            goarch: arm64
          - platform: macos-13
            goos: darwin
            goarch: amd64
          - platform: windows-latest
            goos: windows
            goarch: amd64
          - platform: ubuntu-latest
            goos: linux
            goarch: amd64
          - platform: ubuntu-24.04-arm
            goos: linux
            goarch: arm64
    runs-on: ${{ matrix.platform }}
    # Best-effort: this ARM Linux runner's availability for this account is
    # unconfirmed (same open assumption as K3a's agent-standalone-bundle
    # job) -- don't let it block the other 4 platforms if unavailable.
    continue-on-error: ${{ matrix.platform == 'ubuntu-24.04-arm' }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      - uses: actions/setup-node@v5
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: package-lock.json

      - uses: dtolnay/rust-toolchain@stable

      - uses: actions/setup-go@v6
        with:
          go-version-file: agent/go.mod

      - name: Install Tauri system deps (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install dependencies
        run: npm ci

      - name: Determine target triple
        id: target
        shell: bash
        run: echo "triple=$(rustc -vV | sed -n 's/host: //p')" >> "$GITHUB_OUTPUT"

      - name: Build agent sidecar
        working-directory: agent
        shell: bash
        env:
          CGO_ENABLED: "0"
          GOOS: ${{ matrix.goos }}
          GOARCH: ${{ matrix.goarch }}
          RELEASE_TAG: ${{ github.ref_name }}
        run: |
          case "$RELEASE_TAG" in
            *[!A-Za-z0-9._-]*) echo "Unsupported release tag: $RELEASE_TAG" >&2; exit 1 ;;
          esac
          EXT=""
          if [ "${{ matrix.goos }}" = "windows" ]; then
            EXT=".exe"
          fi
          go build -trimpath \
            -ldflags "-s -w -X main.agentVersion=${RELEASE_TAG}" \
            -o "../desktop/src-tauri/sidecars/idento-agent-${{ steps.target.outputs.triple }}${EXT}" .

      - name: Write externalBin config patch
        # A file path, not an inline JSON string, deliberately: `args` below
        # is a YAML string handed to tauri-action's own shell invocation,
        # and this repo's release-desktop job runs across three different
        # shells (bash on Linux/macOS, bash-via-Git-Bash on Windows since
        # the other custom steps set shell: bash) -- inline JSON with
        # embedded quotes is exactly the kind of thing that silently
        # mis-quotes across that combination. A plain file path sidesteps
        # all of it; Tauri's --config flag accepts either form (verified
        # via `tauri build --help`).
        shell: bash
        run: echo '{"bundle":{"externalBin":["sidecars/idento-agent"]}}' > "${{ github.workspace }}/sidecar-config.json"

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: desktop
          tagName: ${{ github.ref_name }}
          releaseName: "Idento Kiosk ${{ github.ref_name }}"
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
          args: --config ${{ github.workspace }}/sidecar-config.json
```

- [ ] **Step 2: Validate the YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-desktop.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`. As with K3a's CI task, this only proves syntactic validity, not that the workflow succeeds on a real runner — note this limitation in the PR description rather than claiming full verification. Real verification happens on the first genuine `desktop-v*` tag push, which requires Task 5's manual minisign setup to have already happened.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-desktop.yml
git commit -m "ci(release): desktop-v* release workflow (5-platform matrix via tauri-action)"
```

---
