"""Skills 编排：列出 skill、给 M4 agent 循环提供 tool schema 与 handler 调度。"""

from sqlalchemy.ext.asyncio import AsyncSession

from .base import tool_schema
from .registry import REGISTRY
from .schema import SkillInfo


class SkillsService:
    def list_skills(self) -> list[SkillInfo]:
        return [SkillInfo(name=s.name, description=s.description, parameters=s.parameters) for s in REGISTRY.values()]

    def tools(self) -> list[dict]:
        """function-calling 的 tools 列表（M4 agent 传给 LLM）。"""
        return [tool_schema(s) for s in REGISTRY.values()]

    async def invoke(self, session: AsyncSession, name: str, args: dict) -> str:
        """执行一个 skill；未知 skill 返回错误字符串（不抛，交给 agent 续答）。"""
        skill = REGISTRY.get(name)
        if skill is None:
            return f"（未知 skill: {name}）"
        return await skill.handler(session, args)


skills_service = SkillsService()
