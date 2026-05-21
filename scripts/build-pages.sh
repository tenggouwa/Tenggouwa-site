#!/usr/bin/env bash
# 本地构建 GitHub Pages 产物。
# 产物结构：
#   pages-dist/
#   ├── index.html        ← apps/web 的构建结果
#   ├── ...               (web 资源)
#   ├── 404.html          ← SPA 兜底，复制 web 的 index.html
#   └── admin/            ← apps/admin 的构建结果
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 仓库名在 GitHub Pages 上作为子路径
REPO_NAME="${REPO_NAME:-Tenggouwa-site}"
WEB_BASE="/${REPO_NAME}/"
ADMIN_BASE="/${REPO_NAME}/admin/"

echo "==> 清理 pages-dist/"
rm -rf pages-dist
mkdir -p pages-dist

echo "==> 构建 apps/web (base=$WEB_BASE)"
VITE_BASE="$WEB_BASE" pnpm --filter @tenggouwa/web build
cp -R apps/web/dist/. pages-dist/

echo "==> 构建 apps/admin (base=$ADMIN_BASE)"
VITE_BASE="$ADMIN_BASE" pnpm --filter @tenggouwa/admin build
mkdir -p pages-dist/admin
cp -R apps/admin/dist/. pages-dist/admin/

# SPA 兜底：GitHub Pages 默认 404.html 走静态文件。
cp pages-dist/index.html pages-dist/404.html

# 防止 GitHub Pages 用 Jekyll 处理（会过滤 _ 开头的目录）
touch pages-dist/.nojekyll

echo "==> 完成。产物在 pages-dist/"
