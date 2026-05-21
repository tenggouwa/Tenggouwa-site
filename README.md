<div align="center">

```
 _
| |_ ___ _ __   __ _  __ _  ___  _   ___      ____ _
| __/ _ \ '_ \ / _` |/ _` |/ _ \| | | \ \ /\ / / _` |
| ||  __/ | | | (_| | (_| | (_) | |_| |\ V  V / (_| |
 \__\___|_| |_|\__, |\__, |\___/ \__,_| \_/\_/ \__,_|
               |___/ |___/
```

**Tenggouwa的极客小站 · monorepo**

[![Deploy Pages](https://github.com/tenggouwa/Tenggouwa-site/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/tenggouwa/Tenggouwa-site/actions/workflows/deploy-pages.yml)
[![Site](https://img.shields.io/website?url=https%3A%2F%2Ftenggouwa.github.io%2FTenggouwa-site%2F&label=web&style=flat-square)](https://tenggouwa.github.io/Tenggouwa-site/)
[![API](https://img.shields.io/website?url=https%3A%2F%2Fapi.tenggouwa.com%2Fhealth%2Fcheck&label=api&style=flat-square)](https://api.tenggouwa.com/health/check)
[![Last commit](https://img.shields.io/github/last-commit/tenggouwa/Tenggouwa-site?style=flat-square)](https://github.com/tenggouwa/Tenggouwa-site/commits/main)

[**🌐 web**](https://tenggouwa.github.io/Tenggouwa-site/) ·
[**📝 posts**](https://tenggouwa.github.io/Tenggouwa-site/posts) ·
[**💡 inspirations**](https://tenggouwa.github.io/Tenggouwa-site/inspirations) ·
[**🧪 lab**](https://tenggouwa.github.io/Tenggouwa-site/lab)

</div>

---

一个**真·全栈** monorepo：前端挂 GitHub Pages、后端 FastAPI/Postgres
跑在阿里云 + Cloudflare Tunnel。整站终端绿配色 + CRT 扫描线，
重要：~~没有~~ 只有一点点鸡汤。

## ✨ 看点

- 📦 **单仓多端** —— `web` `admin` `server` 一个仓搞定，pnpm workspace + uv 各管一摊
- 🎨 **极客终端风** —— Tailwind + Arco 双武器，自调 `@tailwindcss/typography` 主题
- ⚡ **Cloudflare Tunnel 暴露 API** —— 服务器不开一个入站口，免 ICP 备案
- 🔐 **JWT + bcrypt 后台鉴权** —— admin 凭据走 env，不入仓
- 📊 **自研埋点** —— 不依赖第三方，PG + Recharts dashboard，看 PV / UV / 地理 / 设备
- 🚀 **一行命令部署** —— `pnpm deploy:server` 完成 rsync + docker build + 迁移 + 重启
- 🧬 **极简 docker stack** —— `postgres + app + cloudflared` 三个容器，全 `compose up`

## 🏗 架构

```
                   ┌─────────────────────────────────────────────┐
                   │              GitHub Pages (CDN)              │
                   │                                              │
                   │  /Tenggouwa-site/       ← apps/web    SPA   │
                   │  /Tenggouwa-site/admin/ ← apps/admin  SPA   │
                   └────────────────┬─────────────────────────────┘
                                    │ https
                                    ▼
                   ┌─────────────────────────────────────────────┐
                   │   Cloudflare 边缘 (TLS + WAF + Tunnel)       │
                   │     api.tenggouwa.com  ──→  Tunnel           │
                   └────────────────┬─────────────────────────────┘
                                    │ (outbound QUIC)
            ┌───────────────────────┴──────────────────────────┐
            │           阿里云 ubuntu / docker compose          │
            │                                                  │
            │   ┌──────────┐   ┌─────────┐   ┌────────────┐    │
            │   │cloudflared│──→│  app   │──→│ postgres   │    │
            │   │  tunnel   │   │FastAPI │   │  16-alpine │    │
            │   └──────────┘   │  10095 │   │   5432     │    │
            │                  └─────────┘   └────────────┘    │
            └──────────────────────────────────────────────────┘
```

## 🧰 技术栈

|        |   web / admin                    |    server                          |
| ------ | -------------------------------- | ---------------------------------- |
| 语言   | TypeScript                       | Python 3.12                        |
| 框架   | React 18 + React Router          | FastAPI + Starlette                |
| 构建   | Vite                             | uv + uvicorn / gunicorn            |
| UI     | Arco Design + Tailwind + typography | —                              |
| 状态   | Zustand (admin) / 无 (web)       | —                                  |
| 图表   | Recharts (admin /analytics)      | —                                  |
| MD 编辑| @uiw/react-md-editor             | —                                  |
| 数据库 | —                                | PostgreSQL 16 + SQLAlchemy 2 async |
| 迁移   | —                                | Alembic                            |
| 鉴权   | —                                | PyJWT + bcrypt                     |
| 部署   | GitHub Actions → Pages           | Docker Compose + Cloudflare Tunnel |

## 📁 目录

```
.
├── apps
│   ├── web/        # 前台（极客终端风）
│   ├── admin/      # 后台（文章 / 灵感 / 站点分析）
│   └── server/     # FastAPI + Postgres + Alembic
├── packages/       # 共享代码（占位）
├── scripts/        # build / deploy 脚本
├── deploy/         # nginx / systemd / cloudflare 模板与说明
├── .github/
│   └── workflows/  # deploy-pages.yml
├── CLAUDE.md       # 协作约定（中文优先、ruff、X | Y 类型...）
├── TODO.md         # 路线图
└── README.md       # 你正在看
```

## 🚀 起手

```bash
# 装前端依赖
pnpm install

# 起前端
pnpm dev:web      # http://localhost:5173
pnpm dev:admin    # http://localhost:5174

# 起后端（首次会自动建 .venv 并 uv sync）
cd apps/server
docker compose up -d postgres        # 本地 PG
cp -n .env.sample .env               # 含 dev 密钥
cd ..
pnpm dev:server                      # http://localhost:10095
```

默认后台账号：`dev / dev123`（生产用 bcrypt 哈希走环境变量，见 `apps/server/.env.prod.sample`）。

## 📦 部署

| 链路 | 方式 | 触发 |
| ---- | ---- | ---- |
| 前端 → GitHub Pages | `.github/workflows/deploy-pages.yml` | `git push` 到 `main` 自动 |
| 后端 → 阿里云 docker | `scripts/deploy-server.sh` | 本地 `pnpm deploy:server` |

需要在 GitHub repo Settings → Secrets and variables → Actions → Variables 加：

- `VITE_API_BASE` = `https://api.tenggouwa.com`

服务器侧 `.env` 需要：

- `POSTGRES_DEFAULT_PASSWORD` / `AUTH_JWT_SECRET` / `ADMIN_*_PASSWORD_HASH` / `CLOUDFLARE_TUNNEL_TOKEN`

详细步骤：

- [deploy/README.md](./deploy/README.md)
- [deploy/cloudflare-tunnel.md](./deploy/cloudflare-tunnel.md)
- [deploy/postgres.md](./deploy/postgres.md)

## 🗺 路线图

进度 / 计划见 [TODO.md](./TODO.md)。当前节奏：

- [x] monorepo 骨架
- [x] web / admin / server 全部上线
- [x] PostgreSQL 接入 + Alembic 迁移
- [x] Markdown 编辑器 + 终端配色 prose
- [x] 自研埋点 + admin /analytics dashboard
- [ ] admin 改 admin 密码 UI
- [ ] 文件 / 图片上传（OSS 或自建）
- [ ] 评论 / RSS / sitemap

## 🤝 协作约定

详见 [CLAUDE.md](./CLAUDE.md) ——给 AI / 给我自己半年后看的备忘录：

- 中文回复 + 英文专有名词
- Python: ruff、Google 风 docstring、`X | Y` 类型、`from collections.abc import Callable`
- 不引入未要求的功能 / 抽象 / 回退逻辑
- 不写废注释
- 不预防"未来"

## 🪪 致谢

- 终端绿配色灵感 ≈ Snazzy theme
- ASCII logo 用 `figlet -f standard tenggouwa` 生成
- 一杯一杯 flat white ☕

---

<sub>© 2026 · tenggouwa · made with caffeine</sub>
