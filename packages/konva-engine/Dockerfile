ARG BASE_IMAGE=docker.m.daocloud.io/library/node:23-slim
ARG DEBIAN_MIRROR=mirrors.aliyun.com

FROM ${BASE_IMAGE} AS builder
ARG DEBIAN_MIRROR

RUN printf "Types: deb\nURIs: http://${DEBIAN_MIRROR}/debian\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n" > /etc/apt/sources.list.d/debian.sources && \
    apt-get update && apt-get install -y --no-install-recommends --fix-missing \
        python3 make g++ \
        libc6-dev \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpixman-1-0 libpng-dev libgif-dev \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY . .

RUN pnpm install
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

# 一次性拷贝构建产物，无需逐个包维护 COPY 列表
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
RUN rm -rf packages/*/src

# 字体目录覆盖（不设置则使用内置字体 packages/core/fonts/）
ENV FONTS_DIR=

EXPOSE 3000

CMD ["node", "packages/konva-engine/dist/server.js"]
