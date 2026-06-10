FROM node:23-alpine

RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# 依赖层（利用 Docker 缓存）
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/leafer-engine/package.json packages/leafer-engine/
RUN npm ci

# 源码层
COPY tsconfig.json .
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY packages/leafer-engine/src packages/leafer-engine/src
COPY packages/core/fonts packages/core/fonts

# 构建
RUN npx tsc -b packages/core packages/server packages/leafer-engine

EXPOSE 3000

CMD ["node", "packages/leafer-engine/dist/server.js"]
