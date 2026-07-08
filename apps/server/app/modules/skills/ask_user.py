"""ask_user skill：让 agent 向用户抛一组带选项的问题，前端渲染成可点击选项卡。

抄 Claude AskUserQuestion / Codex request_user_input。agent/service 特殊拦截这个 skill：
发 event: ask 给前端渲染选项，并结束当前轮（不再流式作答）；用户点选后作为下一轮 user
消息续上，多轮记忆接住上下文（见 docs/agent-v2-design.md §5）。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from .base import Skill


async def _handler(_session: AsyncSession, args: dict) -> str:
    qs = args.get("questions")
    if not isinstance(qs, list) or not qs:
        return "（未提供问题）"
    return f"（已向用户展示 {len(qs)} 个选择题，等待其点选后再继续。）"


ASK_USER = Skill(
    name="ask_user",
    description=(
        "向用户抛出一组带选项的问题，让用户点击选择而不是打字作答。"
        "当你需要用户在若干明确选项中做选择、或需澄清关键信息才能继续时使用；每个问题给 2–4 个 options。"
        "简单问题直接用文字问即可，不必用本工具。调用后当前回合结束，等用户点选后再继续。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "header": {"type": "string", "description": "问题的简短标签（≤ 6 字）"},
                        "question": {"type": "string", "description": "完整问题"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "2–4 个可选项",
                        },
                        "multi": {"type": "boolean", "description": "是否允许多选，默认单选"},
                    },
                    "required": ["question", "options"],
                },
            },
        },
        "required": ["questions"],
    },
    handler=_handler,
)
