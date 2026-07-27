"""propose_skill：agent 撞到能力缺口时，提议一个「该有但没有」的工具规格，交站主评审。

私有通道专属（owner 维度）。risk=write 但归 _AUTO_WRITE 免批——只是记一条提案、无外部副作用，
且**不会自动生效**（需站主人工实现）。owner 从 current_owner ContextVar 取（复用 memory 那套）。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.proposals import ProposalStore
from ..memory.store import current_owner
from .base import Skill


async def _handler(session: AsyncSession, args: dict) -> str:
    owner = current_owner.get()
    if not owner:
        return "（技能提案仅在私有通道可用。）"
    params = args.get("parameters")
    return await ProposalStore(session).add(
        owner,
        str(args.get("name", "")),
        str(args.get("description", "")),
        params if isinstance(params, dict) else {},
        str(args.get("rationale", "")),
    )


PROPOSE_SKILL = Skill(
    name="propose_skill",
    description=(
        "当用户的需求需要一个你现在**没有**的工具/能力时，别硬凑也别放弃——调这个，把缺失的能力"
        "描述成一个 skill 规格（名字/用途/参数/为什么需要），交站主评审。它**不会自动生效**，是留给人工实现的建议。"
        "只在真的存在能力缺口时用；现有工具能做的别提。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "建议的 skill 名（snake_case，如 send_email）"},
            "description": {"type": "string", "description": "这个 skill 干什么、何时该用"},
            "parameters": {"type": "object", "description": "参数 schema 草图（OpenAI function-calling 风格，可粗略）"},
            "rationale": {"type": "string", "description": "为什么现在需要它——触发这次提案的具体缺口"},
        },
        "required": ["name", "description"],
    },
    handler=_handler,
    risk="write",
    private=True,
)
