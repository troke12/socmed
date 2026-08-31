# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ----- deps stage: install all deps (incl. dev) for building -----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile=false

# ----- build stage: tsc the worker -----
FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY app ./app
COPY worker ./worker
# pnpm exec routes the binary through pnpm so it's on PATH inside
# the worker's shell. Plain `tsc` would be missing because pnpm's
# strict PATH doesn't expose the root node_modules/.bin to sub-packages.
RUN corepack enable \
 && pnpm --filter @socmed/worker exec tsc

# ----- runtime stage: prod-only, fully self-contained -----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg for video probe + poster frames
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy built artifacts + source tree
COPY --from=build /app /app
RUN corepack enable

# `pnpm deploy` produces a self-contained, deployable dir with all
# symlinks resolved into a flat node_modules. --prod keeps devDeps out.
RUN pnpm --filter @socmed/worker deploy --prod /deploy/worker

WORKDIR /deploy/worker
CMD ["node", "dist/index.js"]
