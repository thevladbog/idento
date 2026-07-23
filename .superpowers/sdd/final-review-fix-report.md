## Kiosk K2b — final whole-branch review fix report

Branch: `claude/idento-kiosk-desktop-app-k2b`.

Note: this file previously held the K3b final-review fix report. That content is
superseded here — see git history on this branch (or the `k3b` branch) for the K3b
report if needed.

Two Important findings from the final whole-branch review were fixed in one commit.

### Finding 1 (more serious) — a background 401 strands the window in lockdown with no way out

`desktop/src/lib/api.ts`'s global axios response interceptor does a full webview
document reload (`window.location.href = "/login?..."`) on any 401, on any authenticated
background request. Self-service kiosks run long unattended sessions with recurring
background requests (`useHeartbeat`'s 20s heartbeat POST, `useConnectionState`'s 20s
self-refetch, check-in POSTs), so a 401 from an expired station JWT is an expected event,
not an edge case. `window.location.href` tears down React's component tree without a
guaranteed graceful unmount, so `SelfServicePage`'s unmount cleanup (which calls
`invoke("exit_lockdown")`) is not reliably reached. `LockdownState` (Rust-side
`Mutex<bool>`) and the window's actual OS properties (fullscreen, no decorations,
always-on-top, close blocked) persist straight through the reload, because the reload
only replaces the webview's document — it does not restart the Tauri process. Result: the
app reloads to Login while still fully locked down, and neither `Login.tsx` nor staffed
`Run.tsx` has any exit-lockdown affordance — the window can end up stuck with no in-app
way out.

**Fix:** added a new, independent, unconditional boot effect to
`desktop/src/components/AgentLifecycle.tsx` (mounted once at the app root regardless of
route, per its existing doc comment) that calls `invoke("exit_lockdown")` on every mount.
Because `AgentLifecycle` lives inside the React tree, it re-mounts fresh whenever the
webview's JS/DOM re-executes from scratch — including immediately after the hard
`window.location.href` reload described above. The new effect is deliberately separate
from the existing `spawn_agent` effect (which early-returns for external-agent mode) so
lockdown release is never gated by agent-mode configuration. On a genuinely first-ever
boot this is a harmless no-op, since `LockdownState` already defaults to `false` and the
window is already unlocked; on a real "stranded" reload, it releases the stale Rust-side
lock and the actual window properties before the user ever sees the Login page. It does
not interfere with a later, genuine `SelfServicePage` mount in the same session, which
calls `enter_lockdown` again as normal.

### Finding 2 — silent `enter_lockdown`/`exit_lockdown` failures give no diagnostic signal

The three call sites that invoke `enter_lockdown`/`exit_lockdown`
(`SelfService.tsx`'s mount and unmount branches, `StaffExitOverlay.tsx`'s exit call, and
now `AgentLifecycle.tsx`'s new boot effect) wrapped the IPC call in an empty `catch {}`,
with no distinction between the benign "not running under Tauri" dev case and a genuine
production IPC/window-API failure — which would mean the kiosk silently proceeded without
the lockdown it believes it is under, a real safety-property violation for a feature that
exists specifically to contain a physically-accessible unattended kiosk.

**Fix:** all four `catch` blocks (the three named above plus the new `AgentLifecycle`
effect from Finding 1) now log the caught error via `console.error`, with a message
identifying which lockdown call failed and from where, e.g.
`console.error("enter_lockdown failed (SelfServicePage mount):", error)`. Behavior is
unchanged — the surrounding flow still proceeds regardless (self-service still starts
even if lockdown fails to engage; the Mode navigation in `StaffExitOverlay` still happens
even if lockdown fails to release) — this only adds visibility. No special-casing to
detect "not running under Tauri" was added, per the instructions: a developer running
`vite dev` in a browser will just see an expected, harmless console error.

### Step-by-step trace of how the new `AgentLifecycle` effect breaks Finding 1's failure chain

1. Self-service kiosk is running unattended on `/checkin/:eventId/self`; `SelfServicePage`
   is mounted and `enter_lockdown` has engaged the Rust-side `LockdownState` and the real
   OS window properties (fullscreen, no decorations, always-on-top, close blocked).
2. The station's JWT expires. A background request fires — `useHeartbeat`'s 20s POST,
   `useConnectionState`'s 20s self-refetch, or a check-in POST — and the server responds
   401.
3. `api.ts`'s global response interceptor calls `clearSession()` and, since the current
   path does not start with `/login` or `/qr-login`, sets
   `window.location.href = "/login?returnUrl=..."`.
4. The webview performs a full document reload. React's component tree is torn down
   without a guaranteed unmount pass, so `SelfServicePage`'s cleanup function (which would
   have called `exit_lockdown`) is not reliably reached. `LockdownState` stays `true` and
   the OS window stays locked down, because a webview document reload does not restart
   the Tauri process or touch Rust-managed state.
5. The reloaded webview boots React from scratch and renders the new document at
   `/login`. `AgentLifecycle` — mounted once at the app root regardless of route — mounts
   fresh as part of this from-scratch boot, exactly as it would on any other app start.
6. The new, unconditional boot effect added in this fix fires immediately on that mount
   and calls `invoke("exit_lockdown")`, independent of `getAgentMode()` or any other
   gating condition.
7. `exit_lockdown` releases the stale Rust-side lock (`LockdownState` back to `false`)
   and restores the real OS window properties (exits fullscreen/always-on-top, restores
   decorations, unblocks close) — all before the user has a chance to act.
8. The Login page the user now sees is genuinely unlocked: a normal, exitable window,
   not a kiosk-locked one masquerading as a login screen. If lockdown had already been
   released by `SelfServicePage`'s own unmount cleanup in some edge case, this call is a
   harmless idempotent no-op on an already-`false` lock.

### Verification (all run from repo root)

```shell
npm run typecheck -w idento-desktop
```
Result: clean (`tsc -b`, no errors).

```shell
npm run lint -w idento-desktop
```
Result: clean — 0 errors, 1 pre-existing unrelated warning
(`react-refresh/only-export-components` in `desktop/src/components/ui/button.tsx`, not
touched by this change). Note: the repo's RTK shell-wrapper hook mangled this command's
first invocation ("ESLint output (JSON parse failed...)"); re-ran via `rtk proxy npm run
lint -w idento-desktop` to get the real, unfiltered ESLint output, per this repo's known
RTK wrapper lint-masking hazard.

```shell
npm run build -w idento-desktop
```
Result: clean build (`tsc -b && vite build`), only a pre-existing chunk-size advisory
warning unrelated to this change.

```shell
npm test -w idento-desktop
```
Result: `Test Files 14 passed (14)`, `Tests 82 passed (82)` — no regressions. This
feature area has no dedicated test suite of its own per this codebase's established
convention; "clean" here means the existing suite is unaffected.

### Commit

Single new commit on this branch, titled
`fix(desktop): release stale lockdown on every app boot + log lockdown IPC failures`.

Files changed: `desktop/src/components/AgentLifecycle.tsx`,
`desktop/src/pages/SelfService.tsx`, `desktop/src/components/StaffExitOverlay.tsx`, plus
this report file.
