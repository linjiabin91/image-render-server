#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
kubectl apply -k overlays/konva/
