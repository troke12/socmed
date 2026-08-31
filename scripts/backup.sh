#!/usr/bin/env bash
# Nightly backup. Prefers the in-process /api/admin/backup endpoint
# (WAL-safe even with the worker running). Falls back to a file copy with a
# loud warning (NOT WAL-safe — stop the worker first for a clean snapshot).
# Default retention: 30 daily.

set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=./data/backups
mkdir -p "$DEST"

DB_SRC=${SOCMED_DB_PATH:-./data/app.db}
DB_FILE=$(basename "$DB_SRC")
DB_BACKUP="$DEST/${DB_FILE%.db}-${STAMP}.db"

if [[ ! -f "$DB_SRC" ]]; then
  echo "backup: $DB_SRC not found, skipping" >&2
  exit 1
fi

# Prefer the admin endpoint (WAL-safe via in-process backup API) if available
if [[ -n "${SOCMED_ADMIN_TOKEN:-}" ]] && [[ -n "${SOCMED_BASE_URL:-}" ]]; then
  if curl -s -f -H "Authorization: Bearer ${SOCMED_ADMIN_TOKEN}" \
       -o "${DB_BACKUP}.tmp" "${SOCMED_BASE_URL}/api/admin/backup" 2>/dev/null; then
    mv "${DB_BACKUP}.tmp" "$DB_BACKUP"
    echo "backup: $DB_BACKUP (via admin endpoint)"
  else
    rm -f "${DB_BACKUP}.tmp"
    echo "backup: admin endpoint failed, falling back to file copy (NOT WAL-safe)" >&2
    echo "backup: stop the worker for a consistent snapshot: docker compose stop worker" >&2
    cp "$DB_SRC" "$DB_BACKUP"
    echo "backup: $DB_BACKUP (file copy)"
  fi
else
  echo "backup: SOCMED_ADMIN_TOKEN not set — using file copy (NOT WAL-safe)" >&2
  echo "backup: set SOCMED_ADMIN_TOKEN and run gen-master-key.sh for WAL-safe backups" >&2
  cp "$DB_SRC" "$DB_BACKUP"
  echo "backup: $DB_BACKUP (file copy)"
fi

# Tar uploads (if any)
if [[ -d ./data/uploads ]] && [[ -n "$(ls -A ./data/uploads 2>/dev/null)" ]]; then
  tar -czf "$DEST/uploads-${STAMP}.tar.gz" -C ./data uploads
fi

# Retention: 30 daily
find "$DEST" -name "${DB_FILE%.db}-*.db" -mtime +30 -delete 2>/dev/null || true
find "$DEST" -name "uploads-*.tar.gz" -mtime +30 -delete 2>/dev/null || true
