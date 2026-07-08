from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)  # 多轮：前端持有并回传
