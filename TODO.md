# Tenggouwa-site Monorepo TODO

> 目标：把这个仓库做成一个 monorepo，前端挂 GitHub Pages（以项目名做子路径同时可
> 承载多个独立项目），后端 FastAPI 部署到阿里云（`ssh openclaw`）。

GitHub Pages 路径策略（仓库名 `Tenggouwa-site`）：

| App           | 在线路径                                                | base 路径                  |
| ------------- | ------------------------------------------------------- | -------------------------- |
| `apps/web`    | `https://<user>.github.io/Tenggouwa-site/`              | `/Tenggouwa-site/`         |
| `apps/admin`  | `https://<user>.github.io/Tenggouwa-site/admin/`        | `/Tenggouwa-site/admin/`   |
| `apps/<x>`    | `https://<user>.github.io/Tenggouwa-site/<x>/`          | `/Tenggouwa-site/<x>/`     |

后端只有一个 FastAPI 进程（端口 10095），通过 router prefix 拆业务模块。
前端通过 `VITE_API_BASE` 走 nginx 反代到这个进程。

---

## Phase 0 — Monorepo 骨架

- [x] 选定结构 `apps/* + packages/* + scripts/*`
- [x] `pnpm-workspace.yaml` / 根 `package.json` / 根 `tsconfig.base.json`
- [x] `.gitignore` / `.editorconfig` / `README.md`
- [ ] `packages/shared-types`（前后端共用 TS 类型，按需添加）

## Phase 1 — `apps/web` 个人网站（极客风）

技术栈：Vite + React 18 + TypeScript + React Router + Arco Design + Tailwind CSS。

- [x] Vite + React + TS 工程
- [x] Tailwind + Arco 主题接入（dark 默认，等宽字体 JetBrains Mono / Fira Code）
- [x] 路由骨架：`/` 首页、`/lab` 前端 demo 实验室、`/posts` 文章、
       `/posts/:slug` 单篇、`/inspirations` 小灵感、`/about` 关于
- [x] 终端风首屏：打字机欢迎语 + ASCII logo + 闪烁光标
- [x] 文章模块：从 `apps/server` 拉 markdown，前端用 `react-markdown` + 代码高亮渲染
- [x] 小灵感：瀑布流卡片
- [ ] 前端 demo 实验室：先放一两个小 demo（粒子背景 / 噪声 shader），后续慢慢加
- [ ] PWA（可选，后置）

## Phase 2 — `apps/admin` 管理后台

- [x] Vite + React + TS + Arco Design Pro 风格
- [x] `/login` 账密登录，调用 `/api/admin/auth/login` 拿 JWT
- [x] 鉴权 axios 拦截器（401 跳登录）
- [x] 业务模块：文章管理、小灵感管理、站点设置（路由按模块拆 `/posts` `/inspirations` `/settings`）
- [ ] 富文本/Markdown 编辑（用 `@uiw/react-md-editor` 或 Arco 自带）
- [ ] 图片上传到服务器（先 placeholder）

## Phase 3 — `apps/server` 后端

技术栈复用 `Python-cli`（FastAPI + uvicorn/gunicorn + SQLAlchemy async + asyncmy + Redis）。

- [x] 从 Python-cli 复制基础：`main.py / common / middlewares / dependencies / db`
- [x] 业务模块化：`app/modules/<name>/{router,service,repository,schema}.py`
- [x] 模块路由前缀：
  - `/api/public/posts` 公开文章 (web 读)
  - `/api/public/inspirations` 公开小灵感 (web 读)
  - `/api/admin/auth/login` 登录拿 JWT
  - `/api/admin/posts` 文章 CRUD（需 JWT）
  - `/api/admin/inspirations` 小灵感 CRUD（需 JWT）
- [x] JWT 鉴权 dependency（替换 Python-cli 里的 Bearer api key）
- [x] 管理员账号：写在 `config-prod.yml` / 环境变量里，密码 bcrypt 哈希
- [x] PostgreSQL 持久化 + Alembic 迁移（asyncpg + SQLAlchemy 2.0 async；本地 docker-compose）
- [ ] 文件上传接口（图片 / markdown 附件）

## Phase 4 — 部署

- [x] `.github/workflows/deploy-pages.yml`：构建 web + admin 并打包成单个 `dist/`，
      `web` 放根、`admin` 放 `admin/`，发布到 `gh-pages` 分支
- [x] `scripts/deploy-server.sh`：本地打包 → `rsync` 到 `openclaw:~/apps/Tenggouwa-server/`
      → 远端 `systemctl --user restart tenggouwa-server`
- [ ] 服务器 nginx 配置示例（`deploy/nginx/tenggouwa.conf`）反代 `/api -> 127.0.0.1:10095`
- [ ] systemd user unit 模板（`deploy/systemd/tenggouwa-server.service`）

## Phase 5 — 未来扩展（占位）

- [ ] 评论 / 留言（依赖第三方 OR 自建）
- [ ] RSS / sitemap
- [ ] 访问统计（self-hosted umami 或简单 hit 计数）
- [ ] 第二个前端项目（在 `apps/<new-project>` 加目录即可挂到子路径）

---

## 当前一轮验收（本次会话目标）

跑通骨架：
1. 三个 app（`web` / `admin` / `server`）都能本地启动
2. web 极客风首页能渲染、能列出文章占位
3. admin 能登录 → 看到空的文章列表
4. server 用内存存储实现一套 posts + inspirations + auth，端到端联通
