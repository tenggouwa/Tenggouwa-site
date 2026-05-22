import logging

from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import (
    IndexingStatus,
    KeywordStat,
    SearchChannelOverview,
    SearchUrlStat,
    VitalsMetricSummary,
    VitalsOverview,
    VitalsReport,
    VitalsTrendPoint,
)
from .service import seo_service

logger = logging.getLogger(__name__)

# 公开上报：前端 web-vitals 包发过来
public_router = APIRouter(prefix="/public/vitals", tags=["public.vitals"])


@public_router.post("", response_model=ResponseModel[dict])
async def report_vitals(
    payload: VitalsReport,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    ip = request.headers.get("cf-connecting-ip") or _client_ip(request)
    ua = request.headers.get("user-agent")
    ok = await seo_service.record_vitals(session, payload, ip=ip, ua=ua)
    return ResponseModel(data={"recorded": ok})


def _client_ip(request: Request) -> str | None:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


# Admin 聚合查询
admin_router = APIRouter(
    prefix="/admin/seo",
    tags=["admin.seo"],
    dependencies=[Depends(current_admin)],
)


@admin_router.get("/vitals", response_model=ResponseModel[VitalsOverview])
async def vitals_overview(
    days: int = Query(default=30, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[VitalsOverview]:
    data = await seo_service.vitals_overview(session, days)
    return ResponseModel(
        data=VitalsOverview(
            by_metric=[VitalsMetricSummary(**m) for m in data["by_metric"]],
            trend=[VitalsTrendPoint(**t) for t in data["trend"]],
            mobile_ratio=data["mobile_ratio"],
            samples_total=data["samples_total"],
        )
    )


@admin_router.get("/search", response_model=ResponseModel[SearchChannelOverview])
async def search_overview(
    channel: str = Query(default="google", pattern="^(google|bing|baidu)$"),
    days: int = Query(default=30, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[SearchChannelOverview]:
    data = await seo_service.search_overview(session, channel, days)
    return ResponseModel(
        data=SearchChannelOverview(
            channel=data["channel"],
            snapshot_date=data["snapshot_date"],
            impressions_total=data["impressions_total"],
            clicks_total=data["clicks_total"],
            ctr_avg=data["ctr_avg"],
            position_avg=data["position_avg"],
            indexed_count=data["indexed_count"],
            top_urls=[SearchUrlStat(**u) for u in data["top_urls"]],
        )
    )


@admin_router.get("/keywords", response_model=ResponseModel[list[KeywordStat]])
async def keywords(
    channel: str = Query(default="google", pattern="^(google|bing|baidu)$"),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=30, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[KeywordStat]]:
    data = await seo_service.keywords(session, channel, days, limit)
    return ResponseModel(data=[KeywordStat(**d) for d in data])


@admin_router.get("/indexing", response_model=ResponseModel[list[IndexingStatus]])
async def indexing(
    days: int = Query(default=30, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[IndexingStatus]]:
    data = await seo_service.indexing_status(session, days)
    return ResponseModel(data=[IndexingStatus(**d) for d in data])
