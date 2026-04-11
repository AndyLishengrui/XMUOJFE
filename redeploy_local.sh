#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/../OnlineJudgeDeploy/docker-compose.yml}"
SERVICE_NAME="${SERVICE_NAME:-oj-backend}"
CHECK_URL="${CHECK_URL:-http://127.0.0.1/}"

export NODE_OPTIONS="${NODE_OPTIONS:---openssl-legacy-provider}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

cd "$SCRIPT_DIR"

if [[ ! -d node_modules ]]; then
  echo "node_modules not found, installing dependencies..."
  npm install --legacy-peer-deps
fi

echo "building frontend dll..."
npm run build:dll

echo "building frontend dist..."
npm run build

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE_NAME")"
if [[ -z "$container_id" ]]; then
  echo "service $SERVICE_NAME is not running under $COMPOSE_FILE" >&2
  exit 1
fi

echo "clearing old dist in container $container_id..."
docker exec "$container_id" sh -lc 'rm -rf /app/dist/*'

echo "copying dist to container $container_id..."
docker cp "$SCRIPT_DIR/dist/." "$container_id:/app/dist/"

echo "restarting $SERVICE_NAME to reload static assets..."
docker restart "$container_id" >/dev/null

echo "checking $CHECK_URL ..."
if curl -fsSI --max-time 15 "$CHECK_URL" >/dev/null; then
  echo "frontend redeployed successfully"
else
  echo "frontend copied and service restarted; retry $CHECK_URL in a few seconds if the service is still warming up" >&2
fi