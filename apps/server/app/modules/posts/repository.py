"""Post 持久化层。基于 PostgreSQL + SQLAlchemy 2.0 async。"""

from db.models import PostRow
from sqlalchemy import select
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

    async def get_by_slug(self, slug: str) -> Post | None:
        stmt = select(PostRow).where(PostRow.slug == slug)
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        return _row_to_schema(row) if row else None

    async def list_all(self) -> list[Post]:
        stmt = select(PostRow).order_by(PostRow.published_at.desc())
        rows = (await self.session.execute(stmt)).scalars().all()
        return [_row_to_schema(r) for r in rows]
