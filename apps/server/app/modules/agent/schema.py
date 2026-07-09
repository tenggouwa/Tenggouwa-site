from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    # 正常提问 q 必填；C2 审批续跑时 q 可空、只带 approvals（tool_call_id -> 批准与否）。
    q: str = Field(default="", max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)  # 多轮：前端持有并回传
    approvals: dict[str, bool] | None = Field(default=None)  # C2：审批决策，非空则走 resume
