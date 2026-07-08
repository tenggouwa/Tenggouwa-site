"""agent 编排：tool-calling 循环。

流程：LLM(带 tools) 决定是否调用 skill → 执行 skill、把结果回填 → 直到模型不再调工具，
再流式生成最终答案。工具决策用非流式 complete()，最终答案用 stream()。
"""

import json
import logging
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.provider import chat_llm
from ..skills.service import skills_service

logger = logging.getLogger(__name__)

SYSTEM = (
    "你是 tenggouwa 个人站点的 AI 助手。你可以调用工具（如 kb_search 检索站点知识库）来获取信息。"
    "回答本站相关问题前先用 kb_search 查资料，只依据资料作答；答不出就直说不知道，不编造。"
    "用简体中文、简洁作答。"
)
MAX_STEPS = 4


class AgentService:
    async def answer_stream(self, session: AsyncSession, q: str) -> AsyncIterator[dict]:
        tools = skills_service.tools()
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": q},
        ]
        for _ in range(MAX_STEPS):
            msg = await chat_llm.complete(messages, tools=tools)
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                break
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                yield {"type": "tool", "name": name, "args": args}
                result = await skills_service.invoke(session, name, args)
                messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": result})
        # 最终答案：流式生成（不带 tools，强制作答）
        async for delta in chat_llm.stream(messages):
            yield {"type": "token", "delta": delta}
        yield {"type": "done"}


agent_service = AgentService()
