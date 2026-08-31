# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ----- deps stage: all deps for building -----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml ./
COPY app/package.json ./app/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile=false

# ----- build stage -----
FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY app ./app
COPY worker ./worker
# pnpm exec routes the binary through pnpm so it's on PATH inside
# the worker's shell.
RUN corepack enable \
 && pnpm --filter @socmed/app build

# ----- runtime stage -----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone output (server.js bundles deps via @vercel/nft)
COPY --from=build /app/app/public ./app/public
COPY --from=build /app/app/.next/standalone ./
COPY --from=build /app/app/.next/static ./app/.next/static

EXPOSE 3000
CMD ["node", "server.js"]
