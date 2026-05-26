import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import Inspiration, InspirationCreate, InspirationListPage
from .service import inspiration_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/inspirations", tags=["public.inspirations"])


@public_router.get("", response_model=ResponseModel[InspirationListPage])
async def list_public(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[InspirationListPage]:
    page = await inspiration_service.list_page(session, limit=limit, offset=offset)
    return ResponseModel(data=page)


admin_router = APIRouter(
    prefix="/admin/inspirations",
    tags=["admin.inspirations"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("", response_model=ResponseModel[InspirationListPage])
async def list_admin(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[InspirationListPage]:
    page = await inspiration_service.list_page(session, limit=limit, offset=offset)
    return ResponseModel(data=page)


@admin_router.post("", response_model=ResponseModel[Inspiration])
async def create(
    payload: InspirationCreate,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Inspiration]:
    item = await inspiration_service.create(session, payload)
    return ResponseModel(data=item)


@admin_router.delete("/{item_id}", response_model=ResponseModel[dict])
async def delete(
    item_id: int,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    await inspiration_service.delete(session, item_id)
    return ResponseModel(data={"deleted": item_id})
