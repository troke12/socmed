# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ----- deps stage: all deps (incl. dev) for building -----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile \
 && pnpm store prune

# ----- build stage: next build (needs devDeps) -----
FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY app ./app
COPY worker ./worker
# next build runs "collecting page data" in parallel workers that all
# import DB-backed route modules. Point the build at a throwaway DB so
# it doesn't touch the real one (and so WAL-mode contention can't fail
# the build).
ENV SOCMED_DB_PATH=/tmp/build.db SOCMED_UPLOADS_DIR=/tmp/build-uploads
RUN corepack enable \
 && pnpm --filter @socmed/app run build

# ----- runtime stage: prod-only, non-root -----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Non-root user (matches the uid used for the data volume on most hosts).
RUN groupadd --system --gid 10001 socmed \
 && useradd --system --uid 10001 --gid socmed socmed

# Next.js standalone output (server.js bundles deps via @vercel/nft)
COPY --from=build /app/app/public ./app/public
COPY --from=build /app/app/.next/standalone ./
COPY --from=build /app/app/.next/static ./app/.next/static

RUN mkdir -p /app/data && chown -R socmed:socmed /app
USER socmed

EXPOSE 3000
# Next.js standalone output nests under app/ because the project dir
# is app/ inside the build context.
CMD ["node", "app/server.js"]
