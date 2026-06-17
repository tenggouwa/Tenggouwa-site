from pydantic import BaseModel, Field


class PiReport(BaseModel):
    """pi-agent 周期上报的一条遥测快照。"""

    hostname: str = Field(..., min_length=1, max_length=64)
    model: str | None = Field(default=None, max_length=128)
    # 自由指标体：uptime_s / cpu_temp_c / load1 / mem_used_mb 等，前端按需取。
    metrics: dict[str, float] = Field(default_factory=dict)


class PiHistoryPoint(BaseModel):
    ts: str
    cpu_temp_c: float | None = None
    load1: float | None = None


class PiStatus(BaseModel):
    """前台 /pi 面板用的当前状态。Pi 离线时 online=False，仍返回最后一次快照。"""

    online: bool
    last_seen: str | None = None
    age_seconds: float | None = None
    hostname: str | None = None
    model: str | None = None
    metrics: dict[str, float] | None = None
    history: list[PiHistoryPoint] = Field(default_factory=list)
