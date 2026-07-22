## Kiosk K3b — final whole-branch review fix report

Branch: `claude/idento-kiosk-desktop-app-k3b`. Base for this fix pass: `cab822b`
(K3b Task 6, "ALL 6 TASKS COMPLETE").

Note: this file previously held the K3a final-review fix report (three findings on the
`k3` branch, commit `b4c7c48`). That content is superseded here — see git history on
this branch (or the `k3` branch) for the K3a report if needed.

One Critical finding from the final whole-branch review was fixed in one commit.

### Fix (Critical) — `bundle.createUpdaterArtifacts` never set anywhere

`createUpdaterArtifacts` is a Tauri config flag that defaults to `false`. Without it,
`tauri build` produces ordinary app bundles but no `.sig` signature files and no updater
metadata, so `tauri-action`'s `includeUpdaterJson: true` step has nothing to assemble
`latest.json` from. Confirmed via `grep -rn createUpdaterArtifacts desktop/ .github/`
returning zero matches before the fix. Left unfixed, the entire auto-update feature this
K3b plan built would have shipped silently non-functional on the first real release: no
build error, just the app's compiled-in update endpoint 404ing forever.

Fix: added the flag to the release workflow's existing build-time `--config` patch
mechanism, `.github/workflows/release-desktop.yml`'s "Write externalBin config patch"
step, which already exists specifically so build-time-only values never need to be baked
into the committed `tauri.conf.json`:

```diff
-        run: echo '{"bundle":{"externalBin":["sidecars/idento-agent"]}}' > "${{ github.workspace }}/sidecar-config.json"
+        run: echo '{"bundle":{"externalBin":["sidecars/idento-agent"],"createUpdaterArtifacts":true}}' > "${{ github.workspace }}/sidecar-config.json"
```

This is deliberately **not** in the committed `desktop/src-tauri/tauri.conf.json`.
`.github/workflows/ci.yml`'s `build-desktop` job (PR-time, `cd desktop && npm run tauri
build`) has no `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` secrets in its environment at all
(confirmed via `grep -n "TAURI_SIGNING" .github/workflows/ci.yml`, zero matches). If the
flag were committed directly into `tauri.conf.json`, every desktop-touching PR's build
would attempt to sign updater artifacts with no private key present and fail CI.
Confining the flag to the release workflow's build-time config patch — which does have
the signing secrets, injected into `tauri-action`'s own `env:` block — keeps PR CI
unaffected and only enables signing where the secrets actually exist.

Also added, per the reviewer's Minor recommendation, one short note to
`desktop/README.md`'s "Auto-updates (one-time setup, before the first release)" section
(right after its intro paragraph, before the `npx tauri signer generate` code block)
explaining that `createUpdaterArtifacts` is injected by the release workflow at build
time and is not something to add to the committed config — so a future reader doesn't
get confused and add it to `tauri.conf.json` themselves:

> `bundle.createUpdaterArtifacts` (required for Tauri to emit `.sig` files and updater
> metadata) is injected by `.github/workflows/release-desktop.yml`'s `--config` patch at
> build time, not set in the committed `src-tauri/tauri.conf.json` -- PR-time CI builds
> have no signing secrets, so baking it into the committed config would break every
> desktop-touching PR.

### Verification (all run from repo root)

```shell
grep -n "createUpdaterArtifacts" .github/workflows/release-desktop.yml
```
Result: exactly one match —
```text
102:        run: echo '{"bundle":{"externalBin":["sidecars/idento-agent"],"createUpdaterArtifacts":true}}' > "${{ github.workspace }}/sidecar-config.json"
```

```shell
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-desktop.yml'))" && echo "YAML OK"
```
Result: `YAML OK`.

```shell
python3 -c "import json; json.load(open('desktop/src-tauri/tauri.conf.json'))" && echo "JSON OK (confirming tauri.conf.json itself was NOT touched by this fix)"
```
Result: `JSON OK (confirming tauri.conf.json itself was NOT touched by this fix)`.

```shell
git diff --stat
```
Result (before this commit, working tree):
```text
.github/workflows/release-desktop.yml |  2 +-
 .superpowers/sdd/progress.md          | 11 +++++++++++
 desktop/README.md                     |  5 +++++
 3 files changed, 17 insertions(+), 1 deletion(-)
```
`desktop/src-tauri/tauri.conf.json` is confirmed absent from the diff — the fix only
touched the release workflow's build-time config patch and the README doc note.
`.superpowers/sdd/progress.md` was already modified in the working tree before this fix
pass started (K3b task-completion notes, uncommitted SDD process documentation for this
same branch) — included in the same commit as pre-existing process notes, not new work
from this pass, matching the convention used in this branch's earlier K3a final-fix
commit.

Environment hazard check: this repo has an RTK shell-wrapper hook that can rewrite/
condense bash output. All commands above were also cross-checked by direct file reads
(`Read` tool on both edited files, showing the exact diff hunks) rather than relying on
`grep`/`git diff` output alone — the RTK proxy was not needed here since `grep -n` on a
2-line-changed file and `python3 -c` one-liners produce output too short to plausibly be
mis-condensed, and the file reads independently confirm the same content.

### Commit

Single new commit on top of `cab822b`, titled
`fix(desktop): K3b final-review fix — inject createUpdaterArtifacts at release build time`.
(This report is written as part of that same commit, so see `git log -1` on this branch
for the exact resulting SHA.)

Files changed: `.github/workflows/release-desktop.yml`, `desktop/README.md`, plus this
report file. `.superpowers/sdd/progress.md` (K3b task-completion notes, already modified
in the working tree before this fix pass started) was included in the same commit since
it was uncommitted SDD process documentation for this same branch, not new work from
this pass.
