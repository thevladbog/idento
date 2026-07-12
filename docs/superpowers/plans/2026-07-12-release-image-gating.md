# Release Image Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `release.yml`'s `backend-image` and `web-image` jobs on the same lint/security/test/build checks that gate a merge to `main`, so a broken image can never be published to GHCR (including `:latest`) from a tag push.

**Architecture:** Extract the backend/web validation jobs currently inlined in `ci.yml` into a new reusable workflow (`workflow_call`) at `.github/workflows/validate.yml`. `ci.yml` and `release.yml` both invoke it. `ci.yml` passes path-filter results as inputs (preserving today's skip-when-unrelated behavior); `release.yml` always runs both check sets (a tag push has no diff to filter on).

**Tech Stack:** GitHub Actions YAML, `actionlint` for schema/syntax verification.

## Global Constraints

- No change to what any individual check (lint-go, gosec, test-go, build-go, typecheck-web, lint-web, build-web) actually runs — steps are moved verbatim, not rewritten.
- `binaries`, `onprem-bundle`, and `release` jobs in `release.yml` are out of scope — do not add `needs: validate` to them.
- Least-privilege permissions: workflow-level `permissions: {}` in `validate.yml`, with `contents: read` declared per-job.
- No live GitHub Actions runner is available in this environment. Verification is `actionlint` plus manual trace of the `needs:`/`if:` graph — do not claim a tag-push run was tested live.

---

### Task 1: Create the reusable `validate.yml` workflow

**Files:**
- Create: `.github/workflows/validate.yml`
- Modify (reference only, no edits yet): `.github/workflows/ci.yml` (source of the jobs being moved)

**Interfaces:**
- Produces: a `workflow_call`-triggered workflow with inputs `run-backend` (boolean, default `true`) and `run-web` (boolean, default `true`), and jobs `lint-go`, `gosec`, `test-go`, `build-go`, `typecheck-web`, `lint-web`, `build-web` — these exact job names are relied on by Task 2 and Task 3's `needs:`/status-check references.

- [ ] **Step 1: Write `validate.yml`**

Create `.github/workflows/validate.yml` with this content:

```yaml
name: Validate

on:
  workflow_call:
    inputs:
      run-backend:
        type: boolean
        default: true
      run-web:
        type: boolean
        default: true

permissions: {}

jobs:
  # Lint Go code (backend + agent)
  lint-go:
    name: Lint Go (Backend & Agent)
    runs-on: ubuntu-latest
    if: inputs.run-backend
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
          cache: true
          cache-dependency-path: |
            backend/go.sum
            agent/go.sum

      # Use official golangci-lint action for better performance and caching
      - name: Lint backend
        uses: golangci/golangci-lint-action@v9
        with:
          version: v2.12
          working-directory: backend
          args: ./internal/...

      - name: Lint agent
        uses: golangci/golangci-lint-action@v9
        with:
          version: v2.12
          working-directory: agent
          args: ./...

      - name: Summary
        if: always()
        run: |
          echo "## Go Lint Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Backend and Agent linting completed" >> $GITHUB_STEP_SUMMARY

  # Gosec security scanner (backend + agent)
  gosec:
    name: Gosec Security (Backend & Agent)
    runs-on: ubuntu-latest
    if: inputs.run-backend
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
          cache: true
          cache-dependency-path: |
            backend/go.sum
            agent/go.sum
      - name: Install gosec
        run: go install github.com/securego/gosec/v2/cmd/gosec@latest
      - name: Run Gosec (backend)
        run: gosec ./...
        working-directory: backend
      - name: Run Gosec (agent)
        run: gosec ./...
        working-directory: agent
      - name: Summary
        if: always()
        run: |
          echo "## Gosec Security Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Backend and Agent security scan completed" >> $GITHUB_STEP_SUMMARY

  # Test Go code with coverage and race detection
  test-go:
    name: Test Go (Coverage & Race Detection)
    runs-on: ubuntu-latest
    needs: lint-go
    if: inputs.run-backend
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
          cache: true
          cache-dependency-path: |
            backend/go.sum
            agent/go.sum

      - name: Test backend with coverage
        run: |
          cd backend
          go test -race -coverprofile=coverage.out -covermode=atomic ./...
          go tool cover -func=coverage.out

      - name: Test agent with coverage
        run: |
          cd agent
          go test -race -coverprofile=coverage.out -covermode=atomic ./...
          go tool cover -func=coverage.out

      - name: Upload backend coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: backend-coverage
          path: backend/coverage.out
          retention-days: 7

      - name: Upload agent coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: agent-coverage
          path: agent/coverage.out
          retention-days: 7

      - name: Summary
        if: always()
        run: |
          echo "## Go Test Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Tests completed with race detection" >> $GITHUB_STEP_SUMMARY
          if [ -f backend/coverage.out ]; then
            echo "### Backend Coverage" >> $GITHUB_STEP_SUMMARY
            go tool cover -func=backend/coverage.out | tail -1 >> $GITHUB_STEP_SUMMARY
          fi
          if [ -f agent/coverage.out ]; then
            echo "### Agent Coverage" >> $GITHUB_STEP_SUMMARY
            go tool cover -func=agent/coverage.out | tail -1 >> $GITHUB_STEP_SUMMARY
          fi

  # Build Go binaries
  build-go:
    name: Build Go (Backend & Agent)
    runs-on: ubuntu-latest
    needs: test-go
    if: inputs.run-backend
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.25"
          cache: true
          cache-dependency-path: |
            backend/go.sum
            agent/go.sum

      - name: Build backend
        run: cd backend && go build -v -o /tmp/idento-backend .

      - name: Build agent
        run: cd agent && go build -v -o /tmp/idento-agent .

      - name: Summary
        run: |
          echo "## Go Build Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Backend and Agent built successfully" >> $GITHUB_STEP_SUMMARY
          ls -lh /tmp/idento-* >> $GITHUB_STEP_SUMMARY

  # TypeScript type checking
  typecheck-web:
    name: TypeScript Type Check
    runs-on: ubuntu-latest
    if: inputs.run-web
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        run: cd web && npm ci

      - name: Type check
        run: cd web && npx tsc --noEmit

      - name: Summary
        if: always()
        run: |
          echo "## TypeScript Type Check Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Type checking completed" >> $GITHUB_STEP_SUMMARY

  # Lint web (ESLint)
  lint-web:
    name: Lint Web (ESLint)
    runs-on: ubuntu-latest
    if: inputs.run-web
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        run: cd web && npm ci

      - name: Lint with annotations
        run: cd web && npm run lint

      - name: Summary
        if: always()
        run: |
          echo "## ESLint Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Web linting completed" >> $GITHUB_STEP_SUMMARY

  # Build web
  build-web:
    name: Build Web
    runs-on: ubuntu-latest
    needs: [typecheck-web, lint-web]
    if: inputs.run-web
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        run: cd web && npm ci

      - name: Build
        run: cd web && npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: web-dist
          path: web/dist
          retention-days: 7

      - name: Summary
        run: |
          echo "## Web Build Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Web built successfully" >> $GITHUB_STEP_SUMMARY
          du -sh web/dist >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 2: Verify syntax with actionlint**

Run: `actionlint .github/workflows/validate.yml`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/validate.yml
git commit -m "ci: extract backend/web validation into reusable workflow"
```

---

### Task 2: Wire `ci.yml` to call `validate.yml`

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `validate.yml`'s `workflow_call` inputs `run-backend`/`run-web` and its job names (Task 1).
- Produces: `ci.yml` job `validate` (a single `uses:` job) that `ci-success` depends on instead of the 7 removed jobs.

- [ ] **Step 1: Replace the 7 inline jobs with a single `validate` job**

In `.github/workflows/ci.yml`, delete the `lint-go`, `gosec`, `test-go`, `build-go`, `typecheck-web`, `lint-web`, and `build-web` job blocks (lines 47–282 in the current file — from `# Lint Go code (backend + agent)` through the end of `build-web`), and replace them with:

```yaml
  # Backend + web validation (lint, security scan, test, build)
  validate:
    needs: changes
    uses: ./.github/workflows/validate.yml
    with:
      run-backend: ${{ needs.changes.outputs.backend == 'true' }}
      run-web: ${{ needs.changes.outputs.web == 'true' }}
```

Place it where `lint-go` used to start, immediately after the `changes` job.

- [ ] **Step 2: Update `ci-success`'s `needs:` list and status-check script**

Replace:

```yaml
  ci-success:
    name: CI Success
    runs-on: ubuntu-latest
    needs: [lint-go, test-go, build-go, gosec, typecheck-web, lint-web, build-web, build-android, build-ios, build-desktop, dependency-review]
    if: always()
    steps:
      - name: Check job statuses
        run: |
          # This job succeeds only if all needed jobs succeeded or were skipped
          if [[ "${{ needs.lint-go.result }}" != "success" && "${{ needs.lint-go.result }}" != "skipped" ]]; then
            echo "lint-go failed"
            exit 1
          fi
          if [[ "${{ needs.test-go.result }}" != "success" && "${{ needs.test-go.result }}" != "skipped" ]]; then
            echo "test-go failed"
            exit 1
          fi
          if [[ "${{ needs.build-go.result }}" != "success" && "${{ needs.build-go.result }}" != "skipped" ]]; then
            echo "build-go failed"
            exit 1
          fi
          if [[ "${{ needs.gosec.result }}" != "success" && "${{ needs.gosec.result }}" != "skipped" ]]; then
            echo "gosec failed"
            exit 1
          fi
          if [[ "${{ needs.typecheck-web.result }}" != "success" && "${{ needs.typecheck-web.result }}" != "skipped" ]]; then
            echo "typecheck-web failed"
            exit 1
          fi
          if [[ "${{ needs.lint-web.result }}" != "success" && "${{ needs.lint-web.result }}" != "skipped" ]]; then
            echo "lint-web failed"
            exit 1
          fi
          if [[ "${{ needs.build-web.result }}" != "success" && "${{ needs.build-web.result }}" != "skipped" ]]; then
            echo "build-web failed"
            exit 1
          fi
          if [[ "${{ needs.build-desktop.result }}" != "success" && "${{ needs.build-desktop.result }}" != "skipped" ]]; then
            echo "build-desktop failed"
            exit 1
          fi
          if [[ "${{ needs.build-android.result }}" != "success" && "${{ needs.build-android.result }}" != "skipped" ]]; then
            echo "build-android failed"
            exit 1
          fi
          if [[ "${{ needs.build-ios.result }}" != "success" && "${{ needs.build-ios.result }}" != "skipped" ]]; then
            echo "build-ios failed"
            exit 1
          fi
          if [[ "${{ needs.dependency-review.result }}" != "success" && "${{ needs.dependency-review.result }}" != "skipped" ]]; then
            echo "dependency-review failed"
            exit 1
          fi
          echo "✅ All critical jobs passed!"
```

with:

```yaml
  ci-success:
    name: CI Success
    runs-on: ubuntu-latest
    needs: [validate, build-android, build-ios, build-desktop, dependency-review]
    if: always()
    steps:
      - name: Check job statuses
        run: |
          # This job succeeds only if all needed jobs succeeded or were skipped
          if [[ "${{ needs.validate.result }}" != "success" && "${{ needs.validate.result }}" != "skipped" ]]; then
            echo "validate failed"
            exit 1
          fi
          if [[ "${{ needs.build-desktop.result }}" != "success" && "${{ needs.build-desktop.result }}" != "skipped" ]]; then
            echo "build-desktop failed"
            exit 1
          fi
          if [[ "${{ needs.build-android.result }}" != "success" && "${{ needs.build-android.result }}" != "skipped" ]]; then
            echo "build-android failed"
            exit 1
          fi
          if [[ "${{ needs.build-ios.result }}" != "success" && "${{ needs.build-ios.result }}" != "skipped" ]]; then
            echo "build-ios failed"
            exit 1
          fi
          if [[ "${{ needs.dependency-review.result }}" != "success" && "${{ needs.dependency-review.result }}" != "skipped" ]]; then
            echo "dependency-review failed"
            exit 1
          fi
          echo "✅ All critical jobs passed!"
```

- [ ] **Step 3: Verify syntax with actionlint**

Run: `actionlint .github/workflows/ci.yml`
Expected: no output, exit code 0.

- [ ] **Step 4: Manually trace the dependency graph**

Confirm: `changes` → `validate` → `ci-success`; `validate`'s internal jobs (`lint-go`→`test-go`→`build-go`, `typecheck-web`+`lint-web`→`build-web`) live inside `validate.yml` and are invisible to `ci.yml`'s own `needs:` graph (only the single `validate` job is). Confirm no job in `ci.yml` still references the 7 removed job names.

Run: `grep -nE 'needs:.*(lint-go|gosec|test-go|build-go|typecheck-web|lint-web|build-web)' .github/workflows/ci.yml`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: call reusable validate workflow instead of inline jobs"
```

---

### Task 3: Gate `release.yml`'s image jobs on `validate.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `validate.yml`'s `workflow_call` interface (Task 1) — invoked with both inputs hardcoded `true` since a tag push has no diff to filter on.
- Produces: `backend-image` and `web-image` jobs each gain `needs: validate`, so GHCR pushes cannot happen unless `validate` succeeds.

- [ ] **Step 1: Add the `validate` job**

In `.github/workflows/release.yml`, immediately after the `permissions: {}` line and before the `jobs:` block's `backend-image:` entry, add:

```yaml
  validate:
    permissions:
      contents: read
    uses: ./.github/workflows/validate.yml
    with:
      run-backend: true
      run-web: true
```

- [ ] **Step 2: Add `needs: validate` to `backend-image`**

Change:

```yaml
  backend-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
```

to:

```yaml
  backend-image:
    needs: validate
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
```

- [ ] **Step 3: Add `needs: validate` to `web-image`**

Change:

```yaml
  web-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
```

to:

```yaml
  web-image:
    needs: validate
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
```

- [ ] **Step 4: Verify syntax with actionlint**

Run: `actionlint .github/workflows/release.yml`
Expected: no output, exit code 0.

- [ ] **Step 5: Manually confirm scope**

Run: `grep -n "needs:" .github/workflows/release.yml`
Expected output includes `needs: validate` for `backend-image` and `web-image`, and `needs: [backend-image, web-image, binaries, onprem-bundle]` for `release` (unchanged). `binaries` and `onprem-bundle` job definitions must NOT have gained a `needs: validate` line.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: gate release image pushes on validate workflow"
```

---

### Task 4: Full-repo verification pass

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: all three workflow files from Tasks 1–3.

- [ ] **Step 1: Run actionlint across all workflows**

Run: `actionlint .github/workflows/*.yml`
Expected: no output, exit code 0.

- [ ] **Step 2: Confirm no orphaned references to the old job names anywhere in the repo**

Run: `grep -rnE "needs:.*(lint-go|gosec|test-go|build-go|typecheck-web|lint-web|build-web)" .github/`
Expected: no matches outside `validate.yml` itself (where `test-go` needs `lint-go`, `build-go` needs `test-go`, and `build-web` needs `typecheck-web`/`lint-web` — all internal to that file, which is correct).

- [ ] **Step 3: Diff review**

Run: `git log --oneline -4` and `git diff main...HEAD --stat`
Expected: 3 commits from Tasks 1–3, touching exactly `.github/workflows/validate.yml` (new), `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

- [ ] **Step 4: Note the live-run limitation**

No step in this plan exercises an actual tag push through GitHub Actions. Record in the PR description (when this branch is opened as a PR) that the gating behavior should be watched on the next real `v*` tag push, since this environment cannot simulate a live Actions run.
