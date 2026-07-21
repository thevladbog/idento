## Kiosk K3a — final whole-branch review fix report

Branch: `claude/idento-kiosk-desktop-app-k3`. Base for this fix pass: `323bfc2` (Task 9, "ALL 9 TASKS COMPLETE").

Three findings from the final whole-branch review were fixed in one commit.

### Fix 1 (Important) — external-mode wrong token produces a false-green health check

`desktop/src/pages/Equipment.tsx`: the agent's `/health` endpoint is auth-exempt, so a
mistyped external token still shows "connected" — the first real endpoint call
(`/printers` etc., inside `fetchEquipmentData()`) then 401s.

Changes:
- Added `const [agentUnauthorized, setAgentUnauthorized] = useState(false);` next to the
  other `agentConnected`/`printers`/etc. state.
- `reconnectAgent`: reset `setAgentUnauthorized(false)` right after `setLoading(true)`;
  in the `catch` around `fetchEquipmentData()`, detect `e instanceof Error &&
  e.message.includes("401")` and call `setAgentUnauthorized(true)`.
- Mount `useEffect`'s `fetchEquipmentData()` catch block: identical 401 detection,
  guarded by the existing `cancelled` flag (matching the other `setPrinters`/etc. calls
  in that block).
- Render: inside the "Agent connection" `<section>`, right after the
  `{agentMode === "external" && (...)}` block, added
  `{agentUnauthorized && <p className="mt-3 text-kiosk-danger-soft">{t("agentUnauthorized")}</p>}`.
- `desktop/src/i18n.ts`: added `agentUnauthorized` key to both `en` and `ru` blocks,
  next to `agentExternalTokenPlaceholder`.

No changes to `checkAgentHealth()`, `agent.ts`, `agentConfig.ts`, or Rust code — this is
a UI-layer detection of an existing 401 error message string; the auth mechanism itself
is untouched.

### Fix 2 (Minor) — double-`v` version prefix

`desktop/src/features/checkin/agentDetail.ts`'s `formatAgentDetail` did `` `v${version}` ``.
A released standalone agent's `/info` returns a CI-baked version like `"v1.2.3"` (release
tags are `v`-prefixed), so the old code displayed `"vv1.2.3"`.

Fix: `versionPart` now strips any existing leading `v`/`V` (case-insensitive) before
re-adding exactly one: `` `v${version.replace(/^v/i, "")}` ``. This is a no-op on
unprefixed dev/mock values like `"1.4.0"`, so all 5 pre-existing tests in
`agentDetail.test.ts` are unaffected. Added one new test case asserting a `"v1.2.3"`
input produces `"v1.2.3 · :12345"` (not `"vv1.2.3 · :12345"`).

### Fix 3 (Minor) — unused `Manager` import

`desktop/src-tauri/src/commands.rs` imported `tauri::{AppHandle, Manager, State}` but
never used `Manager` (only `AppHandle` and `State` are used in that file; `Manager` is
used in `lib.rs` for `.try_state()`). Removed `Manager` from the import in
`commands.rs`. `lib.rs`'s own `use tauri::{Manager, RunEvent};` was left untouched.

### Verification (all run from repo root)

```
npm test -w idento-desktop -- src/features/checkin/agentDetail.test.ts
```
Result: `Test Files 1 passed (1)`, `Tests 6 passed (6)` (5 pre-existing + 1 new).

```
npm test -w idento-desktop
```
Result: `Test Files 11 passed (11)`, `Tests 70 passed (70)`.

```
npm run typecheck -w idento-desktop
```
Result: `tsc -b` — no output, exit clean.

```
npm run build -w idento-desktop
```
Result: `vite build` succeeded (`✓ built in 403ms`); only a pre-existing, unrelated
"chunk larger than 500 kB" advisory, no errors.

```
cd desktop/src-tauri && cargo build 2>&1 | grep -i warning
```
Environment hazard note: this repo has an RTK shell-wrapper hook (`PreToolUse: rtk hook
claude` in `~/.claude/settings.json`) that rewrites/condenses bash command output. The
first `cargo build` came back pre-condensed ("cargo build (1 crates compiled)"), which
could have hidden a warning. Re-verified with `rtk proxy cargo build` (raw/unfiltered
per `RTK.md`) after `touch`-ing `commands.rs`/`lib.rs` to force a real recompile:
```
   Compiling idento-desktop v0.1.0 (.../desktop/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.78s
```
No warning lines at all. `grep -i warning` on the raw proxied output also matched
nothing (exit code 1 / no matches) — the `unused import: Manager` warning is confirmed
gone.

```
cd desktop/src-tauri && cargo test --lib
```
Result (via `rtk proxy`, raw): `test result: ok. 15 passed; 0 failed; 0 ignored; 0
measured; 0 filtered out`.

### Commit

Single new commit on top of `323bfc2`, titled
`fix(desktop): K3a final-review fixes — external-agent 401 signal, double-v version, unused import`.
(This report is written as part of that same commit, so its own resulting SHA can't be
self-referenced here without a later amend, which this fix pass was told not to do —
see `git log -1` on this branch for the exact hash.)

Files changed: `desktop/src/pages/Equipment.tsx`, `desktop/src/i18n.ts`,
`desktop/src/features/checkin/agentDetail.ts`,
`desktop/src/features/checkin/agentDetail.test.ts`, `desktop/src-tauri/src/commands.rs`,
plus this report file. `.superpowers/sdd/progress.md` (K3a task-completion notes, already
modified in the working tree before this fix pass started) was included in the same
commit since it was uncommitted SDD process documentation for this same branch, not new
work from this pass.
