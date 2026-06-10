FROM docker.m.daocloud.io/library/node:23-slim AS builder

# 替换为国内源 + 安装编译依赖（--fix-missing 解决 Debian CDN Hash Sum mismatch）
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && apt-get install -y --no-install-recommends --fix-missing \
        python3 make g++ \
        libc6-dev \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpixman-1-0 libpng-dev libgif-dev \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/leafer-engine/package.json packages/leafer-engine/
COPY packages/fabric5-engine/package.json packages/fabric5-engine/
COPY packages/fabric-engine/package.json packages/fabric-engine/
COPY packages/playwright-engine/package.json packages/playwright-engine/
COPY packages/konva-engine/package.json packages/konva-engine/
RUN pnpm install

COPY tsconfig.json .
COPY packages/core/tsconfig.json packages/core/
COPY packages/server/tsconfig.json packages/server/
COPY packages/fabric-engine/tsconfig.json packages/fabric-engine/
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY packages/fabric-engine/src packages/fabric-engine/src
COPY packages/core/fonts packages/core/fonts

RUN pnpm tsc -b packages/core packages/server packages/fabric-engine

# ── Runtime ────────────────────────────────────────────────────────────────
FROM docker.m.daocloud.io/library/node:23-slim

RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && apt-get install -y --no-install-recommends --fix-missing \
        libc6-dev \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/fonts packages/core/fonts
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/fabric-engine/package.json packages/fabric-engine/
COPY --from=builder /app/packages/fabric-engine/dist packages/fabric-engine/dist

EXPOSE 3000

CMD ["node", "packages/fabric-engine/dist/server.js"]
