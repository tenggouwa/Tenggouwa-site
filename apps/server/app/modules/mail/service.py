"""mail 模块业务编排：HMAC 校验 + ingest。"""

import asyncio
import hashlib
import hmac
import logging
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from common import config
from sqlalchemy.ext.asyncio import AsyncSession

from .extract import extract_code
from .repository import MailRepository
from .schema import LatestCodeResult, MailIngestPayload, MailMessageItem

logger = logging.getLogger(__name__)

_TZ = ZoneInfo("Asia/Shanghai")
_HMAC_WINDOW_SECONDS = 300  # 时间戳容忍窗口，防重放
_POLL_INTERVAL = 1.0  # 「等码」短轮询间隔（秒）


class MailService:
    """收信编排。单例 mail_service。"""

    def verify_hmac(
        self,
        raw_body: bytes,
        timestamp: str | None,
        signature: str | None,
        *,
        now: float | None = None,
    ) -> bool:
        """校验 Worker 的 HMAC 签名。

        签名对象 = ``HMAC_SHA256(secret, f"{timestamp}." + raw_body)``；
        并要求 timestamp 落在 ±5 分钟窗口内，防重放。
        """
        secret = config.get("MAIL_INGEST_SECRET")
        if not secret or not timestamp or not signature:
            return False
        try:
            ts = int(timestamp)
        except ValueError:
            return False
        current = time.time() if now is None else now
        if abs(current - ts) > _HMAC_WINDOW_SECONDS:
            return False
        expected = hmac.new(
            str(secret).encode(),
            f"{timestamp}.".encode() + raw_body,
            hashlib.sha256,
        ).hexdigest()
        provided = signature[7:] if signature.startswith("sha256=") else signature
        return hmac.compare_digest(expected, provided)

    def ttl_hours(self) -> int:
        """邮件保留小时数，默认 24。"""
        return int(config.get("mail.ttl_hours") or 24)

    async def ingest(
        self,
        session: AsyncSession,
        payload: MailIngestPayload,
        *,
        now: datetime | None = None,
    ) -> bool:
        """把一封邮件抽码后幂等入库。

        Returns:
            True 表示新入库；False 表示重复投递（message_id 已存在）。
        """
        to_address = payload.to.strip().lower()
        mailbox = to_address.split("@", 1)[0]

        code = payload.code
        code_kind = "numeric" if code else None
        if not code:
            code, code_kind = extract_code(payload.subject, payload.body)

        moment = now or datetime.now(_TZ)
        expires_at = moment + timedelta(hours=self.ttl_hours())

        repo = MailRepository(session)
        return await repo.upsert_message(
            message_id=payload.message_id,
            to_address=to_address,
            mailbox=mailbox,
            from_address=payload.from_,
            subject=payload.subject,
            text_body=payload.body,
            code=code,
            code_kind=code_kind,
            sent_at=payload.sent_at,
            received_at=moment,
            expires_at=expires_at,
        )

    async def latest_code(
        self,
        session: AsyncSession,
        mailbox: str,
        *,
        since: datetime | None = None,
        wait_seconds: float = 0,
    ) -> LatestCodeResult:
        """取某收件箱最近的验证码；``wait_seconds>0`` 时短轮询等新码到达。

        每轮都重新查库（Postgres READ COMMITTED 下能读到其它请求刚提交的 ingest），
        不依赖内存唤醒，天然避开「ingest 先提交再通知」的时序竞态。
        """
        mailbox = mailbox.strip().lower()
        repo = MailRepository(session)
        row = await repo.latest_code(mailbox, since=since)
        waited = 0.0
        while row is None and waited < wait_seconds:
            await asyncio.sleep(_POLL_INTERVAL)
            waited += _POLL_INTERVAL
            row = await repo.latest_code(mailbox, since=since)
        if row is None:
            return LatestCodeResult()
        return LatestCodeResult(
            code=row.code,
            message_id=row.message_id,
            subject=row.subject,
            received_at=row.received_at,
        )

    async def list_messages(
        self,
        session: AsyncSession,
        mailbox: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MailMessageItem]:
        """列某收件箱的邮件，最近在前。"""
        mailbox = mailbox.strip().lower()
        repo = MailRepository(session)
        rows = await repo.list_messages(mailbox, limit=limit, offset=offset)
        return [
            MailMessageItem(
                id=row.id,
                from_address=row.from_address,
                subject=row.subject,
                code=row.code,
                received_at=row.received_at,
            )
            for row in rows
        ]


mail_service = MailService()
