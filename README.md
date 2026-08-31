# socmed

Self-hosted social media content management — draft, schedule, publish, monitor, and engage across 12 platforms (X, LinkedIn, Instagram, Facebook, Threads, TikTok, YouTube, Pinterest, Reddit, Mastodon, Bluesky, Discord) from a single Next.js dashboard with a self-hosted worker.

## First run — Setup Wizard

1. **Clone & install**
   ```bash
   git clone https://github.com/troke12/socmed
   cd socmed
   nvm use                 # node 22
   corepack enable
   pnpm install
   ```

2. **Configure `.env`**
   ```bash
   cp .env.example .env
   bash scripts/gen-master-key.sh   # writes SOCMED_MASTER_KEY + SOCMED_COOKIE_SECRET
   ```

3. **Start the stack**
   ```bash
   bash scripts/tmux-up.sh
   ```
   This brings up `socmed-web` (Next.js on :3000), `socmed-worker` (queue + pollers), `socmed-caddy` (reverse proxy + TLS), and `socmed-health` (auto-restart dead sessions) — all via named tmux sessions per the project taste config.

4. **Open the Setup Wizard** at <https://localhost/setup>
   - The wizard checks required env vars and tells you which platforms are ready
   - Click "Generate master keys" if you haven't already
   - Set env vars for the platforms you want, then add an account on `/accounts`

5. **Sign in** at `/login` with `SOCMED_ADMIN_USERNAME` / `SOCMED_ADMIN_PASSWORD` (default: `admin` / `changeme` — change this!)

6. **Connect an account** on `/accounts`:
   - For OAuth platforms (X, LinkedIn, Meta, YouTube, Pinterest, Reddit): click Connect → authorize → callback creates the account
   - For bot/token platforms (Discord, Bluesky): click Add manually, paste the token, optionally list channel IDs
   - You can add multiple accounts per platform (each with a unique `label`)

7. **Compose your first post** on `/compose`

## Supported platforms (12)

| Platform | Auth flow | Multi-account | Notes |
|----------|-----------|---------------|-------|
| X (Twitter) | OAuth 2.0 PKCE | ✓ | Requires X API Basic ($100/mo) for write |
| LinkedIn | OAuth 2.0 | ✓ | Needs `w_member_social` scope |
| Instagram | Meta Graph OAuth | ✓ | Business/Creator account required |
| Facebook Pages | Meta Graph OAuth | ✓ | One account per page |
| Threads | Meta Graph OAuth | ✓ | App must be Live for write |
| TikTok | OAuth 2.0 PKCE | ✓ | Content Posting API requires app review (2-4 weeks) |
| YouTube | Google OAuth 2.0 | ✓ | Resumable upload, ~6 videos/day quota |
| Pinterest | OAuth 2.0 | ✓ | Pin images require public URLs |
| Reddit | OAuth 2.0 | ✓ | Set subreddit in `instanceUrl` column |
| Mastodon | Per-instance OAuth | ✓ | Federated; set `instanceUrl` to your server |
| Bluesky | App password (per account) | ✓ | AT Protocol; set PDS via env or per-account |
| Discord | Bot token (per account) | ✓ | One bot can post to many channels |

## Architecture

- **`app/`** — Next.js 14 (App Router) — UI + API routes + webhook ingress
- **`worker/`** — separate Node process — SQLite-backed job queue + 3 pollers
  - `scheduler.ts` — claims due jobs every 5s (publish, fetch metrics, post reply)
  - `cron.ts` — hourly tick that fires recurring `schedule_rules`
  - `pollers/analytics.ts` — every 15min, fetches metrics for published posts
  - `pollers/mentions.ts` — every 10min, fetches recent mentions per account
- **`data/`** — bind-mounted volume — SQLite DB + uploads + logs (gitignored)
- **`scripts/`** — tmux-up/down, healthcheck, backup, master key gen
- **`compose.yml`** + **`Caddyfile`** — for production VM deployment

See `/home/ochi/.commandcode/plans/social-media-content-manager.md` for the full plan.

## Operations runbook

### Daily use

```bash
# Start everything
bash scripts/tmux-up.sh

# List sessions
tmux ls
#   socmed-web       (Next.js on :3000)
#   socmed-worker    (queue + pollers)
#   socmed-caddy     (reverse proxy + TLS)
#   socmed-health    (auto-restart watcher)
#   socmed-backup    (nightly .backup + tar)

# Watch worker logs live
tmux attach -t socmed-worker

# Stop everything
bash scripts/tmux-down.sh
```

### Health check

```bash
curl https://localhost/api/health
# → { ok: true, db: { ok: true }, queue: { pending, running, done, failed, dead } }
```

### Backups

`scripts/backup.sh` runs nightly via the `socmed-backup` tmux session. Uses `sqlite3 .backup` (WAL-safe) + tar of `data/uploads/`. Default retention: 30 daily. Restore:

```bash
cp data/backups/app-YYYYMMDD.db data/app.db
tar -xzf data/backups/uploads-YYYYMMDD.tar.gz -C data/
```

### Rotating the master key

1. Generate a new key: `bash scripts/gen-master-key.sh` (it upserts in place)
2. Restart web + worker: `bash scripts/tmux-down.sh && bash scripts/tmux-up.sh`
3. All existing accounts are now unreadable. Re-add them via `/accounts`.

(The 0.1.0 plan called for a re-encryption script — M6 milestone; not yet implemented.)

### Logs

JSON-structured, level via `SOCMED_LOG_LEVEL=info|debug|warn|error`. Each session pipes to `data/logs/<service>.log`.

### Adding a new platform

1. Add the platform enum value to `app/lib/db/schema.ts` (run a migration to update CHECK)
2. Create `app/lib/platforms/<name>/{client,adapter,limits,registry}.ts` implementing `PlatformAdapter`
3. Register in `app/lib/platforms/bootstrap.ts`
4. Add env vars to `.env.example` and `app/app/api/setup/route.ts`
5. Add a platform-specific limits doc to the README

### Local dev

```bash
pnpm dev          # Next.js + worker in parallel (tsc watch)
pnpm test         # vitest (21 unit tests, app-side)
pnpm typecheck    # tsc --noEmit on both app + worker
pnpm build        # production build
```

## Known limitations (post-M6)

- **`next dev` (the development server) has bugs on Node 24** — Tailwind CSS processing fails with "Module parse failed: Unexpected character '@'". Use `pnpm build && pnpm start` (or the production Docker image) for actual work. Dev mode works fine on Node 20/22.
- Dynamic `[param]` route segments fail to register in `next dev` on Node 24 — we work around by using `?platform=` query params for webhooks and `action` dispatch in POST for everything else.
- Each platform's OAuth callback URL must be set in that platform's developer console to `https://<your-domain>/api/accounts/oauth/callback/<platform>`.
- Some platforms require app review (TikTok 2-4 weeks, Meta 1-3 weeks, X Basic tier $100/mo). The Setup Wizard tells you which env vars are missing per platform.
- No multi-user support — single admin account, single password gate.
- Backup uses file copy (not SQLite online backup) to avoid dev-server locking — production deployments should `docker compose stop worker` before backup, or migrate to a Node-based backup script that calls better-sqlite3's backup API from the same process as the worker.


## Security

Read `SECURITY.md` before deploying. Highlights:
- All platform API tokens encrypted at rest (AES-256-GCM, per-account key via HKDF)
- `.env` is gitignored — `bash scripts/gen-master-key.sh` writes `SOCMED_MASTER_KEY` and `SOCMED_COOKIE_SECRET` with mode 0600
- No real credentials in this repo — only placeholders in `.env.example`
- Bcrypt password hashing, HMAC-SHA256 signed session cookies, WAL-mode SQLite

## Process model (tmux as supervisor)

`scripts/tmux-up.sh` creates four named tmux sessions: `socmed-web`, `socmed-worker`, `socmed-caddy`, `socmed-health` (auto-restart watcher). To inspect:
```bash
tmux ls
tmux attach -t socmed-worker
```

## Backup

`scripts/backup.sh` uses `sqlite3 .backup` (WAL-safe) + tar of uploads. Default retention: 30 daily + 12 monthly. Set up a cron job or run it manually.

## Development

```bash
pnpm dev          # Next.js + worker in parallel
pnpm test         # vitest (unit)
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
```
