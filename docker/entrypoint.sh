#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/output/uploads /app/output/traces /app/output/workbooks \
         /app/output/backups /app/output/runtime /app/knowledge/local

# The Flask service may write model / WeKnora settings back to /app/.env.
touch /app/.env

# Nginx resolves 127.0.0.1 at request time; no DNS setup needed for local services.
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
