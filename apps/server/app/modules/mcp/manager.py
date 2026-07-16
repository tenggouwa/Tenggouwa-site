"""MCP 客户端连接管理：app lifespan 里长连信任的 server，把其 tool 桥接给 agent。

安全（见 docs/agent/agent-roadmap.md B2）：只连 MCP_SERVERS 白名单里的 server；未配置则完全 inert
（不连接、不拉子进程、零 prod 变化）。单 server 连接/列举失败隔离降级，不拖垮整个 agent。
"""

import asyncio
import json
import logging
import os
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from .bridge import content_to_text, mcp_tool_to_openai, openai_tool_name

logger = logging.getLogger(__name__)

# 连接 + initialize 的硬超时（秒）。**这条是启用真 server 的前置**：MCP 在 app lifespan 里连，
# 没有超时的话，一个 hang 住/首次要下载依赖的 server 就能让 FastAPI 永远起不来 = 整站挂。
# 宁可跳过这个 server 跑起来（agent 少几个工具），也不能让站起不来。env 可调。
_CONNECT_TIMEOUT = float(os.environ.get("MCP_CONNECT_TIMEOUT") or 20.0)
_LIST_TIMEOUT = float(os.environ.get("MCP_LIST_TIMEOUT") or 10.0)  # list_tools 同理，别卡在启动/刷新
_CALL_TIMEOUT = float(os.environ.get("MCP_CALL_TIMEOUT") or 30.0)  # 单次工具调用；超时收敛成结果，不吊死本轮


def load_configs() -> list[dict]:
    """从 env MCP_SERVERS 读白名单 server 配置（JSON 数组）。空/非法 → []（禁用 MCP）。

    每项：{"name","transport":"stdio"|"http", stdio:{"command","args","env"} / http:{"url"}}。
    """
    raw = (os.environ.get("MCP_SERVERS") or "").strip()
    if not raw:
        return []
    try:
        cfgs = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("MCP_SERVERS 不是合法 JSON，忽略")
        return []
    if not isinstance(cfgs, list):
        return []
    return [c for c in cfgs if isinstance(c, dict)]  # 过滤非 dict 项，防手误崩全站启动


class MCPManager:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self._sessions: dict[str, ClientSession] = {}
        self._server_auto: dict[str, bool] = {}  # server -> 是否 auto 信任（其工具免审批）
        self._tools: list[dict] = []  # 已确定性排序的 OpenAI tools
        self._route: dict[str, tuple[str, str]] = {}  # openai_name -> (server, mcp_tool_name)
        self._auto: set[str] = set()  # 免审批的工具名（来自 auto 信任的 server）

    async def start(self) -> None:
        configs = load_configs()
        if not configs:
            return  # 未配置 → 完全 inert
        for cfg in configs:
            name = cfg.get("name", "?")
            try:
                # 硬超时：hang 住的 server 绝不能卡死 lifespan（否则整站起不来）
                await asyncio.wait_for(self._connect(cfg.get("name", ""), cfg), timeout=_CONNECT_TIMEOUT)
            except TimeoutError:
                logger.error("MCP server %s 连接/初始化超过 %.0fs，跳过（站照常起）", name, _CONNECT_TIMEOUT)
            except Exception:  # noqa: BLE001 —— 单 server 失败不该拖垮 agent / app 启动
                logger.exception("MCP server %s 连接失败，跳过", name)
        await self.refresh_tools()
        logger.info("MCP 已连 %d 个 server，暴露 %d 个工具", len(self._sessions), len(self._tools))

    async def _connect(self, name: str, cfg: dict) -> None:
        if cfg.get("transport", "stdio") == "http":
            read, write, _ = await self._stack.enter_async_context(streamablehttp_client(cfg["url"]))
        else:
            params = StdioServerParameters(command=cfg["command"], args=cfg.get("args", []), env=cfg.get("env"))
            read, write = await self._stack.enter_async_context(stdio_client(params))
        session = await self._stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        self._sessions[name] = session
        self._server_auto[name] = bool(cfg.get("auto", False))  # 未标 auto 的 server 其工具需审批

    async def refresh_tools(self) -> None:
        """重列所有 server 的工具，按 (server, tool) 确定性排序后合并——稳住 prompt cache 前缀。"""
        pairs = []
        for name, session in self._sessions.items():
            try:
                resp = await asyncio.wait_for(session.list_tools(), timeout=_LIST_TIMEOUT)
            except TimeoutError:
                logger.error("MCP server %s list_tools 超过 %.0fs，跳过", name, _LIST_TIMEOUT)
                continue
            except Exception:  # noqa: BLE001
                logger.exception("MCP server %s list_tools 失败", name)
                continue
            for t in resp.tools:
                pairs.append((openai_tool_name(name, t.name), name, t))
        pairs.sort(key=lambda p: p[0])
        self._tools, self._route, self._auto = [], {}, set()
        for oai, srv, t in pairs:
            if oai in self._route:  # sanitize/截断可能撞名 → 跳过后者，防路由覆盖 + LLM 收到重名 function
                logger.warning("MCP 工具名冲突，跳过重复: %s", oai)
                continue
            self._tools.append(mcp_tool_to_openai(srv, t.name, t.description, t.inputSchema))
            self._route[oai] = (srv, t.name)
            if self._server_auto.get(srv):
                self._auto.add(oai)

    def tools(self) -> list[dict]:
        return list(self._tools)

    def status(self) -> dict:
        """连了哪些 server、暴露了哪些工具、哪些免审批。

        MCP 工具只在私有通道暴露、启动日志又是 INFO（prod 过滤掉了）——不给个说法就完全是黑盒，
        「到底连上没、桥了几个工具」只能靠猜。运维/排障入口。
        """
        return {
            "configured": len(load_configs()),
            "connected": sorted(self._sessions),
            "tools": [
                {"name": n, "server": srv, "auto": n in self._auto} for n, (srv, _t) in sorted(self._route.items())
            ],
        }

    def catalog(self) -> list[dict]:
        """只要「名字 + 一句话」的轻目录（渐进披露用）：常驻上下文的是它，不是完整 schema。

        一个 MCP 工具的完整 schema 动辄一两百 token（别人写的，参数可能很啰嗦），而目录项只要十几个。
        模型先看目录、要用哪个再 load_tools 拉 schema。
        """
        out = []
        for oai in sorted(self._route):
            full = next((t for t in self._tools if t["function"]["name"] == oai), None)
            desc = (full or {}).get("function", {}).get("description") or ""
            out.append({"name": oai, "description": desc.strip().splitlines()[0][:100] if desc else ""})
        return out

    def tools_by_names(self, names: list[str]) -> list[dict]:
        """按名字取完整 schema（load_tools 之后才把这些塞进 tools）。未知名忽略。"""
        want = set(names)
        return [t for t in self._tools if t["function"]["name"] in want]

    def has(self, name: str) -> bool:
        return name in self._route

    def is_auto(self, name: str) -> bool:
        """该 MCP 工具是否来自 auto 信任的 server（免审批）。"""
        return name in self._auto

    async def invoke(self, name: str, args: dict) -> str:
        srv, tool = self._route[name]
        try:  # 外部 server 卡住不能把 agent 这一轮永远吊死；超时收敛成工具结果，让模型继续
            result = await asyncio.wait_for(self._sessions[srv].call_tool(tool, arguments=args), timeout=_CALL_TIMEOUT)
        except TimeoutError:
            logger.warning("MCP 工具 %s 超过 %.0fs 无响应", name, _CALL_TIMEOUT)
            return f"（{name} 超过 {_CALL_TIMEOUT:.0f}s 无响应，已放弃。）"
        return content_to_text(
            result.content,
            is_error=bool(getattr(result, "isError", False)),
            structured=getattr(result, "structuredContent", None),
        )

    async def stop(self) -> None:
        await self._stack.aclose()
        self._sessions.clear()
        self._server_auto.clear()
        self._tools = []
        self._route = {}
        self._auto = set()


mcp_manager = MCPManager()
