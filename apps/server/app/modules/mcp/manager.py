"""MCP 客户端连接管理：app lifespan 里长连信任的 server，把其 tool 桥接给 agent。

安全（见 docs/agent/agent-roadmap.md B2）：只连 MCP_SERVERS 白名单里的 server；未配置则完全 inert
（不连接、不拉子进程、零 prod 变化）。单 server 连接/列举失败隔离降级，不拖垮整个 agent。
"""

import json
import logging
import os
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from .bridge import content_to_text, mcp_tool_to_openai, openai_tool_name

logger = logging.getLogger(__name__)


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
        self._tools: list[dict] = []  # 已确定性排序的 OpenAI tools
        self._route: dict[str, tuple[str, str]] = {}  # openai_name -> (server, mcp_tool_name)

    async def start(self) -> None:
        configs = load_configs()
        if not configs:
            return  # 未配置 → 完全 inert
        for cfg in configs:
            try:
                await self._connect(cfg.get("name", ""), cfg)
            except Exception:  # noqa: BLE001 —— 单 server 失败不该拖垮 agent / app 启动
                logger.exception("MCP server %s 连接失败，跳过", cfg.get("name", "?"))
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

    async def refresh_tools(self) -> None:
        """重列所有 server 的工具，按 (server, tool) 确定性排序后合并——稳住 prompt cache 前缀。"""
        pairs = []
        for name, session in self._sessions.items():
            try:
                resp = await session.list_tools()
            except Exception:  # noqa: BLE001
                logger.exception("MCP server %s list_tools 失败", name)
                continue
            for t in resp.tools:
                pairs.append((openai_tool_name(name, t.name), name, t))
        pairs.sort(key=lambda p: p[0])
        self._tools, self._route = [], {}
        for oai, srv, t in pairs:
            if oai in self._route:  # sanitize/截断可能撞名 → 跳过后者，防路由覆盖 + LLM 收到重名 function
                logger.warning("MCP 工具名冲突，跳过重复: %s", oai)
                continue
            self._tools.append(mcp_tool_to_openai(srv, t.name, t.description, t.inputSchema))
            self._route[oai] = (srv, t.name)

    def tools(self) -> list[dict]:
        return list(self._tools)

    def has(self, name: str) -> bool:
        return name in self._route

    async def invoke(self, name: str, args: dict) -> str:
        srv, tool = self._route[name]
        result = await self._sessions[srv].call_tool(tool, arguments=args)
        return content_to_text(
            result.content,
            is_error=bool(getattr(result, "isError", False)),
            structured=getattr(result, "structuredContent", None),
        )

    async def stop(self) -> None:
        await self._stack.aclose()
        self._sessions.clear()
        self._tools = []
        self._route = {}


mcp_manager = MCPManager()
