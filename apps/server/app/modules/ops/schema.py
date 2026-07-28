"""Safe, admin-only operations overview contracts."""

from pydantic import BaseModel, Field


class OpsJob(BaseModel):
    id: str
    next_run: str | None = None


class OpsScheduler(BaseModel):
    running: bool
    jobs: list[OpsJob] = Field(default_factory=list)


class OpsMcp(BaseModel):
    configured: int
    connected: list[str] = Field(default_factory=list)
    tool_count: int = 0


class OpsPi(BaseModel):
    online: bool
    last_seen: str | None = None
    age_seconds: float | None = None


class OpsOverview(BaseModel):
    environment: str
    alembic_revision: str | None = None
    agent_scheduler: OpsScheduler
    mail_scheduler: OpsScheduler
    mcp: OpsMcp
    pi: OpsPi
