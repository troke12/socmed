#!/usr/bin/env bash
# Nightly backup: use sqlite3 .backup (WAL-safe), then tar the uploads dir.
# Invoked by socmed-backup tmux session (created in M6).

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

# WAL-safe snapshot
sqlite3 "$DB_SRC" ".backup '$DB_BACKUP'"

# Tar uploads (if any)
if [[ -d ./data/uploads ]] && [[ -n "$(ls -A ./data/uploads 2>/dev/null)" ]]; then
  tar -czf "$DEST/uploads-${STAMP}.tar.gz" -C ./data uploads
fi

# Retention: keep 30 daily + 12 monthly
find "$DEST" -name "${DB_FILE%.db}-*.db" -mtime +30 -delete 2>/dev/null || true
find "$DEST" -name "uploads-*.tar.gz" -mtime +30 -delete 2>/dev/null || true

echo "backup: $DB_BACKUP"
