#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "==> 构建全部镜像"
docker compose build
for e in konva leafer fabric fabric5 playwright; do
  docker tag "render-server-${e}:latest" "image-render-server:${e}" 2>/dev/null || true
done
echo "==> 部署全部引擎"
kubectl apply -k .
