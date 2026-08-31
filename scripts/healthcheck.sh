#!/usr/bin/env bash
# Restart any missing socmed-* tmux session.
# Called every 30s by the socmed-health session itself.

set -euo pipefail
cd "$(dirname "$0")/.."

REQUIRED=(socmed-web socmed-worker socmed-caddy socmed-backup)
EXISTING=$(tmux ls -F '#{session_name}' 2>/dev/null || true)

for s in "${REQUIRED[@]}"; do
  if ! grep -qx "$s" <<<"$EXISTING"; then
    echo "[healthcheck] restarting $s"
    case "$s" in
      socmed-web)    tmux new-session -d -s "$s" "docker compose up web    2>&1 | tee -a data/logs/web.log" ;;
      socmed-worker) tmux new-session -d -s "$s" "docker compose up worker 2>&1 | tee -a data/logs/worker.log" ;;
      socmed-caddy)  tmux new-session -d -s "$s" "docker compose up caddy  2>&1 | tee -a data/logs/caddy.log" ;;
      socmed-backup) tmux new-session -d -s "$s" "bash scripts/backup-loop.sh" ;;
    esac
  fi
done
