"""run_subagent skill：主代理把一个相对独立的子任务交给一个**只读子代理**去做，返回它的结论。

设计（安全边界，见 docs/agent/agent-v2-design.md 的子代理构想）：
- 子代理只拿**只读、非 private** 工具（kb_search / web_search / web_fetch / update_plan），且**排除 run_subagent 自身**
  → 不会无限递归、不碰 file/shell（免去审批复杂度）。
- 独立上下文：子代理只看到「子任务」这一条 user 消息，不继承主对话历史；跑完把结论回给主代理汇总。
- 自带步数上限 _SUB_MAX_STEPS，兜底防死循环。
- stream_run 边跑边 yield {"progress": ...}（每步调了哪些工具），最后 yield {"result": ...}；主代理侧把 progress
  当 tool_output 流给前端（复用 shell 那套实时框），别让 6 步 LLM 静默等成「卡住」。
"""

import json

from .base import Skill

SUBAGENT_SKILL = "run_subagent"
_SUB_MAX_STEPS = 6
_SUB_MAX_TOOL_RESULT = 6_000

_SUB_SYSTEM = (
    "你是一个子任务代理，只负责完成主代理交给你的这**一个**子任务。\n"
    "- 用只读工具（kb_search 查站内知识库 / web_search 搜网 / web_fetch 抓网页）收集信息，用到就把来源"
    "用 markdown 链接回引出来。\n"
    "- 不要反问、不要请求澄清，基于已有信息直接把子任务做到底，给出简洁、结论性的回答供主代理汇总。\n"
    "- 用简体中文。"
)


def _tc_name(tc: dict) -> str:
    return tc.get("function", {}).get("name", "")


def _tc_args(tc: dict) -> dict:
    try:
        return json.loads(tc.get("function", {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        return {}


async def stream_run(session, task: str):
    """跑一个只读子代理，边跑边 yield 进度、最后 yield 结论。"""
    from ..kb.provider import chat_llm
    from .service import skills_service

    task = (task or "").strip()
    if not task:
        yield {"result": "（未提供子任务 task）"}
        return
    # 只读非 private 工具，且排除 run_subagent 自身（防递归）
    tools = [t for t in skills_service.tools(privileged=False) if t.get("function", {}).get("name") != SUBAGENT_SKILL]
    messages: list[dict] = [
        {"role": "system", "content": _SUB_SYSTEM},
        {"role": "user", "content": task},
    ]
    content = ""
    for _ in range(_SUB_MAX_STEPS):
        content, tool_calls = "", []
        async for ev in chat_llm.stream_step(messages, tools=tools):
            if ev["type"] == "content":
                content += ev["delta"]
            elif ev["type"] == "tool_calls":
                tool_calls = ev["tool_calls"]
        if not tool_calls:
            yield {"result": content or "（子代理无输出）"}
            return
        yield {"progress": "· " + ", ".join(_tc_name(tc) for tc in tool_calls)}
        messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
        for tc in tool_calls:
            result = await skills_service.invoke(session, _tc_name(tc), _tc_args(tc), privileged=False)
            messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": result[:_SUB_MAX_TOOL_RESULT]})
    yield {"result": content or "（子代理达到步数上限，未得结论）"}


async def _handler(session, args: dict) -> str:
    """非流式兜底：收敛 stream_run 的结论（主代理循环里另有流式特判走 stream_run）。"""
    result = "（子代理无输出）"
    async for ev in stream_run(session, str(args.get("task", ""))):
        if "result" in ev:
            result = ev["result"]
    return result


SUBAGENT = Skill(
    name=SUBAGENT_SKILL,
    description=(
        "把一个相对独立、需要多步检索的子任务交给一个子代理去做（它有只读工具：查知识库/搜网/抓网页），返回它的结论。"
        "适合把一块能自成一体的子问题隔离出去、避免主线上下文被中间检索噪音塞满。子代理不能写文件/跑命令。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "task": {"type": "string", "description": "交给子代理的完整子任务描述（自包含，别依赖主对话上下文）"},
        },
        "required": ["task"],
    },
    handler=_handler,
    risk="readonly",
)
