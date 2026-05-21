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

: "${VITE_API_BASE:=}"
echo "==> 构建 apps/web (base=$WEB_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$WEB_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/web build
cp -R apps/web/dist/. pages-dist/

echo "==> 构建 apps/admin (base=$ADMIN_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$ADMIN_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/admin build
mkdir -p pages-dist/admin
cp -R apps/admin/dist/. pages-dist/admin/

# SPA 兜底：GitHub Pages 只支持根 404.html。
# 这里写一个 smart 404：
#  - /Tenggouwa-site/admin/* 路径 → 把原 URL 暂存 sessionStorage、跳 admin SPA 根
#  - 其它 /Tenggouwa-site/* → 跳 web SPA 根
# 各 SPA 的 index.html 启动时再从 sessionStorage 把 URL 还原回 history。
cat > pages-dist/404.html <<EOF
<!doctype html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8" />
  <title>tenggouwa · routing</title>
  <script>
    (function () {
      var WEB_BASE   = "${WEB_BASE}";
      var ADMIN_BASE = "${ADMIN_BASE}";
      var url = location.pathname + location.search + location.hash;
      try { sessionStorage.setItem('tg_spa_redirect', url); } catch (e) {}
      if (location.pathname.indexOf(ADMIN_BASE) === 0) {
        location.replace(ADMIN_BASE);
      } else {
        location.replace(WEB_BASE);
      }
    })();
  </script>
</head>
<body></body>
</html>
EOF

# 防止 GitHub Pages 用 Jekyll 处理（会过滤 _ 开头的目录）
touch pages-dist/.nojekyll

echo "==> 完成。产物在 pages-dist/"
