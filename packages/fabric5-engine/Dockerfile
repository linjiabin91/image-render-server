FROM docker.m.daocloud.io/library/node:23-slim AS builder

# 替换为国内源 + 安装编译依赖（--fix-missing 解决 Debian CDN Hash Sum mismatch）
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && apt-get install -y --no-install-recommends --fix-missing \
        python3 make g++ \
        libc6-dev \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpixman-1-0 libpng-dev libgif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖层 — 复制所有 workspace package.json（npm ci 需要完整的 workspace 信息）
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/leafer-engine/package.json packages/leafer-engine/
COPY packages/fabric5-engine/package.json packages/fabric5-engine/
COPY packages/fabric-engine/package.json packages/fabric-engine/
COPY packages/playwright-engine/package.json packages/playwright-engine/
COPY packages/konva-engine/package.json packages/konva-engine/
RUN npm install

# 源码层 — 仅复制当前引擎所需（含 tsconfig，tsc -b 需要子包 tsconfig.json）
COPY tsconfig.json .
COPY packages/core/tsconfig.json packages/core/
COPY packages/server/tsconfig.json packages/server/
COPY packages/fabric5-engine/tsconfig.json packages/fabric5-engine/
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY packages/fabric5-engine/src packages/fabric5-engine/src
COPY packages/core/fonts packages/core/fonts

# 构建
RUN npx tsc -b packages/core packages/server packages/fabric5-engine

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
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/fonts packages/core/fonts
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/fabric5-engine/package.json packages/fabric5-engine/
COPY --from=builder /app/packages/fabric5-engine/dist packages/fabric5-engine/dist

EXPOSE 3000

CMD ["node", "packages/fabric5-engine/dist/server.js"]
