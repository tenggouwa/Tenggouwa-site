"""Skill 抽象：一个 agent 可调用的工具。

每个 skill = 名字 + 描述 + JSON 参数 schema（OpenAI function-calling 格式）+ handler。
- 描述/schema 给 LLM 看，用于决定何时调用、传什么参数。
- handler(session, args) 执行并返回字符串结果，回填给 LLM 续答（M4 的 agent 循环用）。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

SkillHandler = Callable[[AsyncSession, dict], Awaitable[str]]


@dataclass(frozen=True)
class Skill:
    name: str  # 合法函数名（^[a-zA-Z0-9_-]+$），如 kb_search
    description: str
    parameters: dict  # JSON schema
    handler: SkillHandler


def tool_schema(skill: Skill) -> dict:
    """转成 OpenAI / DeepSeek function-calling 的 tool 定义。"""
    return {
        "type": "function",
        "function": {
            "name": skill.name,
            "description": skill.description,
            "parameters": skill.parameters,
        },
    }
