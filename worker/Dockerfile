# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ----- deps stage -----
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
RUN corepack enable \
 && pnpm --filter @socmed/worker build

# ----- runtime stage -----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg for video probe + poster frames (used by media helpers in M2+)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/app/node_modules ./app/node_modules
COPY --from=build /app/worker/dist ./worker/dist
COPY --from=build /app/worker/package.json ./worker/package.json
COPY --from=build /app/app ./app
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/worker
CMD ["node", "dist/index.js"]
