# 1. Build the Vue frontend.
FROM node:18-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# 2. Install Koa production dependencies.
FROM node:18-bookworm-slim AS server-deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# 3. Runtime: Node 18 + Python venv + Nginx + Supervisor.
FROM node:18-bookworm-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai \
    RWA_ENV_FILE=/app/.env \
    NODE_ENV=production \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl nginx supervisor tzdata \
      python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . ./
COPY --from=client-build /build/client/dist /usr/share/nginx/html
COPY --from=server-deps /build/server/node_modules /app/server/node_modules

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/rwa.conf
COPY docker/entrypoint.sh /usr/local/bin/rwa-entrypoint
RUN chmod +x /usr/local/bin/rwa-entrypoint \
 && mkdir -p /app/output/uploads /app/output/traces /app/output/workbooks \
             /app/output/backups /app/output/runtime /app/knowledge/local \
 && touch /app/.env

VOLUME ["/app/output"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/rwa-entrypoint"]
