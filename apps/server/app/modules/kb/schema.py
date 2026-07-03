from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    sources: list[str] | None = None  # 省略=全部源；如 ["blog"]


class Citation(BaseModel):
    title: str
    url: str | None = None


class ReindexResult(BaseModel):
    source: str
    documents_total: int
    documents_changed: int
    chunks: int
