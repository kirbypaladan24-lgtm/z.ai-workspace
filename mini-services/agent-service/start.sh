#!/usr/bin/env bash
# agent-service startup — explicit development vs production modes.
#
#   prod (default): plain `bun index.ts` — NO hot reload. Restarts are explicit
#                   and controlled. Use this whenever the service is serving a
#                   paired workspace: hot-reload churn bounces the socket.io
#                   connection on every file save and can interrupt in-flight
#                   bridge operations (verification runs, knowledge syncs).
#
#   dev:            `bun --hot index.ts` — auto-restarts on code changes.
#                   Use ONLY while actively editing the service code, with no
#                   verification run executing and no paired session relying on
#                   the socket staying up.
#
# Environment:
#   AGENT_PORT        socket.io port for the VS Code extension (default 3003)
#   AGENT_ADMIN_PORT  localhost-only operator admin API (default 3004)
#   AGENT_DATA_DIR    runtime state dir (default /tmp/agent-service-data)
#
# Recommended production invocation:
#   nohup ./start.sh prod >> /tmp/agent-service.log 2>&1 &
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-prod}"
export AGENT_PORT="${AGENT_PORT:-3003}"
export AGENT_ADMIN_PORT="${AGENT_ADMIN_PORT:-3004}"
export AGENT_DATA_DIR="${AGENT_DATA_DIR:-/tmp/agent-service-data}"
mkdir -p "$AGENT_DATA_DIR"
case "$MODE" in
  prod) echo "[start.sh] production mode: bun index.ts (no hot reload)"; exec bun index.ts ;;
  dev)  echo "[start.sh] development mode: bun --hot index.ts (auto-restart on changes)"; exec bun --hot index.ts ;;
  *)    echo "usage: $0 [prod|dev]"; exit 2 ;;
esac
