from datetime import datetime

from pydantic import BaseModel


class SearchHit(BaseModel):
    type: str  # "post" | "inspiration"
    id: int
    title: str  # post 的标题；inspiration 用截断 content 当 title
    url: str  # 前端跳转路径
    snippet: str  # 含 <mark>关键词</mark> 高亮
    score: float
    tags: list[str] = []
    timestamp: datetime | None = None  # post.published_at 或 inspiration.created_at


class SearchResponse(BaseModel):
    query: str
    took_ms: int
    total: int
    hits: list[SearchHit]
