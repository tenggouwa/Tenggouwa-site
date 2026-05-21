from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Agent(BaseModel):
    id: int
    name: str
    created_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None
    online: bool  # broker 里在不在


class AgentLite(BaseModel):
    """C 端公开返回的 agent 简版（不含 created_at / revoked_at 等内部字段）。"""

    id: int
    name: str
    online: bool


class AgentIssueRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class AgentIssueResponse(BaseModel):
    id: int
    name: str
    token: str  # raw token，仅这一次返回，让用户复制到 Mac
    base_url: str  # agent 连的 wss 地址


class ConsoleUnlockRequest(BaseModel):
    method: Literal["voice", "totp"]
    voice_transcript: str | None = Field(default=None, max_length=200)
    code: str | None = Field(default=None, min_length=6, max_length=6, pattern=r"^\d{6}$")


class ConsoleUnlockResponse(BaseModel):
    term_token: str
    ttl_seconds: int
    agents: list[AgentLite]
    phrase: str  # 当前生效的口令，前端展示用


class TerminalSessionLog(BaseModel):
    id: int
    agent_id: int
    opened_at: datetime
    closed_at: datetime | None
    bytes_in: int
    bytes_out: int
    unlock_method: str
    voice_transcript: str | None
    client_ip: str | None
