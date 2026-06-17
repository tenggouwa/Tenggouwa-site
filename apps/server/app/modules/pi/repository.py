"""pi_snapshot 读写。最新一行 = 当前状态；recent 给前端画 sparkline。"""

from db.models import PiSnapshotRow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class PiRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def insert(self, hostname: str, metrics: dict) -> None:
        self.session.add(PiSnapshotRow(hostname=hostname, metrics=metrics))
        await self.session.flush()

    async def latest(self) -> PiSnapshotRow | None:
        return await self.session.scalar(select(PiSnapshotRow).order_by(PiSnapshotRow.ts.desc()).limit(1))

    async def recent(self, limit: int) -> list[PiSnapshotRow]:
        """最近 limit 条，按时间正序返回（便于前端直接画图）。"""
        rows = (
            (
                await self.session.execute(
                    select(PiSnapshotRow).order_by(PiSnapshotRow.ts.desc()).limit(limit),
                )
            )
            .scalars()
            .all()
        )
        return list(reversed(rows))
