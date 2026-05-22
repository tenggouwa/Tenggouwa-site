from datetime import date

from pydantic import BaseModel, Field

# ---------- Web Vitals 上报（公开） ----------


class VitalsReport(BaseModel):
    """前端 web-vitals 包上报的一次指标。"""

    path: str = Field(..., min_length=1, max_length=500)
    metric: str = Field(..., pattern="^(LCP|CLS|INP|FCP|TTFB)$")
    value: float = Field(..., ge=0)
    rating: str = Field(..., pattern="^(good|needs-improvement|poor)$")
    nav_type: str | None = Field(default=None, max_length=32)


# ---------- Web Vitals 聚合（admin） ----------


class VitalsMetricSummary(BaseModel):
    metric: str  # LCP / CLS / INP / FCP / TTFB
    p75: float
    p95: float
    good_ratio: float  # 0..1
    samples: int


class VitalsTrendPoint(BaseModel):
    date: date
    p75_lcp: float | None
    p75_cls: float | None
    p75_inp: float | None


class VitalsOverview(BaseModel):
    by_metric: list[VitalsMetricSummary]
    trend: list[VitalsTrendPoint]
    mobile_ratio: float
    samples_total: int


# ---------- 搜索引擎数据（admin） ----------


class SearchUrlStat(BaseModel):
    url: str
    impressions: int
    clicks: int
    ctr: float
    position: float


class SearchChannelOverview(BaseModel):
    channel: str  # google / bing / baidu
    snapshot_date: date | None
    impressions_total: int
    clicks_total: int
    ctr_avg: float
    position_avg: float
    indexed_count: int
    top_urls: list[SearchUrlStat]


class KeywordStat(BaseModel):
    query: str
    occurrences: int  # 出现在多少篇文章的 top_queries 里


class IndexingStatus(BaseModel):
    url: str
    google_indexed: bool
    bing_indexed: bool
    baidu_indexed: bool
    last_checked: date | None
