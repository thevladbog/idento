# Release Image Gating Design

**Date:** 2026-07-12
**Status:** Approved

## Problem

`.github/workflows/release.yml` triggers on `push: tags: ["v*"]`. Its `backend-image`
and `web-image` jobs build and push Docker images straight to GHCR — including the
`:latest` tag — with no validation gate. `.github/workflows/ci.yml` (the project's
lint/test/build/security pipeline) only triggers on `push` to `main`/`master` and on
`pull_request`; it never runs against a tag ref. So a tag push has zero automated
gating before a potentially broken image is published and becomes the new `:latest`.

This is pre-existing on `backend-image` (flagged by CodeRabbit on PR #43, which added
`web-image` following the same pre-existing pattern — not a regression in that PR).

## Goal

Both `backend-image` and `web-image` must not push to GHCR unless the checks that
would normally gate a merge to `main` (lint, security scan, test, build for backend;
typecheck, lint, build for web) have passed for the tagged commit.

## Approach

Extract the backend/web validation jobs out of `ci.yml` into a new reusable workflow,
triggered via `workflow_call`, that both `ci.yml` and `release.yml` invoke. This avoids
duplicating step logic (which would drift over time) and avoids the latency/edge-case
problems of a `workflow_run`-based trigger (a tag on a commit where `ci.yml` never ran,
e.g. a hotfix branch, would never satisfy that trigger).

Two other approaches were considered and rejected:
- **`workflow_run` trigger**: release.yml waits for a successful `ci.yml` run on the
  tagged commit. Rejected: tags aren't guaranteed to point at a commit that ever went
  through `ci.yml` on `main`, so this could deadlock a release indefinitely.
- **Inline fast subset in `release.yml`**: duplicate a fast lint+test+build subset
  directly in `release.yml`. Rejected: duplicates logic that will silently drift from
  `ci.yml` as the two files are edited independently over time.

Because a tag push has no "changed files" diff to filter on (unlike a PR/push to
`main`), the gate runs the full backend and full web check sets unconditionally when
invoked from `release.yml` — there is no equivalent of `ci.yml`'s `changes` path-filter
optimization for a release.

## Design

### New file: `.github/workflows/validate.yml`

A reusable workflow (`on: workflow_call`) with two boolean inputs:

- `run-backend` (boolean, default `true`)
- `run-web` (boolean, default `true`)

Jobs, moved verbatim from `ci.yml` (same steps, versions, and tool invocations —
no behavior change to the checks themselves):

- `lint-go` — `if: inputs.run-backend`
- `gosec` — `if: inputs.run-backend`
- `test-go` — `needs: lint-go`, `if: inputs.run-backend`
- `build-go` — `needs: test-go`, `if: inputs.run-backend`
- `typecheck-web` — `if: inputs.run-web`
- `lint-web` — `if: inputs.run-web`
- `build-web` — `needs: [typecheck-web, lint-web]`, `if: inputs.run-web`

Top-level `permissions: {}`; each job declares its own `permissions: contents: read`
(matches the least-privilege pattern already used in `release.yml`).

Reusable workflows can't read the caller's `needs` context, which is why the path-filter
decision (previously `needs.changes.outputs.backend == 'true'`) is passed in as a
`with:` input rather than recomputed inside `validate.yml`.

### `ci.yml` changes

Replace the 7 inline jobs (`lint-go`, `gosec`, `test-go`, `build-go`, `typecheck-web`,
`lint-web`, `build-web`) with a single job:

```yaml
validate:
  needs: changes
  uses: ./.github/workflows/validate.yml
  with:
    run-backend: ${{ needs.changes.outputs.backend == 'true' }}
    run-web: ${{ needs.changes.outputs.web == 'true' }}
```

`changes`, `build-android`, `build-ios`, `build-desktop`, and `dependency-review` are
unchanged. `ci-success`'s `needs:` list and its status-check script collapse the 7
individual per-job checks into one `needs.validate.result` check (treating `success`
or `skipped` as passing, consistent with the existing pattern for other conditional
jobs in that script).

### `release.yml` changes

Add a new job:

```yaml
validate:
  permissions:
    contents: read
  uses: ./.github/workflows/validate.yml
  with:
    run-backend: true
    run-web: true
```

Add `needs: validate` to both `backend-image` and `web-image` (alongside their existing
per-job `permissions:` blocks). `binaries`, `onprem-bundle`, and `release` are
unchanged — the CodeRabbit finding was scoped to the two jobs that publish images to a
shared registry tag (`:latest`); the other jobs produce release-scoped artifacts that
don't overwrite a shared moving target.

## Testing / Verification

No live GitHub Actions runner is available in this environment, so verification is
limited to:

- `actionlint` (if available) for YAML/workflow-schema correctness.
- Manual trace of the `needs:`/`if:` dependency graph across all three files to confirm
  no cycles, no orphaned jobs, and correct skip-vs-fail semantics.

This cannot be substituted for an actual tag-push run. That should be confirmed by
watching the Actions run the next time a real `v*` tag is pushed.

## Out of Scope

- Gating `binaries` or `onprem-bundle` on `validate`.
- Any change to what the individual checks (lint/gosec/test/build) actually verify.
- Adding new checks beyond what `ci.yml` already runs for backend/web.
