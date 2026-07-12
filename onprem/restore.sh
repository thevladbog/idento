#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup-file.dump>" >&2
  exit 1
fi

dump_file="$1"
if [ ! -f "${dump_file}" ]; then
  echo "ERROR: ${dump_file} not found." >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

postgres_user="${POSTGRES_USER:-idento}"
postgres_db="${POSTGRES_DB:-idento_db}"

echo "This will REPLACE all data in the '${postgres_db}' database with the contents of ${dump_file}."
read -r -p "Type 'restore' to confirm: " confirmation
if [ "${confirmation}" != "restore" ]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring ${dump_file} into ${postgres_db}..."
docker compose exec -T db pg_restore -U "${postgres_user}" -d "${postgres_db}" --clean --if-exists < "${dump_file}"
echo "Done."
