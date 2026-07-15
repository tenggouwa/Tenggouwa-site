from pydantic import BaseModel, Field


class PiExecCommand(BaseModel):
    """一条待 Pi 执行的命令（exec-poll 返回给 Pi）：shell（cmd）或文件操作（kind=file）。"""

    id: str
    timeout: float = 30.0
    # shell：
    cmd: str | None = None
    cwd: str = "workspace"
    # 文件操作（kind=file）：
    kind: str | None = None  # None=shell；"file"=文件操作
    op: str | None = None  # read / write / list
    path: str | None = None
    content: str | None = None


class PiExecPollResponse(BaseModel):
    command: PiExecCommand | None = None  # null = 本轮无命令，Pi 立即再轮询


class PiExecResult(BaseModel):
    """Pi 执行完回传的结果。"""

    id: str = Field(..., max_length=64)
    rc: int
    output: str = Field(default="", max_length=200_000)
    truncated: bool = False
    timed_out: bool = False


class PiExecChunk(BaseModel):
    """Pi 边跑边推的一块流式输出。"""

    id: str = Field(..., max_length=64)
    chunk: str = Field(default="", max_length=64_000)


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
