"""Skill 抽象：一个 agent 可调用的工具。

每个 skill = 名字 + 描述 + JSON 参数 schema（OpenAI function-calling 格式）+ handler。
- 描述/schema 给 LLM 看，用于决定何时调用、传什么参数。
- handler(session, args) 执行并返回字符串结果，回填给 LLM 续答（M4 的 agent 循环用）。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

SkillHandler = Callable[[AsyncSession, dict], Awaitable[str]]


@dataclass(frozen=True)
class Skill:
    name: str  # 合法函数名（^[a-zA-Z0-9_-]+$），如 kb_search
    description: str
    parameters: dict  # JSON schema
    handler: SkillHandler
    # readonly（只读、自动放行）| write（有副作用、需批准）。新增有副作用 skill 务必显式标 write，
    # 否则默认 readonly 会绕过权限闸自动执行（见 permissions.py）。
    risk: Literal["readonly", "write"] = "readonly"
    # private=True 的 skill 只在鉴权的私有通道暴露（即便 readonly 也不进公开端点）。
    # 与 risk 正交：risk 管「要不要审批」，private 管「哪条通道能看到」。文件工具即便只读也须私有。
    private: bool = False


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
