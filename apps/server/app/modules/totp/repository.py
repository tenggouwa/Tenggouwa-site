from datetime import datetime, timezone

from db.models import AdminTotpRow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class AdminTotpRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, username: str) -> AdminTotpRow | None:
        stmt = select(AdminTotpRow).where(AdminTotpRow.username == username)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def upsert_pending(self, username: str, secret_b32: str) -> None:
        """创建或重置一个待验证的 secret（enrolled_at=NULL）。"""
        row = await self.get(username)
        if row is None:
            row = AdminTotpRow(
                username=username,
                secret_b32=secret_b32,
                enrolled_at=None,
                last_verified_at=None,
                disabled=False,
            )
            self.session.add(row)
        else:
            row.secret_b32 = secret_b32
            row.enrolled_at = None
            row.last_verified_at = None
            row.disabled = False
        await self.session.flush()

    async def mark_enrolled(self, username: str) -> None:
        row = await self.get(username)
        if row is None:
            return
        now = datetime.now(timezone.utc)
        row.enrolled_at = now
        row.last_verified_at = now
        await self.session.flush()

    async def touch_verified(self, username: str) -> None:
        row = await self.get(username)
        if row is None:
            return
        row.last_verified_at = datetime.now(timezone.utc)
        await self.session.flush()

    async def delete(self, username: str) -> bool:
        row = await self.get(username)
        if row is None:
            return False
        await self.session.delete(row)
        await self.session.flush()
        return True
