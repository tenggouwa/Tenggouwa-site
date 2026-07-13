from datetime import UTC, datetime

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
        now = datetime.now(UTC)
        row.enrolled_at = now
        row.last_verified_at = now
        await self.session.flush()

    async def touch_verified(self, username: str) -> None:
        row = await self.get(username)
        if row is None:
            return
        row.last_verified_at = datetime.now(UTC)
        await self.session.flush()

    async def agent_epoch(self, username: str) -> int:
        """当前 agent_token 吊销纪元；无此 admin 记录按 0 处理。"""
        row = await self.get(username)
        return row.agent_epoch if row else 0

    async def bump_agent_epoch(self, username: str) -> int:
        """纪元 +1（"注销所有 agent 会话"），返回新纪元；无记录则不动返回 0。"""
        row = await self.get(username)
        if row is None:
            return 0
        row.agent_epoch += 1
        await self.session.flush()
        return row.agent_epoch

    async def delete(self, username: str) -> bool:
        row = await self.get(username)
        if row is None:
            return False
        await self.session.delete(row)
        await self.session.flush()
        return True
