#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-1.0.0}"
PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE="${IMAGE:-rwa-agent}"
TARBALL="release/${IMAGE}-${VERSION}-linux-amd64.tar"

if ! command -v docker >/dev/null 2>&1; then
  echo "没有找到 docker。请先安装 Docker Desktop 或 Docker Engine。" >&2
  exit 1
fi

mkdir -p release
echo "构建 ${IMAGE}:${VERSION}，平台 ${PLATFORM}"
if docker buildx version >/dev/null 2>&1; then
  docker buildx build --platform "$PLATFORM" --load -t "${IMAGE}:${VERSION}" -f docker/Dockerfile .
else
  docker build --platform "$PLATFORM" -t "${IMAGE}:${VERSION}" -f docker/Dockerfile .
fi

echo "导出镜像到 ${TARBALL}"
docker save "${IMAGE}:${VERSION}" -o "$TARBALL"
ls -lh "$TARBALL"
