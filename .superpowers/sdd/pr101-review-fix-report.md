# PR #101 (Kiosk K3a) — CodeRabbit review fix report

Date: 2026-07-22
Branch: `claude/idento-kiosk-desktop-app-k3`

All 5 findings verified as genuine by the controller were implemented in this pass.

## Fix 1 — sanitize `github.ref_name` before shell interpolation in release.yml

**File:** `.github/workflows/release.yml`

`agent-standalone-bundle`'s `Build` step previously spliced `${{ github.ref_name }}`
directly into the `run:` shell script text (`-X main.agentVersion=${{ github.ref_name }}`),
a known GitHub Actions template-injection vector (zizmor finding) — a malicious ref
name containing shell metacharacters would be executed as script text rather than
treated as a plain string.

Mirrored the exact pattern already used a few lines above in `onprem-bundle`'s
`Package bundle` step:

- Added `RELEASE_TAG: ${{ github.ref_name }}` to the step's existing `env:` block
  (alongside `CGO_ENABLED`/`GOOS`/`GOARCH`).
- Added `case "$RELEASE_TAG" in *[!A-Za-z0-9._-]*) echo ...; exit 1 ;; esac` as the
  first line of the `run:` script.
- Changed `-X main.agentVersion=${{ github.ref_name }}` to
  `-X main.agentVersion=${RELEASE_TAG}` (shell variable, not template expression).

The pre-existing `binaries` (backend) job, which has the same underlying pattern,
was intentionally left untouched — out of scope for this PR.

## Fix 2 — add a `go test` step before packaging in `agent-standalone-bundle`

**File:** `.github/workflows/release.yml`

Added a `Test` step between `Build` and `Package bundle`:

```yaml
      - name: Test
        working-directory: agent
        run: go test ./...
```

Verified locally: `cd agent && go test ./...` passes (49 tests across the 2
packages that have tests, out of 4 packages total — see verification output
below). No linting/SAST tooling added, matching the rest of this repo's Go CI
jobs (including `binaries`, which has none either).

## Fix 3 — validate external-agent URLs in the browser-dev fallback path

**File:** `desktop/src/lib/agent.ts` (+ test: `desktop/src/lib/agent.test.ts`)

The Tauri-invoke path (`agent_request` in Rust) already validates external
target URLs. The browser-dev-only fallback (used only outside Tauri, never in
the shipped kiosk app) did plain string concatenation with no validation:
`` fetch(`${base}${path}`, ...) `` — a malformed `base_url` like
`http://attacker@evil.example` would silently send the request (with the
Bearer token) to `evil.example`.

Added a shared helper, used by both `agentGet` and `agentPost`:

```ts
function resolveAgentBaseUrl(baseUrl: string, path: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported agent base URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Agent base URL must not contain userinfo");
  }
  return new URL(path, parsed).toString();
}
```

It rejects any scheme other than `http`/`https` and any URL carrying
userinfo, then resolves `path` against the validated base and returns
`.toString()` (a plain string, not a `URL` object) — preserving the existing
tests' `toHaveBeenCalledWith("http://192.168.1.50:12345/health", ...)`
string-URL assertions.

Added two new tests proving the fix (`agent.test.ts`):
- `agentGet rejects a base URL containing userinfo instead of silently
  sending the request`
- `agentPost rejects a base URL containing userinfo instead of silently
  sending the request`

Both assert the call rejects/throws and that `fetch` was never invoked.

## Fix 4 — useAgentSupervisor's backoff now drives real retries, not just a cooldown gate

**Files:** `desktop/src/features/checkin/useAgentSupervisor.ts` (+ test:
`useAgentSupervisor.test.tsx`)

Previously, the cooldown `setTimeout` callback only cleared
`cooldownActiveRef` and doubled `backoffMsRef` — it never triggered a new
health check or restart attempt. Since every backoff value under 20s (1s,
2s, 4s, 8s, 16s) elapses well before `useAgentHealth`'s next scheduled 20s
poll, restart attempts could in practice only happen once per ~20s poll,
not at the documented accelerating 1s/2s/4s cadence.

Fix: when the cooldown timer fires, in addition to clearing the flag and
doubling the backoff, it now explicitly forces a fresh health check:

```ts
cooldownTimerRef.current = window.setTimeout(() => {
  cooldownActiveRef.current = false;
  backoffMsRef.current = Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
  void queryClient.refetchQueries({ queryKey: HEALTH_QUERY_KEY });
}, backoffMsRef.current);
```

This does NOT blindly call `restartAgentProcess()` again from the timer —
it only forces a fresh check. The refetch's result flows back through the
existing `queryClient.getQueryCache().subscribe(evaluate)` subscription
exactly like a normal poll would (fresh `dataUpdatedAt` → cache notifies →
`evaluate()` re-runs); since `recoveringRef.current` is still `true` at
that point, `evaluate()` will attempt another restart only if the fresh
check confirms the agent is still down, or fully reset if it's back up —
never restarting off stale/unconfirmed data.

Updated `useAgentSupervisor.test.tsx`'s "restarts after 3 consecutive
unhealthy polls, then again after the backoff elapses" test: after the
first restart, it now advances only 1s (not 20s) to observe restart #2,
and a further 2s to observe restart #3 — demonstrating the backoff interval
itself (not the 20s poll) drives the retry cadence. This closes the
previously-flagged test-coverage gap around exponential-backoff
growth/cap.

## Fix 5 — spec doc: clarify `externalBin` is never committed non-empty

**File:**
`docs/superpowers/specs/2026-07-21-kiosk-k3a-agent-distribution-design.md`
(§3 "Sidecar")

The sentence `` `externalBin: ["sidecars/idento-agent"]` прописывается в
`tauri.conf.json`. `` was misleading/contradicted the plan's own binding
constraint (and what was actually implemented): `tauri.conf.json`'s
`bundle.externalBin` stays `[]` in the committed repo state for this whole
phase (setting it non-empty would break CI's `build-desktop` job, since no
real per-target binary exists in `sidecars/` yet). Reworded to:

> `externalBin: ["sidecars/idento-agent"]` прописывается ТОЛЬКО в локальной,
> некоммитящейся копии `tauri.conf.json` для ручного тестирования sidecar —
> в закоммиченном репозитории `bundle.externalBin` остаётся `[]` (иначе
> `build-desktop` в CI падает, так как реального бинаря под target-triple
> ранера ещё нет).

Rest of the paragraph/section left as-is.

## What was NOT touched

- CodeRabbit's markdownlint nitpick about fenced code blocks in
  `.superpowers/sdd/final-review-fix-report.md` missing a language tag —
  skipped per instructions (throwaway internal report file, not
  documentation).
- The pre-existing `binaries` (backend) job's identical
  `github.ref_name`-in-`run:` pattern — out of scope for this PR (Fix 1
  only targets the job this PR added).

## Verification (from repo root)

```
$ npm test -w idento-desktop -- src/lib/agent.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm test -w idento-desktop -- src/features/checkin/useAgentSupervisor.test.tsx
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npm test -w idento-desktop
 Test Files  11 passed (11)
      Tests  72 passed (72)

$ npm run typecheck -w idento-desktop
> tsc -b
(no errors)

$ npm run build -w idento-desktop
> tsc -b && vite build
✓ 1889 modules transformed.
✓ built in 380ms
(pre-existing chunk-size warning only, unrelated to these changes)

$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"
YAML OK

$ cd agent && go test ./...
ok  	idento/agent	0.719s
ok  	idento/agent/internal/httpauth	0.400s
?   	idento/agent/internal/printer	[no test files]
?   	idento/agent/internal/scanner	[no test files]
(49 tests total across the 2 packages that have tests; re-verified directly
via `rtk proxy go test ./... -v` to bypass the RTK CLI-proxy hook's summarized
output, since this repo has a known hazard where that wrapper can obscure
raw command output)
```

## Commit

See the commit this report was included in for the final hash (one new
commit, not amended).
