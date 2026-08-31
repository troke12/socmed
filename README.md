# socmed

Self-hosted social media content management — draft, schedule, publish, monitor, and engage across 12 platforms (X, LinkedIn, Instagram, Facebook, Threads, TikTok, YouTube, Pinterest, Reddit, Mastodon, Bluesky, Discord) from a single Next.js dashboard with a self-hosted worker.

## First run — Setup Wizard

1. **Clone & install**
   ```bash
   git clone https://github.com/troke12/socmed
   cd socmed
   nvm use                 # node 24 (see .nvmrc)
   corepack enable
   pnpm install
   ```

2. **Configure `.env`**
   ```bash
   cp .env.example .env
   bash scripts/gen-master-key.sh
   # generates SOCMED_MASTER_KEY, SOCMED_COOKIE_SECRET, a random
   # SOCMED_ADMIN_PASSWORD, and SOCMED_ADMIN_TOKEN (for backups)
   ```

3. **Start the stack**
   ```bash
   bash scripts/tmux-up.sh
   ```
   This brings up `socmed-web` (Next.js on :3000), `socmed-worker` (queue + pollers), `socmed-caddy` (reverse proxy + TLS), and `socmed-health` (auto-restart dead sessions) — all via named tmux sessions.

4. **Open the Setup Wizard** at <https://localhost/setup>
   - The wizard checks required env vars and tells you which platforms are ready
   - Click "Generate keys" if you haven't already (this also sets a random admin password)
   - Set env vars for the platforms you want, then add an account on `/accounts`

5. **Sign in** at `/login` with `SOCMED_ADMIN_USERNAME` / `SOCMED_ADMIN_PASSWORD`. If you used `gen-master-key.sh`, the random password is printed once at generation time.

6. **Connect an account** on `/accounts`:
   - For OAuth platforms (X, LinkedIn, Meta, YouTube, Pinterest, Reddit): click Connect → authorize → callback creates the account
   - For bot/token platforms (Discord, Bluesky): click Add manually, paste the token, optionally list channel IDs
   - You can add multiple accounts per platform (each with a unique `label`)

7. **Compose your first post** on `/compose`

## Supported platforms (12)

| Platform | Auth flow | Multi-account | Notes |
|----------|-----------|---------------|-------|
| X (Twitter) | OAuth 2.0 PKCE | ✓ | Pay-per-use API pricing, no flat subscription tier; media uploads via the v2 chunked endpoint |
| LinkedIn | OAuth 2.0 | ✓ | Needs `w_member_social` scope; posts via `/rest/posts` (requires a `LinkedIn-Version` header) |
| Instagram | Instagram Login OAuth (`graph.instagram.com`) | ✓ | Business/Creator account required; distinct host/flow from Facebook's Meta Graph OAuth below; uses signed media URLs |
| Facebook Pages | Meta Graph OAuth (`graph.facebook.com`) | ✓ | One account per page |
| Threads | Threads API (`threads.net` / `graph.threads.net`) | ✓ | Separate host from the main Meta Graph API; app must be Live for write |
| TikTok | OAuth 2.0 PKCE | ✓ | Content Posting API requires app review (2-4 weeks); unaudited apps publish as private drafts to the creator's inbox, not the public profile |
| YouTube | Google OAuth 2.0 | ✓ | Resumable (chunked) upload; `videos.insert` has its own 100-uploads/day quota bucket, separate from the shared daily quota |
| Pinterest | OAuth 2.0 | ✓ | Pin images require public URLs (signed media URL is used) |
| Reddit | OAuth 2.0 | ✓ | Set subreddit in `instanceUrl` column; create the app as type "web app", not "script" |
| Mastodon | Per-instance OAuth | ✓ | Federated; set `instanceUrl` to your server (https-only) |
| Bluesky | App password (per account) | ✓ | AT Protocol; the account's real PDS is auto-resolved from its DID document (not assumed to be bsky.social) |
| Discord | Bot token (per account) | ✓ | One bot can post to many channels |

## Architecture

- **`app/`** — Next.js 15 (App Router) — UI + API routes + webhook ingress
- **`worker/`** — separate Node process — SQLite-backed job queue + 3 pollers
  - `scheduler.ts` — claims due jobs every 5s (publish, fetch metrics, post reply, schedule rules)
  - `cron.ts` — hourly tick that fires recurring `schedule_rules`
  - `pollers/analytics.ts` — every 15min, fetches metrics for published posts
  - `pollers/mentions.ts` — every 10min, fetches recent mentions per account
- **`data/`** — bind-mounted volume — SQLite DB + uploads + logs (gitignored)
- **`scripts/`** — tmux-up/down, healthcheck, backup, master key gen
- **`compose.yml`** + **`Caddyfile`** — for production VM deployment

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

`scripts/backup.sh` runs nightly via the `socmed-backup` tmux session. When `SOCMED_ADMIN_TOKEN` and `SOCMED_BASE_URL` are set it uses the in-process `/api/admin/backup` endpoint (WAL-safe via better-sqlite3's online backup API — safe even while the worker is running). Otherwise it falls back to a file copy (stop the worker first for a consistent snapshot). Default retention: 30 daily. Restore:

```bash
cp data/backups/app-YYYYMMDD.db data/app.db
tar -xzf data/backups/uploads-YYYYMMDD.tar.gz -C data/
```

### Rotating the master key

1. Generate a new key: `bash scripts/gen-master-key.sh` (it upserts in place)
2. Restart web + worker: `bash scripts/tmux-down.sh && bash scripts/tmux-up.sh`
3. All existing accounts are now unreadable. Re-add them via `/accounts`.

(The 0.1.0 plan called for a re-encryption script — M6 milestone; not yet implemented.)

### Webhooks

Webhook URLs use `?platform=`:
`https://your.domain/api/webhooks?platform=x`

Signature verification is required. HMAC-based platforms verify against the per-account `webhookSecret` (or `*_WEBHOOK_SECRET` env vars); Meta platforms verify `X-Hub-Signature-256`. Requests without a valid signature are rejected with 401.

### Logs

JSON-structured, level via `SOCMED_LOG_LEVEL=info|debug|warn|error`. Each session pipes to `data/logs/<service>.log`.

### Adding a new platform

1. Add the platform enum value to `app/lib/db/schema.ts` (run a migration to update CHECK)
2. Create `app/lib/platforms/<name>/{client,adapter,registry}.ts` implementing `PlatformAdapter`
3. Register in `app/lib/platforms/bootstrap.ts`
4. Add env vars to `.env.example` and `app/app/api/setup/route.ts`

### Local dev

```bash
pnpm dev          # Next.js + worker in parallel
pnpm test         # vitest unit tests
pnpm typecheck    # tsc --noEmit on both app + worker
pnpm lint         # ESLint (flat config) on both app + worker
pnpm build        # production build
```

## Security

Read `SECURITY.md` before deploying. Highlights:
- All platform API tokens encrypted at rest (AES-256-GCM, per-account key via HKDF)
- `.env` is gitignored — `bash scripts/gen-master-key.sh` writes secrets with mode 0600
- No real credentials in this repo — only placeholders in `.env.example`
- Bcrypt password hashing (cost 12), HMAC-SHA256 signed session cookies, WAL-mode SQLite
- Login rate limiting (5 attempts / 15 min per IP)
- Webhook signature verification on all platforms
- OAuth `state` cookie is `Secure` + validated; `next` redirects are allowlisted
- Containers run as non-root with dropped capabilities and resource limits

## Process model (tmux as supervisor)

`scripts/tmux-up.sh` creates five named tmux sessions: `socmed-web`, `socmed-worker`, `socmed-caddy`, `socmed-health` (auto-restart watcher) and `socmed-backup` (nightly backups). To inspect:
```bash
tmux ls
tmux attach -t socmed-worker
```

## Known limitations (post-M6)

- The `schedule_rules` cron currently schedules posts on an hourly cadence; real cron-expression evaluation is a later milestone. There's also no UI yet to create a schedule rule in the first place ([#2](https://github.com/troke12/socmed/issues/2)).
- Some platforms require app review (TikTok 2-4 weeks, Meta 1-3 weeks) or paid API access (X). The Setup Wizard tells you which env vars are missing per platform.
- Access tokens are not automatically refreshed before they expire — every platform adapter has a working `refresh()`, but nothing schedules it yet ([#1](https://github.com/troke12/socmed/issues/1)). A revoked/expired account just fails on next publish; re-add it on `/accounts`.
- No multi-user support — single admin account, single password gate ([#7](https://github.com/troke12/socmed/issues/7)).
- Compose can only create new posts — no way to edit an existing draft/scheduled post, and no cross-posting to multiple accounts in one action ([#3](https://github.com/troke12/socmed/issues/3), [#4](https://github.com/troke12/socmed/issues/4)).
- `next build` on Windows with Node 25+ hits a Next.js prerender bug (`/_global-error`). Use Node 22/24 (see `.nvmrc`) or the Docker images (Node 24, Linux) — the Docker path is the supported production deployment.
