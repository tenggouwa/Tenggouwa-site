"""update_plan skill：把任务拆成有序步骤写进上下文，减少长链路目标漂移。

抄 Codex update_plan / Claude TodoWrite（见 docs/agent/agent-v2-design.md §5.2）。handler 不查外部、
不落库——它的价值就是把计划写回上下文；agent/service 另外发 event: plan 给前端渲染 checklist。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from .base import Skill

_STATUS = {"pending", "in_progress", "completed"}


async def _handler(_session: AsyncSession, args: dict) -> str:
    plan = args.get("plan")
    if not isinstance(plan, list) or not plan:
        return "（计划为空）"
    in_progress = sum(1 for s in plan if isinstance(s, dict) and s.get("status") == "in_progress")
    lines = []
    for s in plan:
        if not isinstance(s, dict):
            continue
        status = s.get("status")
        if status not in _STATUS:
            status = "pending"
        mark = {"completed": "✓", "in_progress": "·", "pending": " "}.get(status, " ")
        lines.append(f"[{mark}] {s.get('step', '')}")
    warn = "（注意：同时至多一个步骤可为 in_progress）\n" if in_progress > 1 else ""
    return warn + "计划已更新：\n" + "\n".join(lines)


UPDATE_PLAN = Skill(
    name="update_plan",
    description=(
        "把当前任务拆成有序步骤并更新进度。开始多步任务时先列计划，每完成一步再调用更新状态。"
        "同时至多一个步骤为 in_progress。简单单步问题不要用。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "plan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "step": {"type": "string", "description": "步骤描述（≤ 7 词）"},
                        "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                    },
                    "required": ["step", "status"],
                },
            }
        },
        "required": ["plan"],
    },
    handler=_handler,
)
