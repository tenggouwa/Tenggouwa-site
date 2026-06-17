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
# canonical / sitemap 永远指向正版根域名，不论产物挂在哪
SITE_ORIGIN="${SITE_ORIGIN:-https://tenggouwa.com}"
case "$TARGET" in
  ghpages)
    REPO_NAME="${REPO_NAME:-Tenggouwa-site}"
    WEB_BASE="/${REPO_NAME}/"
    ADMIN_BASE="/${REPO_NAME}/admin/"
    CASINO_BASE="/${REPO_NAME}/casino/"
    DIST="pages-dist"
    # 子路径产物不让搜索引擎收录，免得跟主域名互打权重
    PRERENDER_NOINDEX="--noindex"
    ;;
  root)
    WEB_BASE="/"
    ADMIN_BASE="/admin/"
    CASINO_BASE="/casino/"
    DIST="cf-dist"
    PRERENDER_NOINDEX=""
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
VITE_BASE="$WEB_BASE" \
  VITE_API_BASE="$VITE_API_BASE" \
  VITE_UMAMI_URL="${VITE_UMAMI_URL:-}" \
  VITE_UMAMI_WEBSITE_ID="${VITE_UMAMI_WEBSITE_ID:-}" \
  pnpm --filter @tenggouwa/web build
cp -R apps/web/dist/. "$DIST/"

echo "==> 构建 apps/admin (base=$ADMIN_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$ADMIN_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/admin build
mkdir -p "$DIST/admin"
cp -R apps/admin/dist/. "$DIST/admin/"

echo "==> 构建 apps/casino (base=$CASINO_BASE, api=${VITE_API_BASE:-<empty>})"
VITE_BASE="$CASINO_BASE" VITE_API_BASE="$VITE_API_BASE" pnpm --filter @tenggouwa/casino build
mkdir -p "$DIST/casino"
cp -R apps/casino/dist/. "$DIST/casino/"

echo "==> 预渲染博客静态页 + sitemap / robots / feed (origin=$SITE_ORIGIN)"
# prerender 从 API 拉数据（DB 是唯一真相），未显式传则回落到 https://api.tenggouwa.com
PRERENDER_API="${VITE_API_BASE:-https://api.tenggouwa.com}"
node scripts/prerender.mjs \
  --dist="$DIST" \
  --base="$WEB_BASE" \
  --origin="$SITE_ORIGIN" \
  --api="$PRERENDER_API" \
  $PRERENDER_NOINDEX

echo "==> 生成 OG 封面 (PNG)"
node scripts/generate-og.mjs --dist="$DIST"

# SPA 兜底：GitHub Pages 只支持根 404.html。
# 策略：把 web 的 index.html 整个拷贝过来当 404.html——任何 deep-link 刷新时浏览器
# URL 不变，web SPA 直接 mount，BrowserRouter 自己 match 路由。
# 例外是子路径 SPA（admin / casino）：根 404.html 跑的是 web SPA，basename="/" 不认识
# /admin/* 或 /casino/*，所以在 <head> 顶部插一段 inline script，把子路径先存
# sessionStorage 再 redirect 到对应 SPA 根，该 SPA 的 main.tsx 再 history.replaceState 还原。
cp "$DIST/index.html" "$DIST/404.html"
SUBAPP_REDIRECT_SCRIPT=$(cat <<EOF
<script>(function(){var bs=["${ADMIN_BASE}","${CASINO_BASE}"];for(var i=0;i<bs.length;i++){var b=bs[i];if(location.pathname.indexOf(b)===0&&location.pathname!==b){try{sessionStorage.setItem('tg_spa_redirect',location.pathname+location.search+location.hash);}catch(e){}location.replace(b);return;}}})();</script>
EOF
)
# 在 <head> 后立刻插入 redirect script
python3 -c "
import sys
p = '$DIST/404.html'
s = open(p).read()
inject = '''$SUBAPP_REDIRECT_SCRIPT'''
s = s.replace('<head>', '<head>' + inject, 1)
open(p, 'w').write(s)
"

# 防止 GitHub Pages 用 Jekyll 处理（会过滤 _ 开头的目录）
touch "$DIST/.nojekyll"

echo "==> 完成。产物在 $DIST/"
