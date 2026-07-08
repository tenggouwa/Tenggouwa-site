"""kb_search skill：检索站点知识库，返回相关片段 + 来源。第一个 skill。"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.service import kb_service
from .base import Skill


async def _handler(session: AsyncSession, args: dict) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        return "（未提供查询）"
    hits = await kb_service.retrieve(session, query, None, limit=6)
    if not hits:
        return "知识库里没有相关内容。"
    blocks = [f"[{i}] 《{h['title']}》（{h.get('url') or ''}）\n{h['content']}" for i, h in enumerate(hits, 1)]
    return "\n\n".join(blocks)


KB_SEARCH = Skill(
    name="kb_search",
    description=(
        "检索站点知识库（博客文章等），返回与查询最相关的片段和来源。当用户问关于本站内容、作者、文章、技术话题时使用。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "检索查询（自然语言问题或关键词）"},
        },
        "required": ["query"],
    },
    handler=_handler,
)
