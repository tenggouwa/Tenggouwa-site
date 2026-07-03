"""BlogIngester：把已发布的 post 灌进知识库（第一个源）。"""

from datetime import UTC, datetime

from db.models import PostRow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .base import KBDoc


class BlogIngester:
    kind = "blog"
    name = "blog"

    async def fetch(self, session: AsyncSession) -> list[KBDoc]:
        now = datetime.now(UTC)
        rows = (await session.execute(select(PostRow))).scalars().all()
        docs: list[KBDoc] = []
        for p in rows:
            if p.published_at and p.published_at > now:
                continue  # 跳过未来排期草稿，与 /api/public/posts 一致
            docs.append(
                KBDoc(
                    external_id=p.slug,
                    title=p.title,
                    url=f"/posts/{p.slug}/",
                    raw_md=p.content or "",
                    meta={
                        "tags": list(p.tags or []),
                        "published_at": p.published_at.isoformat() if p.published_at else None,
                    },
                )
            )
        return docs
