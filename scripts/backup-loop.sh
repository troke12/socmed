#!/usr/bin/env bash
# Runs scripts/backup.sh once a day inside the socmed-backup tmux session.

set -euo pipefail
cd "$(dirname "$0")/.."

INTERVAL=$((24 * 60 * 60))  # 24h

log() { echo "[$(date -Iseconds)] [backup] $*"; }

while true; do
  log "starting nightly backup"
  if bash scripts/backup.sh; then
    log "backup done"
  else
    log "backup failed (exit $?)"
  fi
  sleep "$INTERVAL"
done
