"""Skills 编排：列出 skill、给 agent 循环提供 tool schema 与 handler 调度。

原生 skill（registry）在前、顺序固定；MCP server 工具追加在后、已确定性排序——
合起来的 tools 前缀稳定（prompt cache）。MCP 未配置时 mcp_manager 为空，行为完全不变。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..mcp.manager import mcp_manager
from .base import tool_schema
from .registry import REGISTRY
from .schema import SkillInfo


class SkillsService:
    def list_skills(self) -> list[SkillInfo]:
        return [SkillInfo(name=s.name, description=s.description, parameters=s.parameters) for s in REGISTRY.values()]

    def tools(self) -> list[dict]:
        """function-calling 的 tools 列表（agent 传给 LLM）：原生 skill + MCP 工具。"""
        return [tool_schema(s) for s in REGISTRY.values()] + mcp_manager.tools()

    async def invoke(self, session: AsyncSession, name: str, args: dict) -> str:
        """执行一个 skill / MCP 工具；未知返回错误字符串（不抛，交给 agent 续答）。"""
        if mcp_manager.has(name):
            return await mcp_manager.invoke(name, args)
        skill = REGISTRY.get(name)
        if skill is None:
            return f"（未知 skill: {name}）"
        return await skill.handler(session, args)


skills_service = SkillsService()
