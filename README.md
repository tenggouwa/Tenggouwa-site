# Tenggouwa-site

Tenggouwa的个人 monorepo。

```
apps/
├── web/      # 个人网站（GitHub Pages 根路径，极客风）
├── admin/    # 管理后台（GitHub Pages /admin 路径）
└── server/   # FastAPI 后端（阿里云 ubuntu，ssh openclaw）
packages/    # 共享代码（占位）
scripts/     # 部署 / 开发脚本
deploy/      # nginx / systemd 模板
```

## 在线路径

仓库部署到 GitHub Pages 后：

- `https://<user>.github.io/Tenggouwa-site/` → 个人网站
- `https://<user>.github.io/Tenggouwa-site/admin/` → 管理后台
- 后续新增前端项目放到 `apps/<name>`，会自动挂在 `/Tenggouwa-site/<name>/`

API 走自有域名/服务器：`https://api.<your-domain>/api/...`（nginx 反代到后端 10095）。

## 快速开始

```bash
# 安装前端依赖
pnpm install

# 启前端（任选其一）
pnpm dev:web      # 默认 http://localhost:5173
pnpm dev:admin    # 默认 http://localhost:5174

# 启后端
cd apps/server
./setup_dev_env.sh   # 首次
source .venv/bin/activate
cd app && python main.py   # 默认 http://localhost:10095
```

## 部署

```bash
# 前端：GitHub Actions 自动跑 .github/workflows/deploy-pages.yml
# 也可以本地手动：
pnpm build:pages          # 产物在 pages-dist/

# 后端：
pnpm deploy:server        # rsync 到 openclaw 并重启
```

详见 [TODO.md](./TODO.md)。
