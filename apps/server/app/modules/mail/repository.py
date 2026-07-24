"""mail 模块数据访问。"""

from datetime import datetime

from db import MailMessageRow
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession


class MailRepository:
    """mail_message 表读写。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert_message(
        self,
        *,
        message_id: str,
        to_address: str,
        mailbox: str,
        from_address: str | None,
        subject: str | None,
        text_body: str | None,
        code: str | None,
        code_kind: str | None,
        sent_at: datetime | None,
        received_at: datetime,
        expires_at: datetime,
    ) -> bool:
        """按 message_id 幂等插入。

        Returns:
            True 表示新插入；False 表示 message_id 已存在（重复投递）。
        """
        stmt = (
            pg_insert(MailMessageRow)
            .values(
                message_id=message_id,
                to_address=to_address,
                mailbox=mailbox,
                from_address=from_address,
                subject=subject,
                text_body=text_body,
                code=code,
                code_kind=code_kind,
                sent_at=sent_at,
                received_at=received_at,
                expires_at=expires_at,
            )
            .on_conflict_do_nothing(index_elements=["message_id"])
            .returning(MailMessageRow.id)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def latest_code(self, mailbox: str, *, since: datetime | None = None) -> MailMessageRow | None:
        """取某收件箱最近一封含验证码的邮件。"""
        stmt = (
            select(MailMessageRow)
            .where(MailMessageRow.mailbox == mailbox, MailMessageRow.code.isnot(None))
            .order_by(MailMessageRow.received_at.desc())
            .limit(1)
        )
        if since is not None:
            stmt = stmt.where(MailMessageRow.received_at > since)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_messages(self, mailbox: str, *, limit: int, offset: int) -> list[MailMessageRow]:
        """列某收件箱的邮件，最近在前。"""
        stmt = (
            select(MailMessageRow)
            .where(MailMessageRow.mailbox == mailbox)
            .order_by(MailMessageRow.received_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def delete_expired(self, now: datetime) -> int:
        """删掉已过期的邮件，返回删除条数。"""
        result = await self._session.execute(delete(MailMessageRow).where(MailMessageRow.expires_at < now))
        return result.rowcount or 0
