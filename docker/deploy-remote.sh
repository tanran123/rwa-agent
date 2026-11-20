#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_ENV="$ROOT/docker/deploy.env"
cd "$ROOT"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "缺少 docker/deploy.env。先执行：" >&2
  echo "  cp docker/deploy.env.example docker/deploy.env" >&2
  echo "然后填写 SERVER、SSH_KEY、REMOTE_DIR。" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$DEPLOY_ENV"

: "${SERVER:?deploy.env 里必须填写 SERVER}"
REMOTE_DIR="${REMOTE_DIR:-/opt/rwa-agent}"
SSH_PORT="${SSH_PORT:-22}"
UPLOAD_ENV="${UPLOAD_ENV:-0}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="release/rwa-agent-src-${STAMP}.tar.gz"
SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=15)
SCP_OPTS=(-P "$SSH_PORT" -o ConnectTimeout=15)
if [[ -n "${SSH_KEY:-}" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
  SCP_OPTS+=(-i "$SSH_KEY")
fi

mkdir -p release
echo "打包源码到 ${ARCHIVE}"
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='client/dist' \
  --exclude='*/client/dist' \
  --exclude='output' \
  --exclude='release' \
  --exclude='.pytest_cache' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.DS_Store' \
  --exclude='.env' \
  --exclude='server/.env' \
  --exclude='docker/deploy.env' \
  --exclude='docker/app.env' \
  .

echo "上传到 ${SERVER}:${REMOTE_DIR}"
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p '$REMOTE_DIR/docker'"
scp "${SCP_OPTS[@]}" "$ARCHIVE" "$SERVER:$REMOTE_DIR/"
if [[ "$UPLOAD_ENV" == "1" ]]; then
  if [[ -f "$ROOT/server/.env" ]]; then
    scp "${SCP_OPTS[@]}" "$ROOT/server/.env" "$SERVER:$REMOTE_DIR/docker/mysql.env"
  fi
  if [[ -f "$ROOT/.env" ]]; then
    scp "${SCP_OPTS[@]}" "$ROOT/.env" "$SERVER:$REMOTE_DIR/docker/model.env"
  fi
fi

echo "在服务器解包并构建启动"
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$REMOTE_DIR" "$(basename "$ARCHIVE")" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
ARCHIVE="$2"
cd "$REMOTE_DIR"
tar -xzf "$ARCHIVE"
cd "$REMOTE_DIR/docker"
if [[ ! -f app.env ]]; then
  cp app.env.example app.env
  echo "已生成 $REMOTE_DIR/docker/app.env。" >&2
  if [[ ! -f mysql.env || ! -f model.env ]]; then
    echo "还需要填写 $REMOTE_DIR/docker/app.env（或 mysql.env / model.env）后重新执行。" >&2
    exit 2
  fi
fi
mkdir -p output
docker compose --env-file app.env up -d --build
docker compose --env-file app.env ps
REMOTE
