"""agent 长期记忆：owner 维度的写入 / 召回 / 遗忘。复用 kb 的 Embedder + pgvector，不另造检索。

- 写：模型判断有条持久事实值得记就调 remember；写前按 embedding 去重（太近=更新而非再插一条）。
- 召回：每轮拿用户问题做 embedding，取该 owner 最相关且够近的几条注入上下文（不相关不注入）。
- 隔离：owner 非空才有记忆；owner 由 current_owner 这个 ContextVar 从 answer_stream 传进来
  （skill handler 签名是 (session, args)，不带 owner，用 ContextVar 做请求级环境上下文最省侵入）。
"""

import logging
from contextvars import ContextVar

from db.models import AgentMemoryRow
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..kb.provider import embedder

logger = logging.getLogger(__name__)

# 当前私有会话的 owner（answer_stream 每轮设置）；公开通道为 None → 无记忆。
current_owner: ContextVar[str | None] = ContextVar("agent_current_owner", default=None)

MAX_MEMORIES_PER_OWNER = 200  # 每 owner 上限，超了淘汰最旧（记忆不该无限膨胀）
DEDUP_DISTANCE = 0.12  # 新记忆与最近的一条余弦距离 < 此值 = 同一件事 → 更新而非新插
RECALL_MAX_DISTANCE = 0.6  # 召回只注入距离 < 此值的记忆（不相关的别塞进上下文当噪声）
RECALL_TOP_K = 6


class MemoryStore:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def remember(self, owner: str, content: str) -> str:
        """记一条事实。写前去重：和已有最近的一条太像就更新它，不重复堆积。返回给模型的回执。"""
        content = content.strip()
        if not content:
            return "（要记的内容为空。）"
        vec = await embedder.embed_one(content) if embedder.configured else None

        if vec is not None:
            near = (
                await self.session.execute(
                    select(AgentMemoryRow, AgentMemoryRow.embedding.cosine_distance(vec).label("dist"))
                    .where(AgentMemoryRow.owner == owner, AgentMemoryRow.embedding.isnot(None))
                    .order_by("dist")
                    .limit(1)
                )
            ).first()
            if near is not None and near.dist < DEDUP_DISTANCE:
                row = near[0]
                row.content = content
                row.embedding = vec
                await self.session.flush()
                return f"（已更新一条相近的记忆：{content}）"

        self.session.add(AgentMemoryRow(owner=owner, content=content, embedding=vec))
        await self.session.flush()
        await self._evict_over_cap(owner)
        return f"（已记住：{content}）"

    async def recall(self, owner: str, query: str, *, k: int = RECALL_TOP_K) -> list[str]:
        """召回与 query 最相关且够近的记忆内容。未配嵌入则降级为最近 k 条。"""
        if embedder.configured:
            try:
                qvec = await embedder.embed_one(query)
            except Exception:
                logger.exception("记忆召回 embed 失败，降级为最近条")
                qvec = None
        else:
            qvec = None

        if qvec is None:
            rows = (
                await self.session.execute(
                    select(AgentMemoryRow.content)
                    .where(AgentMemoryRow.owner == owner)
                    .order_by(AgentMemoryRow.created_at.desc())
                    .limit(k)
                )
            ).all()
            return [r.content for r in rows]

        rows = (
            await self.session.execute(
                select(AgentMemoryRow.content, AgentMemoryRow.embedding.cosine_distance(qvec).label("dist"))
                .where(AgentMemoryRow.owner == owner, AgentMemoryRow.embedding.isnot(None))
                .order_by("dist")
                .limit(k)
            )
        ).all()
        return [r.content for r in rows if r.dist < RECALL_MAX_DISTANCE]

    async def forget(self, owner: str, query: str) -> str:
        """删掉与 query 最匹配的一条记忆。删不掉（没有或不够近）就如实说。"""
        query = query.strip()
        if not query:
            return "（没说要忘什么。）"
        if embedder.configured:
            qvec = await embedder.embed_one(query)
            near = (
                await self.session.execute(
                    select(AgentMemoryRow, AgentMemoryRow.embedding.cosine_distance(qvec).label("dist"))
                    .where(AgentMemoryRow.owner == owner, AgentMemoryRow.embedding.isnot(None))
                    .order_by("dist")
                    .limit(1)
                )
            ).first()
            if near is None or near.dist > RECALL_MAX_DISTANCE:
                return f"（没找到跟「{query}」相关的记忆。）"
            row = near[0]
        else:
            row = (
                await self.session.execute(
                    select(AgentMemoryRow)
                    .where(AgentMemoryRow.owner == owner, AgentMemoryRow.content.ilike(f"%{query}%"))
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is None:
                return f"（没找到跟「{query}」相关的记忆。）"
        content = row.content
        await self.session.delete(row)
        await self.session.flush()
        return f"（已忘掉：{content}）"

    async def list_all(self, owner: str) -> list[dict]:
        rows = (
            await self.session.execute(
                select(AgentMemoryRow.id, AgentMemoryRow.content, AgentMemoryRow.created_at)
                .where(AgentMemoryRow.owner == owner)
                .order_by(AgentMemoryRow.created_at.desc())
            )
        ).all()
        return [{"id": r.id, "content": r.content, "created_at": r.created_at.isoformat()} for r in rows]

    async def count(self, owner: str) -> int:
        return (
            await self.session.execute(select(func.count(AgentMemoryRow.id)).where(AgentMemoryRow.owner == owner))
        ).scalar() or 0

    async def _evict_over_cap(self, owner: str) -> None:
        """超过上限就淘汰最旧的几条——记忆不该无限膨胀。"""
        n = await self.count(owner)
        if n <= MAX_MEMORIES_PER_OWNER:
            return
        stale = (
            select(AgentMemoryRow.id)
            .where(AgentMemoryRow.owner == owner)
            .order_by(AgentMemoryRow.created_at)
            .limit(n - MAX_MEMORIES_PER_OWNER)
        )
        await self.session.execute(delete(AgentMemoryRow).where(AgentMemoryRow.id.in_(stale)))
        await self.session.flush()
