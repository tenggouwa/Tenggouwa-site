"""Post 持久化层。基于 PostgreSQL + SQLAlchemy 2.0 async。"""

from datetime import datetime, timezone

from db.models import PostRow
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import Post, PostCreate, PostUpdate


def _row_to_schema(row: PostRow) -> Post:
    return Post(
        id=row.id,
        slug=row.slug,
        title=row.title,
        summary=row.summary,
        tags=list(row.tags or []),
        content=row.content,
        published_at=row.published_at,
    )


class PostRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, payload: PostCreate) -> Post:
        row = PostRow(
            slug=payload.slug,
            title=payload.title,
            summary=payload.summary,
            tags=list(payload.tags),
            content=payload.content,
        )
        if payload.published_at is not None:
            row.published_at = payload.published_at
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as e:
            raise ValueError(f"slug 已存在: {payload.slug}") from e
        await self.session.refresh(row)
        return _row_to_schema(row)

    async def update(self, item_id: int, payload: PostUpdate) -> Post | None:
        row = await self.session.get(PostRow, item_id)
        if row is None:
            return None
        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            if v is None:
                continue
            setattr(row, k, list(v) if k == "tags" else v)
        await self.session.flush()
        await self.session.refresh(row)
        return _row_to_schema(row)

    async def delete(self, item_id: int) -> bool:
        row = await self.session.get(PostRow, item_id)
        if row is None:
            return False
        await self.session.delete(row)
        await self.session.flush()
        return True

    async def get_by_slug(self, slug: str, *, only_published: bool = False) -> Post | None:
        stmt = select(PostRow).where(PostRow.slug == slug)
        if only_published:
            stmt = stmt.where(PostRow.published_at <= datetime.now(timezone.utc))
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        return _row_to_schema(row) if row else None

    async def list_all(self, *, only_published: bool = False) -> list[Post]:
        stmt = select(PostRow).order_by(PostRow.published_at.desc())
        if only_published:
            stmt = stmt.where(PostRow.published_at <= datetime.now(timezone.utc))
        rows = (await self.session.execute(stmt)).scalars().all()
        return [_row_to_schema(r) for r in rows]

    async def list_page(
        self,
        *,
        limit: int,
        offset: int,
        only_published: bool = False,
        tag: str | None = None,
    ) -> tuple[list[Post], int]:
        where_clause = []
        if only_published:
            where_clause.append(PostRow.published_at <= datetime.now(timezone.utc))
        if tag:
            # JSONB ? 操作符：tags 数组里是否含某 key
            where_clause.append(PostRow.tags.op("?")(tag))

        stmt = select(PostRow).order_by(PostRow.published_at.desc())
        count_stmt = select(func.count(PostRow.id))
        for w in where_clause:
            stmt = stmt.where(w)
            count_stmt = count_stmt.where(w)
        stmt = stmt.limit(limit).offset(offset)

        rows = (await self.session.execute(stmt)).scalars().all()
        total = (await self.session.execute(count_stmt)).scalar_one()
        return [_row_to_schema(r) for r in rows], total

    async def list_related(
        self,
        *,
        slug: str,
        tags: list[str],
        limit: int = 3,
    ) -> list[Post]:
        """相关文章：按 tag 交集数排序（共享 tag 越多越相关）；同分按发布时间倒序。
        排除自己；只返回已发布。
        """
        if not tags:
            return []
        # 用 jsonb 数组重叠运算符 ?| 找出至少有一个 tag 重叠的；
        # 再用 SQL 计算 overlap 数排序
        from sqlalchemy import text

        sql = text("""
            SELECT
                id, slug, title, summary, tags, content, published_at,
                (
                    SELECT COUNT(*)
                    FROM jsonb_array_elements_text(tags) AS t(tag)
                    WHERE t.tag = ANY(:tags)
                ) AS overlap
            FROM post
            WHERE slug != :slug
              AND published_at <= now()
              AND tags ?| :tags
            ORDER BY overlap DESC, published_at DESC
            LIMIT :limit
        """)
        rows = (
            await self.session.execute(
                sql, {"slug": slug, "tags": tags, "limit": limit}
            )
        ).all()
        return [
            Post(
                id=r.id,
                slug=r.slug,
                title=r.title,
                summary=r.summary,
                tags=list(r.tags or []),
                content=r.content,
                published_at=r.published_at,
            )
            for r in rows
        ]
