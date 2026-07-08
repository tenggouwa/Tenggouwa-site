from datetime import datetime

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    sources: list[str] | None = None


class KBSourceOverview(BaseModel):
    kind: str
    name: str
    documents: int
    chunks: int
    embedded: int
    last_synced_at: datetime | None = None


class KBDocumentItem(BaseModel):
    id: int
    title: str
    url: str | None = None
    chunks: int
    updated_at: datetime


class KBDocumentPage(BaseModel):
    items: list[KBDocumentItem]
    total: int
    limit: int
    offset: int
    has_more: bool  # 省略=全部源；如 ["blog"]


class Citation(BaseModel):
    title: str
    url: str | None = None


class ReindexResult(BaseModel):
    source: str
    documents_total: int
    documents_changed: int
    chunks: int
