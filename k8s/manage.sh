#!/usr/bin/env bash
set -e

CMD="${1:-help}"
ENGINE="${2:-konva}"

case "$CMD" in
  deploy)
    echo "==> 部署引擎: $ENGINE"
    kubectl apply -k "overlays/$ENGINE"
    ;;
  deploy-all)
    echo "==> 部署全部引擎"
    kubectl apply -k .
    ;;
  undeploy)
    echo "==> 卸载引擎: $ENGINE"
    kubectl delete -k "overlays/$ENGINE"
    ;;
  undeploy-all)
    echo "==> 卸载全部引擎"
    kubectl delete -k .
    ;;
  rebuild)
    echo "==> 构建 + 部署: $ENGINE"
    docker compose build "$ENGINE"
    docker tag "render-server-$ENGINE:latest" "image-render-server:$ENGINE"
    kubectl delete -k "overlays/$ENGINE" 2>/dev/null || true
    kubectl apply -k "overlays/$ENGINE"
    ;;
  logs)
    echo "==> 查看日志: $ENGINE"
    kubectl logs -l "app=${ENGINE}-image-render-server" --tail=50 -f
    ;;
  port)
    echo "==> 端口转发: $ENGINE → localhost:N (见 overlays/${ENGINE}/kustomization.yaml)"
    case "$ENGINE" in
      leafer)      PORT=3000 ;;
      fabric5)     PORT=3001 ;;
      fabric)      PORT=3002 ;;
      playwright)  PORT=3003 ;;
      konva)       PORT=3004 ;;
      *)           echo "未知引擎: $ENGINE"; exit 1 ;;
    esac
    kubectl port-forward "svc/${ENGINE}-image-render-server" "$PORT:3000"
    ;;
  status)
    echo "==> Pod 状态"
    kubectl get pods -l app
    echo ""
    echo "==> Service 列表"
    kubectl get svc -l app
    ;;
  curl)
    echo "==> 发送测试请求到: $ENGINE"
    case "$ENGINE" in
      leafer)      PORT=3000 ;;
      fabric5)     PORT=3001 ;;
      fabric)      PORT=3002 ;;
      playwright)  PORT=3003 ;;
      konva)       PORT=3004 ;;
      *)           echo "未知引擎: $ENGINE"; exit 1 ;;
    esac
    curl -s -X POST "http://localhost:$PORT/api/render" \
      -H "Content-Type: application/json" \
      -d '{"templateJson":{"className":"Stage","attrs":{"width":400,"height":100},"children":[{"className":"Layer","children":[{"className":"Rect","attrs":{"x":0,"y":0,"width":400,"height":100,"fill":"white"}},{"className":"Text","attrs":{"x":0,"y":0,"text":"你好世界","fontFamily":"AlibabaPuHuiTi-3","fontSize":40}}]}]},"options":{"width":400,"height":100,"format":"jpeg","quality":60,"pixelRatio":1,"engine":"'$ENGINE'"}}' \
      -o "/tmp/${ENGINE}-test.jpg" && echo "图片已保存: /tmp/${ENGINE}-test.jpg"
    ;;
  *)
    echo "用法: ./manage.sh <命令> [引擎]"
    echo ""
    echo "命令:"
    echo "  deploy <引擎>       部署指定引擎 (leafer/fabric5/fabric/playwright/konva)"
    echo "  deploy-all          部署全部引擎"
    echo "  undeploy <引擎>     卸载指定引擎"
    echo "  undeploy-all        卸载全部引擎"
    echo "  rebuild <引擎>      重新构建镜像 + 部署"
    echo "  logs <引擎>         查看日志"
    echo "  port <引擎>         端口转发 (kubectl port-forward)"
    echo "  status              查看所有 pod/service 状态"
    echo "  curl <引擎>         发送测试渲染请求"
    echo ""
    echo "示例:"
    echo "  ./manage.sh deploy konva"
    echo "  ./manage.sh rebuild leafer"
    echo "  ./manage.sh curl konva"
    echo "  ./manage.sh status"
    ;;
esac
