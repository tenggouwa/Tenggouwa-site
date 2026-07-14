from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    # 正常提问 q 必填；C2 审批续跑时 q 可空、只带 approvals（tool_call_id -> 批准与否）。
    q: str = Field(default="", max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)  # 多轮：前端持有并回传
    approvals: dict[str, bool] | None = Field(default=None)  # C2：审批决策，非空则走 resume
    auto_approve: bool = Field(default=False)  # auto 模式：私有通道内不暂停审批、直接执行（沙箱兜底）


class AgentUnlockRequest(BaseModel):
    # 私有通道 TOTP 解锁：6 位数字码 → 换长 TTL 的 agent_token。
    totp: str = Field(..., min_length=6, max_length=6)


class AgentUnlockResponse(BaseModel):
    token: str
    ttl_seconds: int
