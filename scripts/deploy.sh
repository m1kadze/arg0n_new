#!/usr/bin/env bash
set -euo pipefail

cd /opt/arg0n

echo "==> git pull"
git fetch --prune
git reset --hard origin/main

echo "==> docker compose build"
docker compose build --pull

echo "==> docker compose up"
docker compose up -d --remove-orphans

echo "==> prune old images"
docker image prune -f

echo "==> health check"
for i in {1..20}; do
    if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
        echo "OK"
        exit 0
    fi
    sleep 2
done

echo "health check failed" >&2
docker compose logs --tail=100 backend
exit 1
