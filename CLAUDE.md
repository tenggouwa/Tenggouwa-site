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

## 设计风格（必须遵守，apps/web 所有视觉都按这套来）

整站风格是 **暗色终端 / 极客 / CRT 复古**，任何新页面、组件、弹层都要钉死在这套
design system 里。视觉决策有疑问的时候，参考 [Layout.tsx](apps/web/src/components/Layout.tsx)
和 [SearchModal.tsx](apps/web/src/components/SearchModal.tsx) 这两个范本。

**颜色**只用 [tailwind.config.ts](apps/web/tailwind.config.ts) 里的 `terminal-*` 色板：

- 背景：`terminal-bg`（深底）/ `terminal-panel`（次级面板）
- 主体文字：`terminal-gray`；次级 `text-terminal-gray/70` 透明度
- 强调：`terminal-green`（成功 / 标题 / hover 主色）、`terminal-cyan`（链接 / 次强调）
- 装饰：`terminal-pink`（prompt `~$`）、`terminal-yellow`（高亮 / `<mark>` / warning）
- 分隔线：`border-terminal-line/60`
- **禁止**：Tailwind 默认 gray-* / blue-* / red-* 等；除非状态色（红/黄/绿警示信号）

**字体**：JetBrains Mono / SF Mono / Menlo monospace（`font-mono`，已在 tailwind 里）。
正文也是 mono。**禁止**改成 sans-serif 体。

**装饰元素**（这些是项目签名，必须用）：

- 区段标题用 shell 命令视觉：`~$` / `$ ` prompt + `cat / grep / cd / ls` 等命令名
  - 例：列表页 `$ cat posts/*.md`；搜索页 `$ grep -r <keyword> .`
  - prompt 用 `text-terminal-pink`，命令用 `text-terminal-green`
- 任何 modal / panel 顶部加 **mac 红黄绿三色点** title bar（`#ff5f57 / #febc2e / #28c840`）
  + 一行 path 文字（如 `~/search`）
- 卡片 / panel 外框：`border-terminal-line` + 可选 `boxShadow.glow`（绿色淡 glow）
- 高亮命中词：`<mark class="bg-terminal-yellow/30 text-terminal-yellow">`
- 键盘提示一律用 `<kbd>` + 边框圆角，参考 SearchModal 里的 `Kbd` 组件
- 链接 hover 用 `hover:text-terminal-green`，不要色调跳到别的色系

**禁忌**（出现一次就算违反，等于 SearchModal 第一版翻车）：

- **不要直接用 Arco 原生 Modal**——它的默认背景白调跟暗色主题打架。要弹层就自绘
  fixed overlay（参考 SearchModal），不行就把 Arco 组件的样式深度覆盖
- **不要 emoji 当主图标**（`🔍` `📝` `🚀` 之类）。要图标用 inline SVG 线条图（细描边、
  `stroke-current`），跟终端风的字符画一致
- **不要圆形头像 / 阴影立体拟物 / 渐变彩色按钮**
- **不要硬编码灰色 / 蓝色 hex**（`#888 / #007aff` 等）；都走 terminal-* 变量

每次给 apps/web / apps/admin 加新视觉组件**前**，先扫一眼现有的
[Layout.tsx](apps/web/src/components/Layout.tsx) /
[PostList.tsx](apps/web/src/pages/PostList.tsx) /
[SearchModal.tsx](apps/web/src/components/SearchModal.tsx)
确认色板和装饰风一致再动手。

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
