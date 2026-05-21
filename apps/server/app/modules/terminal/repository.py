from datetime import datetime, timezone

from db.models import AgentRow, TerminalSessionRow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class AgentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, name: str, owner: str, token_sha256: str) -> AgentRow:
        row = AgentRow(name=name, owner=owner, token_sha256=token_sha256)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_by_token_sha(self, token_sha256: str) -> AgentRow | None:
        stmt = select(AgentRow).where(
            AgentRow.token_sha256 == token_sha256,
            AgentRow.revoked_at.is_(None),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_by_id(self, agent_id: int) -> AgentRow | None:
        return await self.session.get(AgentRow, agent_id)

    async def list_by_owner(self, owner: str) -> list[AgentRow]:
        stmt = (
            select(AgentRow)
            .where(AgentRow.owner == owner)
            .order_by(AgentRow.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def touch_seen(self, agent_id: int) -> None:
        row = await self.get_by_id(agent_id)
        if row is None:
            return
        row.last_seen_at = datetime.now(timezone.utc)
        await self.session.flush()

    async def revoke(self, agent_id: int) -> bool:
        row = await self.get_by_id(agent_id)
        if row is None:
            return False
        row.revoked_at = datetime.now(timezone.utc)
        await self.session.flush()
        return True


class TerminalSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def open(
        self,
        *,
        agent_id: int,
        owner: str,
        unlock_method: str,
        voice_transcript: str | None,
        client_ip: str | None,
        client_ua: str | None,
    ) -> TerminalSessionRow:
        row = TerminalSessionRow(
            agent_id=agent_id,
            owner=owner,
            unlock_method=unlock_method,
            voice_transcript=voice_transcript,
            client_ip=client_ip,
            client_ua=client_ua,
        )
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def close(self, session_id: int, *, bytes_in: int, bytes_out: int) -> None:
        row = await self.session.get(TerminalSessionRow, session_id)
        if row is None:
            return
        row.closed_at = datetime.now(timezone.utc)
        row.bytes_in = bytes_in
        row.bytes_out = bytes_out
        await self.session.flush()

    async def list_recent(self, owner: str, limit: int = 50) -> list[TerminalSessionRow]:
        stmt = (
            select(TerminalSessionRow)
            .where(TerminalSessionRow.owner == owner)
            .order_by(TerminalSessionRow.opened_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())
