from datetime import date

from pydantic import BaseModel, Field


class TrackRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    referrer: str | None = Field(default=None, max_length=500)


class DailyPoint(BaseModel):
    date: date
    pv: int
    uv: int


class OverviewResponse(BaseModel):
    pv_total: int
    uv_total: int
    pv_today: int
    uv_today: int
    daily: list[DailyPoint]


class TopPage(BaseModel):
    path: str
    pv: int
    uv: int


class TopReferrer(BaseModel):
    referrer: str  # "(direct)" 表示无 referrer
    pv: int


class CountryStat(BaseModel):
    country: str  # 两位 ISO 或 "?"
    pv: int


class PostHeat(BaseModel):
    slug: str  # 文章 slug（由 /posts/<slug> 路径解析）
    pv: int


class DeviceStats(BaseModel):
    browsers: list["NameCount"]
    os: list["NameCount"]
    mobile_ratio: float  # 0..1


class NameCount(BaseModel):
    name: str
    pv: int


DeviceStats.model_rebuild()
