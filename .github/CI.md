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

2. **lint-go** (conditional: backend changes)
   - Runs golangci-lint on backend and agent
   - Uses official action for better performance
   - Provides inline annotations

3. **test-go** (depends on: lint-go)
   - Runs Go tests with race detection
   - Generates coverage reports
   - Uploads coverage artifacts

4. **build-go** (depends on: test-go)
   - Builds backend and agent binaries
   - Verifies compilation success

5. **typecheck-web** (conditional: web changes)
   - TypeScript type checking
   - Runs before other web checks

6. **lint-web** (conditional: web changes)
   - ESLint with annotations
   - Runs in parallel with typecheck-web

7. **build-web** (depends on: typecheck-web, lint-web)
   - Builds production web bundle
   - Uploads dist artifacts

8. **lint-android** (conditional: mobile changes)
   - Android lint checks
   - Non-blocking (won't fail entire pipeline)

9. **dependency-review** (PR only)
   - Reviews new dependencies for vulnerabilities
   - Comments on PR if issues found
   - Fails on moderate+ severity issues

10. **ci-success** (depends on all critical jobs)
    - Final status check
    - Required status check for PR merging

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

Typical execution times:

- **Backend only changes**: ~3-4 minutes
  - lint-go: ~1-2 min
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

### Job failed: "lint-go"
- Check golangci-lint output in job logs
- Run locally: `cd backend && golangci-lint run ./internal/...`
- Fix issues and push again

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
