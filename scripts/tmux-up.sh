#!/usr/bin/env bash
# Boot the socmed stack: build images, then run each compose service
# inside its own named tmux session. Tmux (not compose) supervises thereafter.

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data/logs data/uploads data/backups

# Build images first so cold start is fast.
docker compose build

SESSIONS=(socmed-web socmed-worker socmed-caddy socmed-health)

for s in "${SESSIONS[@]}"; do
  tmux kill-session -t "$s" 2>/dev/null || true
done

tmux new-session -d -s socmed-web \
  "docker compose up web 2>&1 | tee -a data/logs/web.log"

tmux new-session -d -s socmed-worker \
  "docker compose up worker 2>&1 | tee -a data/logs/worker.log"

tmux new-session -d -s socmed-caddy \
  "docker compose up caddy 2>&1 | tee -a data/logs/caddy.log"

tmux new-session -d -s socmed-health \
  "while true; do bash scripts/healthcheck.sh; sleep 30; done"

# Nightly backup session
tmux new-session -d -s socmed-backup "bash scripts/backup-loop.sh"

echo "socmed stack up — sessions: $(tmux ls 2>/dev/null | wc -l)"
tmux ls
