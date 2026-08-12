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


class OpsLiveSmoke(BaseModel):
    status: str
    completed_at: str | None = None
    summary: str
    url: str | None = None


class OpsAgentMetrics(BaseModel):
    """Recent aggregate Agent behavior without owner or conversation data."""

    window_hours: int
    total_runs: int
    completed_runs: int
    awaiting_approval_runs: int
    avg_duration_ms: int
    tool_calls: int
    prompt_tokens: int
    completion_tokens: int
    cache_hit_tokens: int
    cache_miss_tokens: int
    external_research_calls: int
    external_research_capped_runs: int
    p95_duration_ms: int
    long_running_runs: int
    high_prompt_runs: int
    failed_runs: int
    alert_level: str
    alerts: list[str] = Field(default_factory=list)


class OpsOverview(BaseModel):
    environment: str
    alembic_revision: str | None = None
    agent_scheduler: OpsScheduler
    mail_scheduler: OpsScheduler
    mcp: OpsMcp
    pi: OpsPi
    agent_metrics: OpsAgentMetrics
    live_smoke: OpsLiveSmoke
    live_smoke_history: list[OpsLiveSmoke] = Field(default_factory=list)
