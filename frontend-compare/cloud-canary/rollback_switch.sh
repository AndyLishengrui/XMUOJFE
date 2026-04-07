#!/usr/bin/env bash

set -euo pipefail

SUDO_PASSWORD="${SUDO_PASSWORD:-Andy@5dg}"
SWITCH_ROOT="${SWITCH_ROOT:-/home/ubuntu/frontend-switch}"
CLOUD_CANARY_DIR="${CLOUD_CANARY_DIR:-/home/ubuntu/cloud-canary}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-oj-backend}"
CANARY_COMPOSE_FILE="${CANARY_COMPOSE_FILE:-$CLOUD_CANARY_DIR/docker-compose.yml}"

run_sudo() {
  printf '%s\n' "$SUDO_PASSWORD" | sudo -S "$@"
}

if ! run_sudo test -d "$SWITCH_ROOT/old-dist"; then
  echo "missing rollback source: $SWITCH_ROOT/old-dist" >&2
  exit 1
fi

if ! run_sudo test -d "$SWITCH_ROOT/new-dist"; then
  echo "missing rollback source: $SWITCH_ROOT/new-dist" >&2
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
run_sudo mkdir -p "$SWITCH_ROOT/backup"
run_sudo tar -C "$SWITCH_ROOT/old-dist" -czf "$SWITCH_ROOT/backup/rollback-old-dist-$timestamp.tar.gz" .
run_sudo tar -C "$SWITCH_ROOT/new-dist" -czf "$SWITCH_ROOT/backup/rollback-new-dist-$timestamp.tar.gz" .

run_sudo docker exec "$BACKEND_CONTAINER" sh -lc 'rm -rf /app/dist/*'
run_sudo docker cp "$SWITCH_ROOT/old-dist/." "$BACKEND_CONTAINER:/app/dist/"
run_sudo docker restart "$BACKEND_CONTAINER" >/dev/null

run_sudo docker-compose -f "$CANARY_COMPOSE_FILE" down || true
run_sudo rm -rf "$CLOUD_CANARY_DIR/dist/*"
run_sudo cp -R "$SWITCH_ROOT/new-dist/." "$CLOUD_CANARY_DIR/dist/"
run_sudo docker-compose -f "$CANARY_COMPOSE_FILE" up -d

echo "rollback complete"
run_sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | sed -n '1,10p'
