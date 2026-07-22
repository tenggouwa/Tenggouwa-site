from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    # 正常提问 q 必填；C2 审批续跑时 q 可空、只带 approvals（tool_call_id -> 批准与否）。
    q: str = Field(default="", max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)  # 多轮：前端持有并回传
    approvals: dict[str, bool] | None = Field(default=None)  # C2：审批决策，非空则走 resume
    auto_approve: bool = Field(default=False)  # auto 模式：私有通道内不暂停审批、直接执行（沙箱兜底）
    deep_think: bool = Field(default=False)  # 深度思考：换 deepseek-reasoner，回传思维链 reasoning
    reflect: bool = Field(default=False)  # 反思：答完自评→按需改写（evaluator-optimizer），回传 reflect 过程


class AgentUnlockRequest(BaseModel):
    # 私有通道 TOTP 解锁：6 位数字码 → 换长 TTL 的 agent_token。
    totp: str = Field(..., min_length=6, max_length=6)


class AgentUnlockResponse(BaseModel):
    token: str
    ttl_seconds: int


class AgentSessionInfo(BaseModel):
    """会话列表里的一条（不含消息正文）。"""

    id: str
    title: str | None = None
    updated_at: str


class AgentMemoryItem(BaseModel):
    """长期记忆列表里的一条（记忆面板用）。"""

    id: int
    content: str
    created_at: str


class AgentTranscriptTurn(BaseModel):
    q: str
    tools: list[dict] = Field(default_factory=list)  # [{name, args}]
    answer: str = ""


class AgentTranscript(BaseModel):
    id: str
    title: str | None = None
    turns: list[AgentTranscriptTurn] = Field(default_factory=list)
