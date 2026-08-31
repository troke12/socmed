# syntax=docker/dockerfile:1.7
# Base image: don't set NODE_ENV=production globally; each stage sets it
# as needed. Setting it in the base breaks devDep installation in deps
# and build stages.
FROM node:22-bookworm-slim AS base
WORKDIR /app

# ----- deps stage: all deps (incl. dev) for building -----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile=false

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

# ----- runtime stage: prod-only, minimal -----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg for video probe + poster frames
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install ONLY production deps. We KEEP postinstall scripts so
# better-sqlite3's native binary gets compiled into the image.
# (--ignore-scripts would leave better-sqlite3 unusable at runtime.)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && pnpm install --frozen-lockfile=false --prod

# Build artifacts: worker CJS output (dist/worker/src + dist/app/lib)
COPY --from=build /app/worker/dist /app/worker/dist
# SQL migration files (tsc doesn't copy .sql) — worker applies them at boot
COPY --from=build /app/app/lib/db/migrations /app/worker/dist/app/lib/db/migrations

WORKDIR /app/worker
CMD ["node", "dist/worker/src/index.js"]
