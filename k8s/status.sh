#!/usr/bin/env bash
set -e
echo "=== Pod ==="
kubectl get pods -l app
echo ""
echo "=== Service ==="
kubectl get svc -l app
