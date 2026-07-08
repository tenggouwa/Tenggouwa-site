# agent 平台 · 设计文档 (draft)

> 把现在挤在 web `/ask` 里的知识库问答拆开，做成 `apps/agent` 独立前端项目，复用
> `apps/server` 后端。远期：整个项目 = 一个 agent（ask 是对话面，skills 是工具，
> 知识库是其中一个 skill）。方向背景见记忆 [[project_agent_app]]。

## 定的 4 件事（2026-07-07）
1. **复用** `apps/server`（新 app 只做前端 + 后端加 `skills`/`agent` 模块；不重造后端）。
2. 新 app 名 = **`apps/agent`**，挂子路径 `/agent/`（同 casino）。
3. 知识库/skills/ask 页 **公开**（无鉴权）。
4. v1 先把 **「KB-as-skill + agent 对话（tool-calling）」一条链跑通**，再泛化 skills。

## 三块积木
```
ask 页        —— 跟 agent 对话（M1：先直接问 KB；M4：升级成 tool-calling agent）
knowledge-base 页 —— 管理/浏览知识库本身（源/文档/chunk/reindex）
skills 页     —— agent 能调的工具注册表（kb.search 是第一个）
```
核心升级：现在 `/ask` 是写死的「检索→生成」；agent 版是 **LLM 用 function-calling 自己决定**
要不要调 `kb.search` / 调哪个 skill。DeepSeek chat 支持 function calling。

## 里程碑
- **M1（本 PR）✅**：脚手 `apps/agent`（Vite+React+TS+Tailwind 终端风），3 页 + nav，
  接进 monorepo（workspace / build-pages `/agent/` / ci / deploy-pages）。Ask 页先复用
  现有 `/api/public/kb/ask`（day-1 可用）；KnowledgeBase / Skills 先占位壳。
- **M2 知识库页**：后端加 KB 只读接口（列源/文档/chunk 数/最近同步）+ 公开 reindex 触发；
  前端渲染 + 块浏览。
- **M3 skills 抽象**：`apps/server` 加 skill 注册表（每个 skill = name + JSON schema + handler），
  `kb.search` 是第一个；`GET /api/public/skills` 列表；skills 页动态渲染。
- **M4 agent 对话（tool-calling）**：`POST /api/public/agent/chat`（SSE）——把 skills 作为 tools
  传给 DeepSeek，模型决定调用→执行→回填→续答；ask 页接这个，取代直接问 KB。

## 后端落位（apps/server，复用）
- 已有：`modules/kb`（检索/生成/reindex）。
- 新增：`modules/skills`（注册表 + tool schema，把 `kb.search` 包成一个 skill）、
  `modules/agent`（tool-calling 循环，调用 `provider.ChatLLM` 的 function-calling）。

## 已知待办 / 坑
- agent 子路由深链（/agent/knowledge-base 冷加载）目前 bounce 回 /agent/（同 casino，
  restore 脚本未做）——M2/M3 前若要分享子页链接再补。
- 主站 web 的 `/ask` 页：待 agent 平台成型后，决定是重定向到 /agent/ 还是保留。
