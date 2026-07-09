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
        """公开列出可用 skill：只列非 private 的（private 工具仅私有通道可见，别在公开页泄漏）。"""
        return [
            SkillInfo(name=s.name, description=s.description, parameters=s.parameters)
            for s in REGISTRY.values()
            if not s.private
        ]

    def tools(self, *, privileged: bool = False) -> list[dict]:
        """function-calling 的 tools 列表（agent 传给 LLM）。

        公开通道（privileged=False）只暴露既 readonly 又非 private 的原生 skill；私有（鉴权）
        通道额外给 write / private 原生 skill + MCP 工具。这是唯一的能力暴露点——LLM 只能调用
        列表里的工具，所以公开端点天然拿不到高危 / 私有工具（invoke 再做一层纵深兜底）。
        """
        native = [tool_schema(s) for s in REGISTRY.values() if privileged or (s.risk == "readonly" and not s.private)]
        return native + (mcp_manager.tools() if privileged else [])

    async def invoke(self, session: AsyncSession, name: str, args: dict, *, privileged: bool = False) -> str:
        """执行一个 skill / MCP 工具；未知 / 越权返回错误字符串（不抛，交给 agent 续答）。

        纵深防御：即便模型幻觉出一个公开通道不该有的高危工具名，这里也拒绝执行。
        """
        if mcp_manager.has(name):
            if not privileged:
                return f"（{name} 是外部 MCP 工具，仅在鉴权的私有通道可用，公开通道不执行。）"
            return await mcp_manager.invoke(name, args)
        skill = REGISTRY.get(name)
        if skill is None:
            return f"（未知 skill: {name}）"
        if not privileged and (skill.risk == "write" or skill.private):
            return f"（{name} 仅在鉴权的私有通道可用，公开通道不执行。）"
        return await skill.handler(session, args)


skills_service = SkillsService()
