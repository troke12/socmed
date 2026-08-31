#!/usr/bin/env bash
# Stop the socmed stack: kill tmux sessions and the underlying compose stack.

set -euo pipefail
cd "$(dirname "$0")/.."

for s in socmed-web socmed-worker socmed-caddy socmed-health; do
  tmux kill-session -t "$s" 2>/dev/null || true
done

docker compose down

echo "socmed stack down"
