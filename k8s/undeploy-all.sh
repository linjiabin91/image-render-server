#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
kubectl delete -k .
