import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import Post, PostCreate, PostSummary, PostUpdate
from .service import post_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/posts", tags=["public.posts"])


@public_router.get("", response_model=ResponseModel[list[PostSummary]])
async def list_posts_public(
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[PostSummary]]:
    """列出已发布文章（摘要，不含正文）。"""
    items = await post_service.list_summary(session)
    return ResponseModel(data=items)


@public_router.get("/{slug}", response_model=ResponseModel[Post])
async def get_post_public(
    slug: str,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.get_by_slug(session, slug)
    return ResponseModel(data=item)


admin_router = APIRouter(
    prefix="/admin/posts",
    tags=["admin.posts"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("", response_model=ResponseModel[list[Post]])
async def list_posts_admin(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[Post]]:
    items = await post_service.list_all(session)
    return ResponseModel(data=items)


@admin_router.post("", response_model=ResponseModel[Post])
async def create_post(
    payload: PostCreate,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.create(session, payload)
    return ResponseModel(data=item)


@admin_router.put("/{item_id}", response_model=ResponseModel[Post])
async def update_post(
    item_id: int,
    payload: PostUpdate,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Post]:
    item = await post_service.update(session, item_id, payload)
    return ResponseModel(data=item)


@admin_router.delete("/{item_id}", response_model=ResponseModel[dict])
async def delete_post(
    item_id: int,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    await post_service.delete(session, item_id)
    return ResponseModel(data={"deleted": item_id})
