"""搜索仓储层。Postgres pg_trgm 模糊匹配。

设计：
- post 查 title/summary/tags（JSONB::text）/content 4 列，权重分别 1.0 / 0.7 / 0.6 / 0.4
- inspiration 查 content 一列
- 用 GREATEST(similarity(...)) 综合评分
- WHERE 用 word_similarity（% 操作符）+ ILIKE OR，命中阈值靠 GIN 索引提速
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class SearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def search_posts(self, q: str, limit: int) -> list[dict]:
        # word_similarity 比 similarity 对短查询友好（含 vs 整体相似）
        # ILIKE 兜底确保子串匹配也命中（trigram 对很短的中文词可能漏）
        sql = text("""
            SELECT
                id,
                slug,
                title,
                summary,
                content,
                tags,
                published_at,
                GREATEST(
                    word_similarity(:q, title) * 1.0,
                    word_similarity(:q, summary) * 0.7,
                    word_similarity(:q, tags::text) * 0.6,
                    word_similarity(:q, content) * 0.4
                ) AS score
            FROM post
            WHERE title ILIKE :like_q
               OR summary ILIKE :like_q
               OR tags::text ILIKE :like_q
               OR content ILIKE :like_q
            ORDER BY score DESC, published_at DESC
            LIMIT :limit
        """)
        rows = (
            await self.session.execute(
                sql,
                {"q": q, "like_q": f"%{q}%", "limit": limit},
            )
        ).all()
        return [
            {
                "id": r.id,
                "slug": r.slug,
                "title": r.title,
                "summary": r.summary,
                "content": r.content,
                "tags": r.tags or [],
                "published_at": r.published_at,
                "score": float(r.score or 0),
            }
            for r in rows
        ]

    async def search_inspirations(self, q: str, limit: int) -> list[dict]:
        sql = text("""
            SELECT
                id,
                content,
                created_at,
                word_similarity(:q, content) AS score
            FROM inspiration
            WHERE content ILIKE :like_q
            ORDER BY score DESC, created_at DESC
            LIMIT :limit
        """)
        rows = (
            await self.session.execute(
                sql,
                {"q": q, "like_q": f"%{q}%", "limit": limit},
            )
        ).all()
        return [
            {
                "id": r.id,
                "content": r.content,
                "created_at": r.created_at,
                "score": float(r.score or 0),
            }
            for r in rows
        ]
