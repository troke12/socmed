#!/usr/bin/env bash
# Nightly backup. If SOCMED_BASE_URL is reachable and SOCMED_ADMIN_TOKEN is set,
# uses the in-process backup endpoint (WAL-safe even with worker running).
# Otherwise falls back to a file copy (NOT WAL-safe — stop the worker first).
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
    echo "backup: admin endpoint failed, falling back to file copy" >&2
    cp "$DB_SRC" "$DB_BACKUP"
    echo "backup: $DB_BACKUP (file copy)"
  fi
else
  # No admin token configured → plain file copy (good enough for most cases:
  # SQLite's WAL auto-checkpoints; just stop the worker for a clean snapshot)
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
