# CLAUDE.md

Tenggouwa-site 是一个 monorepo：

- `apps/web` —— 个人网站，挂 GitHub Pages 根路径。技术栈：Vite + React 18 + TS + React Router + Arco Design + Tailwind。
- `apps/admin` —— 管理后台，挂 GitHub Pages 的 `/admin` 子路径。技术栈同上。
- `apps/server` —— FastAPI 后端，基于 `Python-cli` 脚手架（FastAPI + uvicorn/gunicorn + SQLAlchemy async + Redis），部署到阿里云（`ssh openclaw`）。
- `packages/*` —— 占位，未来放共享类型。
- `scripts/*` —— 部署、构建辅助脚本。
- `deploy/*` —— nginx / systemd 模板。

## 协作约定（与 Python-cli 保持一致 + 前端补充）

通用：

- 中文对话；专有名词保留英文。
- 不引入未要求的功能、抽象或回退逻辑；不必要的注释不要写。
- 前端文件路径引用使用 markdown 链接 `[a.tsx](apps/web/src/a.tsx)`。

后端（Python，沿用 Python-cli）：

- Python 3.12 + `uv` 管理依赖；编辑 `pyproject.toml` 后 `uv sync`。
- 使用 `ruff` 格式化和检查；120 列；google 风格 docstring。
- 不用 `Optional` / `Union` / `Dict` / `List`；用 `X | Y` / `dict[X, Y]` / `list[X]`。
- 从 `collections.abc` 导入抽象基类。
- `logger.exception("...")` 而非 `logger.error(f"...: {e}")`。
- 时区用 `zoneinfo.ZoneInfo`。
- 模块按业务拆 `app/modules/<name>/{router,service,repository,schema}.py`，
  每个模块的 router 在 `app/modules/__init__.py` 里聚合到 `/api` 下。

前端（Vite + React + Arco + Tailwind）：

- 严格 TS，`strict: true`。
- 单引号、2 空格缩进、行尾 LF（见 `.editorconfig`）。
- 组件文件用 `PascalCase.tsx`，hooks 用 `useXxx.ts`，工具函数 `camelCase.ts`。
- 路由 base 通过 `import.meta.env.BASE_URL` 兜底；硬编码会让子路径部署炸掉。
- Arco 主题在 `src/styles/arco.css` 里通过 CSS 变量覆盖。
- Tailwind 与 Arco 共存时：Tailwind 用于 layout / spacing / typography 工具类，
  Arco 用于业务组件；不要用 Tailwind preflight 强行重置 Arco 的样式。

## 常用命令

```bash
# 安装
pnpm install

# 前端开发
pnpm dev:web
pnpm dev:admin

# 后端开发
cd apps/server && ./setup_dev_env.sh   # 首次
source apps/server/.venv/bin/activate
cd apps/server/app && python main.py

# 前端打包并组装 Pages 产物
pnpm build:pages

# 部署后端到 openclaw
pnpm deploy:server
```
