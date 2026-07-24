"""mail 模块路由。"""

import logging

from common.rate_limit import AttemptLimiter, client_ip
from db import get_session
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import MailIngestPayload
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
