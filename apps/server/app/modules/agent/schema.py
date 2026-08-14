from pydantic import BaseModel, Field


class AgentAttachment(BaseModel):
    """Browser-provided attachment. Content is request-only and is never persisted in a session."""

    name: str = Field(..., min_length=1, max_length=120)
    media_type: str = Field(..., pattern=r"^(application/pdf|image/(jpeg|png|webp))$")
    data: str = Field(..., min_length=1, max_length=11_200_000)  # base64, max raw size is checked server-side


class AgentChatRequest(BaseModel):
    # 正常提问 q 必填；C2 审批续跑时 q 可空、只带 approvals（tool_call_id -> 批准与否）。
    q: str = Field(default="", max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)  # 多轮：前端持有并回传
    approvals: dict[str, bool] | None = Field(default=None)  # C2：审批决策，非空则走 resume
    auto_approve: bool = Field(default=False)  # auto 模式：私有通道内不暂停审批、直接执行（沙箱兜底）
    deep_think: bool = Field(default=False)  # 深度思考：换 deepseek-reasoner，回传思维链 reasoning
    reflect: bool = Field(default=False)  # 反思：答完自评→按需改写（evaluator-optimizer），回传 reflect 过程
    auto_model: bool = Field(default=False)  # 模型路由：判题难易自动选快模型/reasoner，回传 route 事件
    attachments: list[AgentAttachment] = Field(default_factory=list, max_length=3)


class AgentTaskCreateRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, max_length=32)
    auto_approve: bool = False
    deep_think: bool = False
    reflect: bool = False
    auto_model: bool = False


class AgentTaskItem(BaseModel):
    id: str
    session_id: str
    status: str
    error: str | None = None
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None


class AgentTaskApprovalRequest(BaseModel):
    approvals: dict[str, bool] = Field(min_length=1)


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


class AgentRunItem(BaseModel):
    id: int
    session_id: str
    model: str
    deep: bool
    reflect: bool
    auto_model: bool
    status: str
    tool_names: list[str] = Field(default_factory=list)
    tool_count: int
    duration_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    created_at: str


class AgentMemoryItem(BaseModel):
    """长期记忆列表里的一条（记忆面板用）。"""

    id: int
    content: str
    created_at: str


class AgentCustomSkill(BaseModel):
    """owner 自定义 skill（管理 UI 用）。"""

    id: int
    name: str
    description: str
    parameters: dict = Field(default_factory=dict)
    kind: str  # http | prompt
    config: dict = Field(default_factory=dict)
    enabled: bool = True
    created_at: str


class AgentCustomSkillUpsert(BaseModel):
    """新建 / 更新自定义 skill 的入参（按 name upsert）。"""

    name: str = Field(..., max_length=64)
    description: str = Field(..., max_length=2000)
    parameters: dict = Field(default_factory=dict)
    kind: str = Field(..., max_length=16)  # http | prompt
    config: dict = Field(default_factory=dict)


class AgentSkillProposal(BaseModel):
    """agent 自提的技能提案（提案面板用）。"""

    id: int
    name: str
    description: str
    parameters: dict = Field(default_factory=dict)
    rationale: str = ""
    created_at: str


class AgentInboxItem(BaseModel):
    """收件箱里的一条（主动/定时任务产出）。"""

    id: int
    title: str
    body: str
    created_at: str
    read: bool


class AgentProactiveRequest(BaseModel):
    """手动触发一次主动运行：agent 自主完成 prompt，结果进收件箱。"""

    prompt: str = Field(..., min_length=1, max_length=2000)
    title: str = Field(default="手动触发", max_length=200)


class AgentTranscriptTurn(BaseModel):
    q: str
    tools: list[dict] = Field(default_factory=list)  # [{name, args}]
    answer: str = ""


class AgentTranscript(BaseModel):
    id: str
    title: str | None = None
    turns: list[AgentTranscriptTurn] = Field(default_factory=list)
