#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Idento on-prem installer — preflight checks"
echo

# 1. Docker + Compose v2
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed or not on PATH. Install Docker Engine first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' (the v2 plugin) is not available. The legacy standalone 'docker-compose' v1 binary is not supported — install the Compose v2 plugin: https://docs.docker.com/compose/install/" >&2
  exit 1
fi
echo "OK: Docker and Compose v2 are available."

# 2. Ports 80 and 8008 — best-effort, advisory only (some hosts lack lsof, and
# firewalls/binding differ), so this warns rather than fails.
if command -v lsof >/dev/null 2>&1; then
  for port in 80 8008; do
    if lsof -i ":${port}" >/dev/null 2>&1; then
      echo "WARNING: port ${port} appears to be in use already. 'docker compose up' may fail to bind it."
    fi
  done
else
  echo "NOTE: 'lsof' not found — skipping port-in-use check. docker compose up -d will fail loudly if a port is unavailable."
fi

# 3. Disk space — advisory floor of 5 GB on the current filesystem.
if command -v df >/dev/null 2>&1; then
  available_kb=$(df -Pk . | awk 'NR==2 {print $4}')
  if [ -n "${available_kb}" ] && [ "${available_kb}" -lt 5242880 ]; then
    echo "WARNING: less than 5 GB free on this filesystem. Postgres data and Docker images need room to grow."
  fi
fi

echo

# 4. Generate .env if it doesn't already exist. Idempotent: never overwrites.
if [ -f .env ]; then
  echo ".env already exists — leaving it untouched. Delete it first if you want install.sh to regenerate it."
  exit 0
fi

cp .env.example .env

jwt_secret=$(openssl rand -hex 32)
postgres_password=$(openssl rand -hex 32)

# BSD sed (macOS) requires a suffix argument to -i; GNU sed (Linux, the
# expected target for this installer) accepts -i '' as "no suffix" or -i
# with no argument. Using a temp-file suffix + delete keeps both happy.
sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=${jwt_secret}/" .env
sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${postgres_password}/" .env
rm -f .env.bak

echo "Created .env with a freshly generated JWT_SECRET and POSTGRES_PASSWORD."
echo
echo "Before starting, edit .env and set:"
echo "  IDENTO_ADMIN_EMAIL       (your own admin login)"
echo "  IDENTO_ADMIN_PASSWORD    (your own admin login)"
echo "  PUBLIC_API_URL           (the URL your browser will use to reach the backend)"
echo "  CORS_ALLOWED_ORIGINS     (must include the URL you'll open the web UI at)"
echo "  VERSION                  (optional — pin to the release tag you downloaded)"
echo
echo "Then run: docker compose up -d"
