# @tenggouwa/agent

独立部署在 `/agent/` 的个人 AI Agent 前端。当前包含三个页面：对话、概念图谱和 skill 目录。

## 能力

- SSE 流式回答、Markdown、引用、计划、tool status 和停止运行。
- 普通/深度思考模式；深度思考使用 `deepseek-reasoner` 并折叠展示 reasoning。
- 公开通道提供只读问答、知识库、图谱、Web 和子代理能力。
- TOTP 解锁私有通道后，可使用会话续聊、长期记忆、文件/shell/git、MCP 和审批流。
- 高危工具先显示 `ApprovalCard`；批准后执行，拒绝后把拒绝结果交回模型继续处理。
- Graph 页面展示全量力导向概念图，支持邻域聚焦、拖拽固定和系列过滤。

## 本地运行

后端默认使用 `VITE_API_BASE`；未设置时按前端 API helper 的开发默认值处理。

```bash
# 仓库根目录
pnpm dev:agent
pnpm --filter @tenggouwa/agent test
pnpm --filter @tenggouwa/agent build
```

Vite 端口和部署 base 见 `vite.config.ts`。不要在路由或资源路径中硬编码 `/agent/`，统一使用
`import.meta.env.BASE_URL` / Router basename。

## 后端通道

| 通道 | 用途 | 能力边界 |
| --- | --- | --- |
| `/api/public/agent/chat` | 无登录公开问答 | readonly 原生 skill |
| `/api/public/agent/unlock` | TOTP 换取 private token | 返回 owner-scoped token |
| `/api/agent/chat` | 私有对话 | owner 数据、高危 skill、MCP |
| `/api/agent/sessions*` | 会话列表/详情/删除 | 仅当前 owner |
| `/api/agent/memories*` | 长期记忆列表/删除 | 仅当前 owner |

完整请求链路和信任边界见 [docs/architecture.md](../../docs/architecture.md)。

## 关键约束

- 工具顺序影响 prompt cache；新增原生 skill 只能追加到 registry 尾部。
- 只有显式标记 `parallel_safe` 且不共享 DB session 的 readonly 工具才允许同批并发；
  KB、子代理、write 和 MCP 工具保守串行。
- 私有能力必须由后端鉴权和工具注册共同限制，不能只靠前端隐藏。
- 每个 Agent bug 都应补确定性回归场景；模型路由行为加入 nightly live eval。
- 视觉保持项目的 terminal/CRT design system，不引入 Arco 默认白色 Modal。

历史设计和分阶段实现见 [docs/agent/agent-roadmap.md](../../docs/agent/agent-roadmap.md)。
