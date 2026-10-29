#!/usr/bin/env bash
# Apply numbered migrations in order. Requires psql and DATABASE_URL.
# Usage: DATABASE_URL=postgres://... bash scripts/run-migrations.sh
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. See infrastructure/docker/.env.example" >&2
  exit 1
fi
for f in apps/api/migrations/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "Migrations applied. Tables are empty by design — dev seeds are a separate, opt-in step in Phase 3+."
