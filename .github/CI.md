# CI/CD Documentation

This document describes the Continuous Integration and Continuous Deployment setup for the Idento project.

## Overview

The CI pipeline is optimized for pull requests with the following principles:

- **Fast feedback**: Critical checks run first, slow checks run conditionally
- **Efficient resource usage**: Path filtering prevents unnecessary jobs
- **Fail-fast**: Jobs have proper dependencies to stop early on failures
- **Security**: Automated dependency review and vulnerability scanning
- **Code quality**: Comprehensive linting, type checking, and test coverage

## Workflows

### Main CI Pipeline (`.github/workflows/ci.yml`)

Triggered on:
- Push to `main`/`master` branches
- Pull requests to `main`/`master` branches

**Features:**
- Automatic cancellation of outdated runs when new commits are pushed
- Path-based filtering to run only relevant jobs
- Parallel execution of independent jobs
- Job dependencies to ensure proper order
- GitHub summaries and annotations for results

**Jobs:**

1. **changes** - Detects which parts of the codebase changed
   - Outputs: `backend`, `web`, `mobile` flags

2. **validate** (calls the reusable workflow below)
   - Passes `run-backend`/`run-web` booleans computed from the `changes` job
   - Contains the lint/test/build sub-jobs described in the next section

3. **lint-android** (conditional: mobile changes)
   - Android lint checks
   - Non-blocking (won't fail entire pipeline)

4. **dependency-review** (PR only)
   - Reviews new dependencies for vulnerabilities
   - Comments on PR if issues found
   - Fails on moderate+ severity issues

5. **ci-success** (depends on all critical jobs)
   - Final status check
   - Required status check for PR merging

### Reusable Validate Workflow (`.github/workflows/validate.yml`)

The backend and web lint/test/build checks live in a separate reusable workflow, invoked via `workflow_call` rather than running directly inside `ci.yml`. It takes two boolean inputs, `run-backend` and `run-web`, that gate whether the backend or web jobs execute.

Callers:
- **`ci.yml`** - the `validate` job calls it with `run-backend`/`run-web` set from the `changes` job's path filters, so only affected areas run.
- **`release.yml`** - the `validate` job calls it with both inputs hardcoded to `true`, gating the GHCR image pushes (`backend-image`, `web-image`) behind a full validation pass.

Because these jobs run inside a called workflow, GitHub's UI prefixes each check with the caller job name, e.g. `validate / Lint Go (Backend & Agent)`, `validate / Test Go (Coverage & Race Detection)`. Keep this in mind when looking for a specific check in the PR checks list or branch protection settings.

Jobs inside `validate.yml`:

1. **lint-go** (conditional: `run-backend`)
   - Runs golangci-lint on backend and agent
   - Uses official action for better performance
   - Provides inline annotations

2. **gosec** (conditional: `run-backend`)
   - Runs the Gosec security scanner on backend and agent

3. **test-go** (depends on: lint-go; conditional: `run-backend`)
   - Runs Go tests with race detection
   - Generates coverage reports
   - Uploads coverage artifacts

4. **build-go** (depends on: test-go; conditional: `run-backend`)
   - Builds backend and agent binaries
   - Verifies compilation success

5. **typecheck-web** (conditional: `run-web`)
   - TypeScript type checking
   - Runs before other web checks

6. **lint-web** (conditional: `run-web`)
   - ESLint with annotations
   - Runs in parallel with typecheck-web

7. **build-web** (depends on: typecheck-web, lint-web; conditional: `run-web`)
   - Builds production web bundle
   - Uploads dist artifacts

## Local Development

Run the same checks locally:

```bash
# Lint Go code
make lint

# Run tests
make test

# Run tests with coverage (same as CI)
make test-coverage

# Build binaries
make build-backend
make build-agent

# Web type checking
cd web && npx tsc --noEmit

# Web lint
cd web && npm run lint

# Web build
cd web && npm run build

# Android lint
./scripts/lint-mobile.sh
```

## Performance

Typical execution times (job names below appear in the GitHub UI as `validate / <name>`):

- **Backend only changes**: ~3-4 minutes
  - lint-go: ~1-2 min
  - gosec: ~1 min (runs in parallel with lint-go)
  - test-go: ~1 min
  - build-go: ~30s

- **Web only changes**: ~2-3 minutes
  - typecheck-web: ~30s
  - lint-web: ~30s
  - build-web: ~1-2 min

- **Mobile changes**: +5-7 minutes (Android lint is slow)

- **Full pipeline** (all changes): ~8-10 minutes

## Coverage Reports

Coverage reports are generated for:
- Backend (`backend/coverage.out`)
- Agent (`agent/coverage.out`)

Reports are uploaded as artifacts and visible in GitHub Actions UI.

To view locally:
```bash
make test-coverage
# Or for HTML report:
cd backend && go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out
```

## Troubleshooting

The backend/web jobs below run inside the reusable `validate.yml` workflow, so they show up in the GitHub UI and branch protection checks list as `validate / <job name>` (e.g. `validate / Lint Go (Backend & Agent)`).

### Job failed: "lint-go"
- Check golangci-lint output in job logs
- Run locally: `cd backend && golangci-lint run ./internal/...`
- Fix issues and push again

### Job failed: "gosec"
- Check the Gosec findings in job logs
- Run locally: `cd backend && gosec ./...` (or `cd agent && gosec ./...`)
- Fix or annotate (`#nosec`) the flagged issue with justification

### Job failed: "test-go"
- Check test output and race detector warnings
- Run locally: `make test-coverage`
- Common issues: race conditions, nil pointers

### Job failed: "typecheck-web"
- TypeScript compilation errors
- Run locally: `cd web && npx tsc --noEmit`
- Fix type errors in reported files

### Job failed: "build-web"
- Check Vite build errors
- Run locally: `cd web && npm run build`
- Common issues: missing imports, type errors

### Job failed: "dependency-review"
- New dependency has known vulnerabilities
- Review the specific package and version
- Options: update to patched version, find alternative, or accept risk

## Required Status Checks

Configure these jobs as required status checks in GitHub repository settings:

- `ci-success` - This ensures all critical jobs pass

## Future Improvements

Possible enhancements (not implemented yet):
- CodeQL for advanced security scanning
- E2E tests when test suite is available
- Performance benchmarking
- Docker image building for releases
- Automated deployment pipelines
