#!/usr/bin/env bash
# One-shot: generate SOCMED_MASTER_KEY, SOCMED_COOKIE_SECRET, a random
# SOCMED_ADMIN_PASSWORD, and SOCMED_ADMIN_TOKEN (for the backup endpoint).
# Writes them into .env (creating it from .env.example if needed).

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

gen_urlsafe() {
  # 24 random bytes, URL-safe (no padding) — good for passwords/tokens
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
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
ADMIN_PW=$(gen_urlsafe)
ADMIN_TOKEN=$(gen_urlsafe)

upsert "$ROOT_ENV" SOCMED_MASTER_KEY "$MASTER"
upsert "$ROOT_ENV" SOCMED_COOKIE_SECRET "$COOKIE"
upsert "$ROOT_ENV" SOCMED_ADMIN_PASSWORD "$ADMIN_PW"
upsert "$ROOT_ENV" SOCMED_ADMIN_TOKEN "$ADMIN_TOKEN"
upsert "$APP_ENV"  SOCMED_MASTER_KEY "$MASTER"
upsert "$APP_ENV"  SOCMED_COOKIE_SECRET "$COOKIE"
upsert "$APP_ENV"  SOCMED_ADMIN_PASSWORD "$ADMIN_PW"
upsert "$APP_ENV"  SOCMED_ADMIN_TOKEN "$ADMIN_TOKEN"

chmod 600 "$ROOT_ENV" "$APP_ENV"
echo "Wrote SOCMED_MASTER_KEY, SOCMED_COOKIE_SECRET, SOCMED_ADMIN_PASSWORD and SOCMED_ADMIN_TOKEN to $ROOT_ENV and $APP_ENV (mode 0600)"
echo
echo "Admin login:"
echo "  username: $(grep -E '^SOCMED_ADMIN_USERNAME=' "$ROOT_ENV" | cut -d= -f2 || echo admin)"
echo "  password: $ADMIN_PW"
echo "Keep this password safe — it is not shown again."
