#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

postgres_user="${POSTGRES_USER:-idento}"
postgres_db="${POSTGRES_DB:-idento_db}"
out="backup-$(date +%Y%m%d-%H%M%S).dump"

echo "Backing up ${postgres_db} to ${out}..."
docker compose exec -T db pg_dump -U "${postgres_user}" -Fc "${postgres_db}" > "${out}"
echo "Done: ${out} ($(du -h "${out}" | cut -f1))"
