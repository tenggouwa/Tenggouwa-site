from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import OpsOverview
from .service import ops_service

admin_router = APIRouter(prefix="/admin/ops", tags=["admin.ops"], dependencies=[Depends(current_admin)])


@admin_router.get("/overview", response_model=ResponseModel[OpsOverview])
async def overview(session: AsyncSession = Depends(get_session)) -> ResponseModel[OpsOverview]:
    """Return safe health metadata only; never configuration, credentials, prompts, or mail contents."""
    return ResponseModel(data=await ops_service.overview(session))
