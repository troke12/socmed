# syntax=docker/dockerfile:1.7
# Worker image — deliberately small: it only needs better-sqlite3 +
# drizzle-orm at runtime. We build in a full stage, then copy only the
# compiled output + the minimal prod node_modules into the runtime stage.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ----- deps stage: all workspace deps (incl. dev) for building -----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile

# ----- build stage: tsc the worker (needs typescript from devDeps) -----
FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY app ./app
COPY worker ./worker
# pnpm run properly threads the package's local .bin into PATH.
# CJS output lands in worker/dist/worker/src/index.js (tsc mirrors src/)
# and worker/dist/app/lib/** (tsc compiles the imported app sources).
RUN corepack enable \
 && pnpm --filter @socmed/worker run build

# ----- prod-deps stage: install only the worker's prod dependencies -----
# `pnpm deploy` produces a self-contained folder with a real (non-symlinked)
# node_modules — much more reliable to COPY into the runtime image.
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
ENV NODE_ENV=production
# Keep postinstall so better-sqlite3's native binary gets compiled.
RUN corepack enable \
 && pnpm --filter @socmed/worker deploy --prod /out \
 && rm -rf /out/node_modules/.cache

# ----- runtime stage: minimal, non-root -----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg is NOT needed here — media probing lives in the web app
# (app/lib/media/probe.ts), which has its own ffmpeg install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 10001 socmed \
 && useradd --system --uid 10001 --gid socmed socmed

# Build artifacts: worker CJS output (dist/worker/src + dist/app/lib)
COPY --from=build /app/worker/dist /app/worker/dist
# SQL migration files (tsc doesn't copy .sql) — worker applies them at boot
COPY --from=build /app/app/lib/db/migrations /app/worker/dist/app/lib/db/migrations
# Self-contained prod node_modules (better-sqlite3 + drizzle-orm only)
COPY --from=prod-deps /out/node_modules /app/node_modules

RUN mkdir -p /app/data && chown -R socmed:socmed /app
USER socmed

WORKDIR /app/worker
CMD ["node", "dist/worker/src/index.js"]
