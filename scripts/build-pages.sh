#!/usr/bin/env bash
# 构建前端产物。支持两种部署形态：
#
#   PAGES_TARGET=ghpages（默认）—— GitHub Pages 子路径
#     产物目录：pages-dist/
#     base：    /<REPO_NAME>/  与  /<REPO_NAME>/admin/
#
#   PAGES_TARGET=root —— 根路径 host（Cloudflare Pages / 自建 nginx 等）
#     产物目录：cf-dist/
#     base：    /  与  /admin/
#
# 产物结构（共同）：
#   <dist>/
#   ├── index.html        ← apps/web 的构建结果
#   ├── ...               (web 资源)
#   ├── 404.html          ← SPA 兜底，按 base 跳到对应 SPA 根
#   └── admin/            ← apps/admin 的构建结果
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${PAGES_TARGET:-ghpages}"
case "$TARGET" in
  ghpages)
    REPO_NAME="${REPO_NAME:-Tenggouwa-site}"
    WEB_BASE="/${REPO_NAME}/"
    ADMIN_BASE="/${REPO_NAME}/admin/"
    DIST="pages-dist"
    ;;
  root)
    WEB_BASE="/"
    ADMIN_BASE="/admin/"
    DIST="cf-dist"
    ;;
  *)
    echo "unknown PAGES_TARGET: $TARGET (expected ghpages|root)" >&2
    exit 1
    ;;
esac

echo "==> 目标：$TARGET   产物目录：$DIST"
echo "==> 清理 $DIST/"
rm -rf "$DIST"
mkdir -p "$DIST"

: "${VITE_API_BASE:=}"
echo "==> 构建 apps/web (base=$WEB_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$WEB_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/web build
cp -R apps/web/dist/. "$DIST/"

echo "==> 构建 apps/admin (base=$ADMIN_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$ADMIN_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/admin build
mkdir -p "$DIST/admin"
cp -R apps/admin/dist/. "$DIST/admin/"

# SPA 兜底：GitHub Pages 只支持根 404.html，Cloudflare Pages 也认 404.html。
# 这里写一个 smart 404：
#  - <ADMIN_BASE>/* → 跳 admin SPA 根
#  - 其它 <WEB_BASE>/* → 跳 web SPA 根
# 各 SPA 的 index.html 启动时再从 sessionStorage 把 URL 还原回 history。
cat > "$DIST/404.html" <<EOF
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
touch "$DIST/.nojekyll"

echo "==> 完成。产物在 $DIST/"
