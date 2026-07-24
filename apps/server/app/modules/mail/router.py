"""mail 模块路由。"""

import logging
from datetime import datetime

from common.rate_limit import AttemptLimiter, client_ip
from db import get_session
from dependencies import current_admin
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import LatestCodeResult, MailInboxItem, MailIngestPayload, MailMessageItem
from .service import mail_service

logger = logging.getLogger(__name__)

# ingest 来源是固定的 CF Worker 出口，per-ip 限流意义有限，只作 backstop；主力挡伪造靠 HMAC。
_ingest_limiter = AttemptLimiter(per_ip=60, ip_window=60, total=240, total_window=60)

# CF Email Worker 收信回调：HMAC 鉴权，无 JWT
ingest_router = APIRouter(prefix="/ingest/mail", tags=["ingest.mail"])


@ingest_router.post("", response_model=ResponseModel[dict])
async def ingest(
    request: Request,
    x_mail_timestamp: str | None = Header(default=None),
    x_mail_signature: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[dict]:
    """接收 Worker 投递的一封邮件，抽码幂等入库。"""
    _ingest_limiter.hit(client_ip(request))
    raw = await request.body()  # 签名基于原始字节，先读 body 再反序列化
    if not mail_service.verify_hmac(raw, x_mail_timestamp, x_mail_signature):
        logger.warning("mail ingest: bad signature from %s", client_ip(request))
        raise HTTPException(status_code=401, detail="invalid signature")
    payload = MailIngestPayload.model_validate_json(raw)
    is_new = await mail_service.ingest(session, payload)
    return ResponseModel(data={"ok": True, "new": is_new})


# admin 后台查询：JWT 鉴权
admin_router = APIRouter(prefix="/admin/mail", tags=["admin.mail"], dependencies=[Depends(current_admin)])


@admin_router.get("/inboxes", response_model=ResponseModel[list[MailInboxItem]])
async def list_inboxes(
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[MailInboxItem]]:
    """列出所有收过信的收件箱（哪些地址被用过）。"""
    items = await mail_service.list_inboxes(session)
    return ResponseModel(data=items)


@admin_router.get("/{mailbox}/latest-code", response_model=ResponseModel[LatestCodeResult])
async def latest_code(
    mailbox: str,
    since: datetime | None = Query(default=None, description="只取此时间之后的码"),
    wait: float = Query(default=0, ge=0, le=25, description="等码秒数，>0 时短轮询直到有码或超时"),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[LatestCodeResult]:
    """取某收件箱最近的验证码，可选「等码」短轮询。"""
    result = await mail_service.latest_code(session, mailbox, since=since, wait_seconds=wait)
    return ResponseModel(data=result)


@admin_router.get("/{mailbox}/messages", response_model=ResponseModel[list[MailMessageItem]])
async def list_messages(
    mailbox: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[list[MailMessageItem]]:
    """列某收件箱的邮件，最近在前。"""
    items = await mail_service.list_messages(session, mailbox, limit=limit, offset=offset)
    return ResponseModel(data=items)
