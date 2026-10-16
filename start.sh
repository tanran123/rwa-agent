#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${RWA_PORT:-8766}"
if [[ -z "${RWA_PORT:-}" && -f .env ]]; then
  line="$(grep -E '^[[:space:]]*RWA_PORT=' .env | tail -n 1 || true)"
  if [[ -n "$line" ]]; then
    PORT="${line#*=}"
    PORT="${PORT#"${PORT%%[![:space:]]*}"}"
    PORT="${PORT%"${PORT##*[![:space:]]}"}"
    PORT="${PORT#\"}"
    PORT="${PORT%\"}"
    PORT="${PORT#\'}"
    PORT="${PORT%\'}"
  fi
fi

pids="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [[ -n "$pids" ]]; then
  echo "停止占用 ${PORT} 的进程: ${pids}"
  kill $pids || true
  sleep 0.4
  still="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [[ -n "$still" ]]; then
    kill -9 $still || true
  fi
fi

if [[ -x .venv/bin/python ]]; then
  python=".venv/bin/python"
else
  python="python3"
fi

exec "$python" app.py
