#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use 18 >/dev/null
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "还没有 pm2。先执行: npm install -g pm2"
  exit 1
fi

export RWA_NODE="$(command -v node)"
pm2 start ecosystem.config.cjs
pm2 status
