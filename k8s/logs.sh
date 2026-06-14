#!/usr/bin/env bash
set -e
ENGINE="${1:-konva}"
POD=$(kubectl get pod -l "app=${ENGINE}-image-render-server" -o name 2>/dev/null | head -1)
if [ -z "$POD" ]; then
  echo "❌ 找不到 ${ENGINE} 的 pod，先执行 deploy-${ENGINE}.sh"
  exit 1
fi
echo "==> 日志: $POD"
kubectl logs -f "$POD"
