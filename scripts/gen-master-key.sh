#!/usr/bin/env bash
# One-shot: generate SOCMED_MASTER_KEY and SOCMED_COOKIE_SECRET,
# write them into .env (creating it from .env.example if needed).

set -euo pipefail
cd "$(dirname "$0")/.."

# .env lives at both the workspace root (for compose/Caddy) and inside app/
# (where Next.js dev reads it). Keep them in sync.
ROOT_ENV=.env
APP_ENV=app/.env

[[ -f $ROOT_ENV ]] || cp .env.example "$ROOT_ENV"
[[ -f $APP_ENV ]] || cp .env.example "$APP_ENV"

gen() {
  openssl rand -base64 32
}

upsert() {
  local file="$1" key="$2" val="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "$file.bak"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

MASTER=$(gen)
COOKIE=$(gen)

upsert "$ROOT_ENV" SOCMED_MASTER_KEY "$MASTER"
upsert "$ROOT_ENV" SOCMED_COOKIE_SECRET "$COOKIE"
upsert "$APP_ENV"  SOCMED_MASTER_KEY "$MASTER"
upsert "$APP_ENV"  SOCMED_COOKIE_SECRET "$COOKIE"

chmod 600 "$ROOT_ENV" "$APP_ENV"
echo "Wrote SOCMED_MASTER_KEY and SOCMED_COOKIE_SECRET to $ROOT_ENV and $APP_ENV (mode 0600)"
