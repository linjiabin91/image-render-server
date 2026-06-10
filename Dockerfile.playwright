FROM node:23-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# 依赖层 — 复制所有 workspace package.json（npm ci 需要完整的 workspace 信息）
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/leafer-engine/package.json packages/leafer-engine/
COPY packages/fabric5-engine/package.json packages/fabric5-engine/
COPY packages/fabric-engine/package.json packages/fabric-engine/
COPY packages/playwright-engine/package.json packages/playwright-engine/
COPY packages/konva-engine/package.json packages/konva-engine/
RUN npm ci

# 源码层 — 仅复制当前引擎所需
COPY tsconfig.json .
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY packages/playwright-engine/src packages/playwright-engine/src
COPY packages/core/fonts packages/core/fonts

# 构建（playwright-engine 构建时会复制 pages/ 到 dist/）
RUN npx tsc -b packages/core packages/server packages/playwright-engine && \
    cp -r packages/playwright-engine/src/pages packages/playwright-engine/dist/

# ── Runtime ────────────────────────────────────────────────────────────────
FROM node:23-alpine

RUN apk add --no-cache libc6-compat chromium

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/fonts packages/core/fonts
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/playwright-engine/dist packages/playwright-engine/dist

EXPOSE 3000

CMD ["node", "packages/playwright-engine/dist/server.js"]
