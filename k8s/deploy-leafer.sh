#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
ENGINE=leafer
echo "==> 构建 ${ENGINE} 镜像"
docker compose build "$ENGINE"
docker tag "render-server-${ENGINE}:latest" "image-render-server:${ENGINE}" 2>/dev/null || true
echo "==> 部署 ${ENGINE}"
kubectl apply -k "overlays/${ENGINE}"
