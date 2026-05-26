from datetime import datetime

from pydantic import BaseModel, Field


class InspirationCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    mood: str | None = Field(default=None, max_length=64)


class Inspiration(BaseModel):
    id: int
    content: str
    mood: str | None = None
    created_at: datetime


class InspirationListPage(BaseModel):
    items: list[Inspiration]
    total: int
    limit: int
    offset: int
    has_more: bool
