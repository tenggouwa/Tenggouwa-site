import logging

from dependencies import DetailedHTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .repository import PostRepository
from .schema import Post, PostAdminListPage, PostCreate, PostListPage, PostSummary, PostUpdate

logger = logging.getLogger(__name__)


class PostService:
    async def create(self, session: AsyncSession, payload: PostCreate) -> Post:
        try:
            return await PostRepository(session).create(payload)
        except ValueError as e:
            raise DetailedHTTPException(status_code=400, detail=str(e), full_detail=str(e)) from e

    async def update(self, session: AsyncSession, item_id: int, payload: PostUpdate) -> Post:
        item = await PostRepository(session).update(item_id, payload)
        if item is None:
            raise DetailedHTTPException(status_code=404, detail="post not found", full_detail=f"id={item_id}")
        return item

    async def delete(self, session: AsyncSession, item_id: int) -> None:
        ok = await PostRepository(session).delete(item_id)
        if not ok:
            raise DetailedHTTPException(status_code=404, detail="post not found", full_detail=f"id={item_id}")

    async def list_all(self, session: AsyncSession) -> list[Post]:
        return await PostRepository(session).list_all()

    async def list_admin_page(
        self,
        session: AsyncSession,
        *,
        limit: int,
        offset: int,
    ) -> PostAdminListPage:
        """admin 列表分页：含草稿（不限已发布）和正文。"""
        items, total = await PostRepository(session).list_page(limit=limit, offset=offset, only_published=False)
        return PostAdminListPage(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + len(items) < total,
        )

    async def list_summary(self, session: AsyncSession) -> list[PostSummary]:
        items = await PostRepository(session).list_all(only_published=True)
        return [PostSummary(**item.model_dump(exclude={"content"})) for item in items]

    async def list_summary_page(
        self,
        session: AsyncSession,
        *,
        limit: int,
        offset: int,
        tag: str | None = None,
    ) -> PostListPage:
        items, total = await PostRepository(session).list_page(
            limit=limit,
            offset=offset,
            only_published=True,
            tag=tag,
        )
        summaries = [PostSummary(**item.model_dump(exclude={"content"})) for item in items]
        return PostListPage(
            items=summaries,
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + len(summaries) < total,
        )

    async def get_by_slug(self, session: AsyncSession, slug: str) -> Post:
        item = await PostRepository(session).get_by_slug(slug, only_published=True)
        if item is None:
            raise DetailedHTTPException(status_code=404, detail="post not found", full_detail=f"slug={slug}")
        return item

    async def list_related(
        self,
        session: AsyncSession,
        slug: str,
        limit: int = 3,
    ) -> list[PostSummary]:
        """按 tag 交集找相关文章。单条 SQL 内联当前文章 tags，不再先查一次。"""
        related = await PostRepository(session).list_related(slug=slug, limit=limit)
        return [PostSummary(**item.model_dump(exclude={"content"})) for item in related]


post_service = PostService()
