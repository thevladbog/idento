#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Read the actual values the db container is running with (set via .env by
# docker compose) rather than re-parsing .env ourselves — .env may contain
# values (e.g. IDENTO_ORG_NAME with spaces, a comma-separated
# CORS_ALLOWED_ORIGINS) that compose's own parser accepts but `bash source`
# does not.
postgres_user="$(docker compose exec -T db printenv POSTGRES_USER < /dev/null)"
postgres_db="$(docker compose exec -T db printenv POSTGRES_DB < /dev/null)"
out="backup-$(date +%Y%m%d-%H%M%S).dump"

echo "Backing up ${postgres_db} to ${out}..."
docker compose exec -T db pg_dump -U "${postgres_user}" -Fc "${postgres_db}" > "${out}"
echo "Done: ${out} ($(du -h "${out}" | cut -f1))"
