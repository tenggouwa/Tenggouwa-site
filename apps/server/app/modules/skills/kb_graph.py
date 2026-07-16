"""kb_graph skill：顺着**概念图谱**查——命中概念 → 它的关系 → 佐证文章。

和 kb_search 互补，别搞混：
- kb_search 捞的是**文本块**：「这段话怎么说的」。
- kb_graph 给的是**结构**：「这个概念跟谁有什么关系、哪几篇讲过它」。
「X 和 Y 什么关系」「顺着 X 还能看什么」「这些知识怎么串起来」这类问题，块检索答不好，得靠图。

图谱由 admin 侧 LLM 抽取（见 modules/kb/graph.py）；没跑过抽取时这里自然返回「没匹配到」，不报错。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.service import kb_service
from .base import Skill


async def _handler(session: AsyncSession, args: dict) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        return "（未提供查询）"
    return await kb_service.graph_search(session, query)


KB_GRAPH = Skill(
    name="kb_graph",
    description=(
        "查站内知识库的**概念图谱**：给一个概念/技术/人物，返回它跟哪些概念有什么关系（如 "
        "「Chinchilla —修正→ Kaplan 论文」），以及哪几篇文章讲过它们。"
        "当用户问「X 和 Y 是什么关系」「X 跟什么相关」「顺着 X 还能看什么」「这些知识怎么串起来」时用它；"
        "想看某段原文怎么说的仍用 kb_search。只读。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "概念名或话题，如 Transformer、cgroup、RAG"},
        },
        "required": ["query"],
    },
    handler=_handler,
)
