ARG BASE_IMAGE=docker.m.daocloud.io/library/node:23-slim
ARG DEBIAN_MIRROR=mirrors.aliyun.com

FROM ${BASE_IMAGE} AS builder
ARG DEBIAN_MIRROR

# 写入软件源（通过 --build-arg DEBIAN_MIRROR=deb.debian.org 切换官方源）
RUN printf "Types: deb\nURIs: http://${DEBIAN_MIRROR}/debian\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n" > /etc/apt/sources.list.d/debian.sources && \
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
COPY packages/konva-engine/tsconfig.json packages/konva-engine/
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY packages/konva-engine/src packages/konva-engine/src
COPY packages/core/fonts packages/core/fonts

RUN pnpm tsc -b packages/core packages/server packages/konva-engine

# ── Runtime ────────────────────────────────────────────────────────────────
FROM ${BASE_IMAGE}
ARG DEBIAN_MIRROR

RUN printf "Types: deb\nURIs: http://${DEBIAN_MIRROR}/debian\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n" > /etc/apt/sources.list.d/debian.sources && \
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
COPY --from=builder /app/packages/konva-engine/package.json packages/konva-engine/
COPY --from=builder /app/packages/konva-engine/dist packages/konva-engine/dist

EXPOSE 3000

CMD ["node", "packages/konva-engine/dist/server.js"]
