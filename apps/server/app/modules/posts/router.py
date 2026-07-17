import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from ..kb.auto import schedule_kb_refresh
from .schema import Post, PostAdminListPage, PostCreate, PostListPage, PostSummary, PostUpdate
from .service import post_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/posts", tags=["public.posts"])


@public_router.get("", response_model=ResponseModel[PostListPage])
async def list_posts_public(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tag: str | None = Query(default=None, max_length=64, description="按 tag 过滤"),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[PostListPage]:
    """列出已发布文章（摘要，不含正文）。limit/offset 分页；tag 可选过滤。"""
    page = await post_service.list_summary_page(session, limit=limit, offset=offset, tag=tag)
    return ResponseModel(data=page)


@public_router.get("/{slug}", response_model=ResponseModel[Post])
async def get_post_public(
    slug: str,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.get_by_slug(session, slug)
    return ResponseModel(data=item)


@public_router.get("/{slug}/related", response_model=ResponseModel[list[PostSummary]])
async def get_post_related(
    slug: str,
    limit: int = Query(default=3, ge=1, le=10),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[PostSummary]]:
    """相关文章：按 tag 交集排序，排除自己，只返回已发布。"""
    items = await post_service.list_related(session, slug, limit=limit)
    return ResponseModel(data=items)


admin_router = APIRouter(
    prefix="/admin/posts",
    tags=["admin.posts"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("", response_model=ResponseModel[PostAdminListPage])
async def list_posts_admin(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[PostAdminListPage]:
    page = await post_service.list_admin_page(session, limit=limit, offset=offset)
    return ResponseModel(data=page)


@admin_router.post("", response_model=ResponseModel[Post])
async def create_post(
    payload: PostCreate,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.create(session, payload)
    schedule_kb_refresh()  # 新文自动进知识库 + 图谱（后台合并刷新）
    return ResponseModel(data=item)


@admin_router.put("/{item_id}", response_model=ResponseModel[Post])
async def update_post(
    item_id: int,
    payload: PostUpdate,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.update(session, item_id, payload)
    schedule_kb_refresh()  # 改文自动追平知识库 + 图谱（内容 hash 没变则空跑，不烧 LLM）
    return ResponseModel(data=item)


@admin_router.delete("/{item_id}", response_model=ResponseModel[dict])
async def delete_post(
    item_id: int,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    await post_service.delete(session, item_id)
    return ResponseModel(data={"deleted": item_id})
