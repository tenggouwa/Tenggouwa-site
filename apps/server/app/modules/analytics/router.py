import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import (
    CountryStat,
    DeviceStats,
    OverviewResponse,
    TopPage,
    TopReferrer,
    TrackRequest,
)
from .service import analytics_service

logger = logging.getLogger(__name__)

# 公开埋点接口：前端 web 来 POST
public_router = APIRouter(prefix="/public/track", tags=["public.track"])


@public_router.post("", response_model=ResponseModel[dict])
async def track(
    payload: TrackRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    # Cloudflare Tunnel 透传以下三个 header
    ip = request.headers.get("cf-connecting-ip") or _client_ip(request)
    ua = request.headers.get("user-agent")
    country = request.headers.get("cf-ipcountry")
    ok = await analytics_service.track(session, payload, ip=ip, ua=ua, country=country)
    return ResponseModel(data={"recorded": ok})


@public_router.get("/views", response_model=ResponseModel[dict])
async def path_views(
    path: str = Query(..., max_length=500),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """单篇文章的累计阅读量，供前端文章页展示。"""
    n = await analytics_service.path_views(session, path)
    return ResponseModel(data={"path": path, "views": n})


def _client_ip(request: Request) -> str | None:
    # 后备：X-Forwarded-For 第一个，再不行就 client.host
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


# Admin 聚合查询接口
admin_router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin.analytics"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("/overview", response_model=ResponseModel[OverviewResponse])
async def overview(
    days: int = 30,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[OverviewResponse]:
    data = await analytics_service.overview(session, days)
    return ResponseModel(data=OverviewResponse(**data))


@admin_router.get("/top-pages", response_model=ResponseModel[list[TopPage]])
async def top_pages(
    days: int = 30,
    limit: int = 10,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[TopPage]]:
    data = await analytics_service.top_pages(session, days, limit)
    return ResponseModel(data=[TopPage(**d) for d in data])


@admin_router.get("/top-referrers", response_model=ResponseModel[list[TopReferrer]])
async def top_referrers(
    days: int = 30,
    limit: int = 10,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[TopReferrer]]:
    data = await analytics_service.top_referrers(session, days, limit)
    return ResponseModel(data=[TopReferrer(**d) for d in data])


@admin_router.get("/countries", response_model=ResponseModel[list[CountryStat]])
async def countries(
    days: int = 30,
    limit: int = 30,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[CountryStat]]:
    data = await analytics_service.by_country(session, days, limit)
    return ResponseModel(data=[CountryStat(**d) for d in data])


@admin_router.get("/devices", response_model=ResponseModel[DeviceStats])
async def devices(
    days: int = 30,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[DeviceStats]:
    data = await analytics_service.devices(session, days)
    return ResponseModel(data=DeviceStats(**data))
