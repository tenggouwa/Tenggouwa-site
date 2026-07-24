"""mail 模块 Pydantic schema。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MailIngestPayload(BaseModel):
    """Cloudflare Email Worker → 后端 ingest 的载荷。"""

    model_config = ConfigDict(populate_by_name=True)

    message_id: str
    to: str
    from_: str | None = Field(default=None, alias="from")
    subject: str | None = None
    body: str | None = None  # 可读正文（纯文本或 HTML 去标签）
    code: str | None = None  # Worker 预抽的验证码（后端会兜底再抽）
    sent_at: datetime | None = None  # 邮件 Date 头


class MailMessageItem(BaseModel):
    """查询接口返回的单封邮件。"""

    id: int
    from_address: str | None
    subject: str | None
    code: str | None
    received_at: datetime


class MailInboxItem(BaseModel):
    """收件箱总览的一行。"""

    mailbox: str
    total: int
    with_code: int
    latest_at: datetime


class LatestCodeResult(BaseModel):
    """latest-code 查询结果。"""

    code: str | None = None
    message_id: str | None = None
    subject: str | None = None
    received_at: datetime | None = None
