import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import Inspiration, InspirationCreate
from .service import inspiration_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/inspirations", tags=["public.inspirations"])


@public_router.get("", response_model=ResponseModel[list[Inspiration]])
async def list_public(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[Inspiration]]:
    items = await inspiration_service.list_all(session)
    return ResponseModel(data=items)


admin_router = APIRouter(
    prefix="/admin/inspirations",
    tags=["admin.inspirations"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("", response_model=ResponseModel[list[Inspiration]])
async def list_admin(session: AsyncSession = Depends(get_session)) -> ResponseModel[list[Inspiration]]:
    items = await inspiration_service.list_all(session)
    return ResponseModel(data=items)


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
