import logging

from db import get_session
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import SearchHit, SearchResponse
from .service import search_service

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/public/search", tags=["public.search"])


@public_router.get("", response_model=ResponseModel[SearchResponse])
async def search(
    q: str = Query(..., min_length=1, max_length=100, description="搜索关键词"),
    limit: int = Query(default=20, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[SearchResponse]:
    data = await search_service.search(session, q, limit)
    return ResponseModel(
        data=SearchResponse(
            query=data["query"],
            took_ms=data["took_ms"],
            total=data["total"],
            hits=[SearchHit(**h) for h in data["hits"]],
        )
    )
