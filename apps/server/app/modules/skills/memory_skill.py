"""remember / forget：agent 管自己的长期记忆（owner 维度、跨会话）。

私有通道专属（private=True）。risk=write（真写库）但在 permissions 里归 auto——写的是 owner 自己的
记忆、无外部副作用，不该每次「记住X」都弹审批。owner 从 current_owner ContextVar 取（见 memory.store）。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..memory.store import MemoryStore, current_owner
from .base import Skill


async def _remember(session: AsyncSession, args: dict) -> str:
    owner = current_owner.get()
    if not owner:
        return "（记忆仅在私有通道可用。）"
    return await MemoryStore(session).remember(owner, str(args.get("content", "")))


async def _forget(session: AsyncSession, args: dict) -> str:
    owner = current_owner.get()
    if not owner:
        return "（记忆仅在私有通道可用。）"
    return await MemoryStore(session).forget(owner, str(args.get("query", "")))


REMEMBER = Skill(
    name="remember",
    description=(
        "记住一条关于当前用户的持久事实，供以后的对话回忆。用户明确说「记住…」时用它；你自己发现一条"
        "**跨会话仍成立**的事实（长期偏好、项目约定、反复交代的要求）也可主动记。"
        "只记持久、具体、值得跨会话复用的；一次性的、本轮就用完的、能当场推断的都别记。写前自动去重。"
    ),
    parameters={
        "type": "object",
        "properties": {"content": {"type": "string", "description": "一条自足的事实，如「用户偏好暗色终端风」"}},
        "required": ["content"],
    },
    handler=_remember,
    risk="write",
    private=True,
)

FORGET = Skill(
    name="forget",
    description=(
        "删掉之前记住的一条关于用户的记忆。用户说「忘了…」「别记…」，或某条记忆已过时 / 记错了时用。"
        "按描述匹配最相关的一条删。"
    ),
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "要忘掉的记忆的大意，如「暗色偏好」"}},
        "required": ["query"],
    },
    handler=_forget,
    risk="write",
    private=True,
)
