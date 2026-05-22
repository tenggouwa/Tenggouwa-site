---
slug: mcp-and-agent-sdk
title: MCP & Agent SDK：今天构建 agent 的事实标准
summary: AI 系列第 16 篇。2024 年底 Anthropic 发布 MCP（Model Context Protocol），2025 年 Agent SDK 陆续出现。这一篇讲清楚 MCP 是什么、为什么有人喊它"AI 时代的 HTTP"、以及它和 OpenAI Function Calling 怎么共存。
tags: [ai, mcp, agent-sdk, anthropic, ai-series]
published_at: 2026-06-06
---

> AI 系列第 16 篇。上一篇我们看了 agent 范式。这一篇看构建 agent 的事实标准——MCP 和 Agent SDK。

## 0. 一个一直没解决的工程问题

在 MCP 之前，要让 LLM 调用一个新工具，每个团队都要重复造轮子：

```
A 公司用 GPT-4o:    写 OpenAI function calling schema
B 公司用 Claude:    写 Anthropic tool use schema
C 公司用 Gemini:    写 Google function schema
D 公司用 Llama:     自己整一套 prompt 协议
```

每换一个模型，工具适配层就要重写。每个工具又要适配 N 家模型。**N × M 适配问题**。

如果我们能搞一个**标准协议**，让"工具发布者"和"模型调用方"用同一种语言对话——这就是 MCP 想做的事。

---

## 1. MCP 是什么

**MCP（Model Context Protocol）** 是 Anthropic 在 **2024 年 11 月** 发布的开源协议。

简而言之：

> **MCP 给 LLM 应用和外部工具/数据源之间，定义了一套标准的通信协议。**

类比理解：

- HTTP 之于 web：每个网页不用关心 server 用什么语言写的，浏览器都能渲染。
- MCP 之于 AI：每个 agent 不用关心工具是 Python / Go / Rust 写的，只要工具符合 MCP，agent 都能调。

### MCP 的核心组件

```
┌──────────────────────────────────────────────────┐
│  MCP Host (Claude Desktop / IDE / Custom App)    │
│                                                  │
│  ┌──────────────────┐                           │
│  │  MCP Client      │                           │
│  └──────────────────┘                           │
│       │                                          │
│       │ JSON-RPC over stdio/SSE/HTTP            │
│       ▼                                          │
└──────────────────────────────────────────────────┘
        ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ MCP Server     │  │ MCP Server     │  │ MCP Server     │
│ (Filesystem)   │  │ (GitHub)       │  │ (Database)     │
└────────────────┘  └────────────────┘  └────────────────┘
```

- **Host**：用户面对的 AI 应用（Claude Desktop、Cursor、自家产品）。
- **Client**：Host 内部的 MCP 客户端，负责和 Server 通信。
- **Server**：暴露具体能力的进程。可以是本地脚本、远程 HTTP 服务、甚至云函数。

### MCP 暴露的三类能力

1. **Tools**（函数）：可执行的操作。和 OpenAI function calling 同概念。
2. **Resources**（资源）：可读的数据源。例如文件、数据库表。
3. **Prompts**（提示模板）：预定义的 prompt 模板。

---

## 2. 一个最小可运行的 MCP Server

写一个暴露"读文件"工具的 MCP server（Python 版）：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-fs-server")

@mcp.tool()
def read_file(path: str) -> str:
    """读取本地文件的内容。"""
    return open(path).read()

@mcp.tool()
def list_dir(path: str) -> list[str]:
    """列出目录中的文件。"""
    import os
    return os.listdir(path)

if __name__ == "__main__":
    mcp.run()
```

跑起来后，任何支持 MCP 的客户端（Claude Desktop / Cursor / ...）通过配置就能用：

```json
{
  "mcpServers": {
    "my-fs": {
      "command": "python",
      "args": ["my_fs_server.py"]
    }
  }
}
```

**重点**：你写一次 server，所有支持 MCP 的客户端都能用。**M×N → M+N 的复杂度坍塌**。

---

## 3. MCP 现在有多火

发布一年多（2024.11 → 2026.05），MCP 生态：

- **官方实现**：Python / TypeScript / Rust / Go / C# SDK
- **官方支持**：Anthropic Claude Desktop、Claude Code、Claude API
- **第三方采用**：Cursor、Zed、Windsurf、Continue、Cline、Sourcegraph、Bloop...
- **MCP 服务器市场**：mcp.so 上几千个开源 server，覆盖 GitHub / Slack / Jira / PostgreSQL / Notion / 文件系统 / shell / 浏览器自动化 / ...

**2025 年 3 月**，OpenAI 宣布 Agents SDK 支持 MCP。**2025 年 5 月**，Google 在 Gemini API 中支持 MCP。这一刻起，MCP 从"Anthropic 的协议"变成了**事实标准**。

### MCP vs OpenAI Function Calling

很多人问：它们冲突吗？

答案：**不冲突**。它们在不同层：

- **Function Calling**：一次 LLM API 调用的协议。模型怎么"表达"它要调工具。
- **MCP**：工具如何被发现、连接、管理的协议。

实际工程中：

```
LLM (任何模型)
   │
   │ function calling API
   ▼
应用代码
   │
   │ MCP protocol
   ▼
MCP Server (工具实现)
```

LLM 还是用 function calling 返回 tool_call → 应用代码把这个 tool_call 翻译成 MCP 调用 → MCP Server 执行 → 结果回传。

> 一句你可以拿去吹的话：
> **Function calling 是"模型 ↔ 应用"的协议；MCP 是"应用 ↔ 工具"的协议。两件事，互补。**

---

## 4. Agent SDK：在 MCP 之上的高阶抽象

MCP 解决了"工具协议"。但还有更高层的问题——

- agent 循环怎么写？
- state 怎么管？
- 多 agent 协作怎么编排？

这就是 **Agent SDK** 的角色。

### 主流 Agent SDK

#### Anthropic Claude Agent SDK (2025)

Anthropic 官方。专门为 Claude 优化。

```python
from claude_agent_sdk import Agent

agent = Agent(
    model="claude-opus-4-7",
    tools=[...],
    mcp_servers=["./fs_server.py"],
    max_iterations=50
)

result = agent.run("帮我重构 src/ 下所有 React 组件，把 class component 改成 hooks。")
```

特点：内建 MCP 支持、内建 thinking 模式、文件系统 sandboxing。

#### OpenAI Agents SDK (2025)

OpenAI 官方。原 Swarm 的进化版。

```python
from openai.agents import Agent, Runner

triage = Agent(name="Triage", instructions="...", handoffs=[support, sales])
support = Agent(name="Support", instructions="...")
sales = Agent(name="Sales", instructions="...")

result = Runner.run(triage, "我想买你们的企业版")
# triage 自动 handoff 给 sales agent
```

特点：handoff 机制（agent 间转交）、guardrails（安全护栏）、tracing。

#### LangGraph (LangChain)

开源最流行的。Graph-based state machine。

```python
from langgraph.graph import StateGraph

graph = StateGraph(MyState)
graph.add_node("plan", planner)
graph.add_node("execute", executor)
graph.add_node("check", checker)
graph.add_edge("plan", "execute")
graph.add_conditional_edges("check", lambda s: "execute" if s.failed else END)

app = graph.compile()
```

特点：可视化 graph、好做复杂分支、对接所有模型。

#### Pydantic AI / DSPy / CrewAI / AutoGen

各有侧重：
- Pydantic AI：类型安全 + 结构化输出
- DSPy：自动 prompt 优化
- CrewAI：multi-agent 协作
- AutoGen：Microsoft 的 multi-agent

### 怎么选？

| 场景 | 推荐 |
|---|---|
| 用 Claude，简单 agent | Claude Agent SDK |
| 用 OpenAI，多 agent handoff | OpenAI Agents SDK |
| 复杂 workflow，需要可视化 | LangGraph |
| 需要类型安全 | Pydantic AI |
| 跨模型，开源优先 | LangGraph 或 LlamaIndex |

---

## 5. MCP 的真实价值与挑战

### 真实价值

#### 价值 1：可移植性

写一次 MCP Server，可以被 Claude / Cursor / Cline / 自家 app 复用。**生态网络效应**开始显现。

#### 价值 2：本地工具的"App Store"

mcp.so 已经几千个 server。需要 GitHub 集成？装一个。需要 Slack？装一个。**像装浏览器插件一样装 agent 能力**。

#### 价值 3：安全边界

每个 MCP Server 是独立进程。可以做细粒度权限控制：A server 只读，B server 能写但要确认。比"LLM 直接执行 shell"安全得多。

#### 价值 4：组织内复用

公司 SRE 团队写一个 MCP Server 暴露内部 API → 全公司所有 AI 应用都能用。**消除重复造轮子**。

### 挑战

#### 挑战 1：authentication 标准还不成熟

每个 MCP Server 自己处理 auth，没统一规范。今年（2026）OAuth 2.0 集成草案在推。

#### 挑战 2：performance

MCP 是 JSON-RPC。每次调用都有序列化/反序列化开销。高频调用场景下不如 in-process function call。

#### 挑战 3：版本管理

工具 schema 变了，所有客户端怎么知道？目前还靠人肉协调。

#### 挑战 4：discovery

我有 100 个 MCP Server 装着，哪个工具该用？现在还是人配。未来需要 LLM 自动 discover。

---

## 6. 2026 的 Agent 技术栈长什么样

把这几篇串起来，看一个生产级 agent 的完整 stack：

```
┌────────────────────────────────────────────────────────────┐
│  应用层    Claude Desktop / Custom UI                       │
├────────────────────────────────────────────────────────────┤
│  Agent SDK Claude Agent SDK / LangGraph / OpenAI Agents     │
│    └─ 管理 loop, state, multi-agent, observability         │
├────────────────────────────────────────────────────────────┤
│  Tool 协议层   MCP（Model Context Protocol）                 │
│    └─ 工具如何暴露、连接、管理                                │
├────────────────────────────────────────────────────────────┤
│  LLM 接口层    OpenAI / Anthropic / Google / Local API       │
│    └─ Function calling、Structured Outputs、Streaming        │
├────────────────────────────────────────────────────────────┤
│  Model 层      Claude Opus 4.7 / GPT-5 / Gemini 2 / Llama 4 │
│    └─ 实际推理引擎                                           │
└────────────────────────────────────────────────────────────┘
```

每一层都有标准接口。每一层都可以独立换。这就是工程化的体现——**从"炼丹"到"装配"的转变**。

> 一句你可以拿去吹的话：
> **2024 之前的 AI 应用是 "ChatGPT wrapper"。2026 的 AI 应用是 "Agent + MCP + Tools" 的工程化系统。这之间的差距，和 1995 vs 2005 的 web 开发差距一样大。**

---

## 7. 给你的小作业

1. **写一个最简单的 MCP Server，暴露 `get_current_time()` 工具。**
2. **解释 MCP 和 OpenAI function calling 是怎么共存的，而不是替代关系。**
3. **如果你公司 5 个产品都要接 AI，是各自实现 tool，还是统一搞一套 MCP Server？给三个理由。**

> **下一篇钩子**：到这里我们已经能做出能跑的 agent。
> 但**怎么知道你的 agent 真的好**？怎么衡量"GPT-5 比 GPT-4 强"这种说法？
> 下一篇我们讲 **Evals**——AI 工程里最被低估、又最难做对的一块。
