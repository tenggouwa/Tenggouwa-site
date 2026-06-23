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


class PiArtifactReport(BaseModel):
    """Pi 每日产物上报（如它自己算的 ASCII 曼德博集合）。"""

    kind: str = Field(..., min_length=1, max_length=32)
    title: str = Field(default="", max_length=200)
    content: str = Field(..., max_length=20000)
    meta: dict = Field(default_factory=dict)


class PiArtifact(BaseModel):
    kind: str
    title: str
    content: str
    meta: dict
    ts: str | None = None


class PiProbeReport(BaseModel):
    """一次探针测量（HTTP 延迟 / 下行吞吐等）。"""

    name: str = Field(..., min_length=1, max_length=32)
    ok: bool
    value: float | None = None
    unit: str = Field(default="", max_length=16)


class PiProbe(BaseModel):
    """前台展示：某探针目标的当前值 + 历史序列。"""

    name: str
    ok: bool
    value: float | None = None
    unit: str = ""
    ts: str | None = None
    history: list[float | None] = Field(default_factory=list)
