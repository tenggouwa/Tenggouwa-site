from datetime import datetime

from pydantic import BaseModel, Field


class PostCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9\-]*$")
    title: str = Field(..., min_length=1, max_length=200)
    summary: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list)
    content: str = Field(..., min_length=1)
    published_at: datetime | None = None


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = None
    content: str | None = None
    published_at: datetime | None = None


class Post(BaseModel):
    id: int
    slug: str
    title: str
    summary: str
    tags: list[str]
    content: str
    published_at: datetime


class PostSummary(BaseModel):
    id: int
    slug: str
    title: str
    summary: str
    tags: list[str]
    published_at: datetime
