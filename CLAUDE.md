# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a pnpm workspace with two packages: `app` (Next.js 15, App Router) and `worker` (a standalone Node process). Root scripts fan out to both via `pnpm -r`.

```bash
pnpm install          # install once, from repo root
pnpm dev              # next dev + worker (tsx watch), both in parallel
pnpm build            # production build of both packages
pnpm typecheck        # tsc --noEmit, app + worker
pnpm lint             # ESLint (flat config), app + worker
pnpm test             # vitest run, app + worker
```

Run a command against a single package with `--filter`, e.g. `pnpm --filter app typecheck`. Node must be 22 or 24 (see `.nvmrc`) — **`next build` fails on Windows with Node 25+** (a Next.js prerender bug on `/_global-error`); use Docker (Node 24, Linux) if you're on Windows, that's the supported production path anyway.

Run a single test file directly with vitest from inside `app/` (tests live in `app/tests/unit/`):

```bash
cd app && npx vitest run tests/unit/crypto.test.ts
```

### Local stack (Docker / tmux)

```bash
docker compose build && docker compose up -d   # web + worker, Caddy reverse proxy in front
bash scripts/tmux-up.sh                         # or: dev-machine supervisor (5 named tmux sessions)
tmux ls                                         # socmed-web, socmed-worker, socmed-caddy, socmed-health, socmed-backup
curl https://localhost/api/health               # { ok, db, queue: {pending,running,done,failed,dead} }
```

`.env` is required (`cp .env.example .env`, then `bash scripts/gen-master-key.sh` to generate `SOCMED_MASTER_KEY`/`SOCMED_COOKIE_SECRET`/admin password/`SOCMED_ADMIN_TOKEN`). After changing platform env vars, the containers need a rebuild+restart to pick them up — a plain restart of an already-built image will not see new `.env` values baked at build time for the `app` image (check `app/Dockerfile` build args before assuming a restart is enough).

## Architecture

**Two-process split.** `app/` (Next.js, port 3000) serves the UI, all `/api/*` routes, and OAuth/webhook ingress. `worker/` is a separate long-running Node process with no HTTP server — it owns a SQLite-backed job queue and three always-on pollers (`worker/src/scheduler.ts` claims queued jobs every 5s; `worker/src/cron.ts` ticks hourly for recurring schedules; `worker/src/pollers/{analytics,mentions}.ts` poll every 15/10 min). Both processes open the *same* SQLite file (`data/app.db`, WAL mode) — the worker imports the app's Drizzle schema directly via a relative path (`worker/src/db.ts` → `app/lib/db/schema.ts`), so schema changes in one place apply to both without duplication. There is no queue library — `jobs` is a plain table; `lib/queue/handlers.ts` is the single dispatch switch (`publish_post`, `fetch_metrics`, `post_comment`, `schedule_rule` — see "Known limitations" in README before assuming `schedule_rules`/cron-expression scheduling or token-refresh jobs are fully wired up, some of this is intentionally partial per the project's milestone plan).

**Platform adapter pattern** (`app/lib/platforms/`). Each of the 12 platforms is a subfolder with three files: `client.ts` (raw fetch calls to that platform's actual API — no framework code), `adapter.ts` (implements the shared `PlatformAdapter` interface from `types.ts`: `publishPost`, `deletePost`, `fetchPostMetrics`, `fetchMentions`, `fetchComments`, `postCommentReply`, `verifyWebhookSignature`, `parseWebhookEvent`, optional `beginOAuth`/`completeOAuth`/`refresh`), and `registry.ts` (calls `registerAdapter` into the shared `lib/platforms/registry.ts` map). `bootstrap.ts` side-effect-imports every platform's `registry.ts` so the map is populated before `getAdapter(platform)` is ever called — anywhere that calls `getAdapter` must `import "@platforms/bootstrap"` first (see the OAuth routes for the pattern). Adding a 13th platform means adding this same three-file shape, registering it in `bootstrap.ts`, adding the platform to the `accounts.platform` enum in `schema.ts`, and adding a setup check + guide in `app/api/setup/route.ts`.

Auth flows are not uniform across platforms: most use the generic `app/api/accounts/oauth/{start,callback/[platform]}/route.ts` pair calling `adapter.beginOAuth`/`completeOAuth`. Mastodon is special-cased in those same two routes (federated — it dynamically registers a client app with whichever instance URL the user supplies, cached per-instance in `mastodon/client.ts` so begin/complete reuse the same client credentials). Discord (bot token) and Bluesky (handle + app password) skip OAuth entirely — the UI posts credentials straight to `/api/accounts`.

Per-account credentials are envelope-encrypted at rest (AES-256-GCM, per-account key derived via HKDF from `SOCMED_MASTER_KEY`, `lib/platforms/crypto.ts`) — never log or return `encryptedCreds`/decrypted tokens outside the platform-adapter layer.

**Compose-time platform rules** live in `lib/platforms/content-rules.ts` (char limits, unit — chars/bytes/graphemes vary by platform — media count/size limits, per-platform confidence level since some of these drift/aren't officially documented). `ComposeView.tsx` renders a live preview + validation per connected platform from this single source; update it there, not per-component, if a platform's limits change.

**Routing/layout**: authenticated pages live under `app/app/(authed)/` and get the sidebar shell + session guard from that group's `layout.tsx` — a page placed outside the group (even with its own session check) renders with no nav. `app/app/login/` and the OAuth/webhook API routes are the only things outside it.

**Design system**: `DESIGN.md` is the source of truth for color tokens, radius scale, and component conventions, backing the Tailwind 4 `@theme` block in `app/app/globals.css`. Two things worth knowing before touching either file: (1) `tailwind-merge` treats a solid `bg-[#hex]` and an unconditional `bg-gradient-to-*` on the same element as the same conflict group and silently drops one — don't pair them unless the color source itself supplies gradient stops; (2) a semantic pair like `muted`/`muted-foreground` (background vs. the text that sits on it) must never share a value or text becomes invisible against its own background (this exact bug shipped once, in `<Tabs>`).

## Security

Read `SECURITY.md` before deploying — encrypted-at-rest tokens, `.env` handling, session cookie signing, rate limiting, and webhook signature verification are documented there, not repeated here.
