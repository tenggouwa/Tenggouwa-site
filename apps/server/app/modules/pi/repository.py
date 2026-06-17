"""pi_snapshot 读写。最新一行 = 当前状态；recent 给前端画 sparkline。"""

from datetime import UTC, datetime, timedelta

from db.models import PiSnapshotRow
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession


class PiRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def insert(self, hostname: str, metrics: dict) -> None:
        self.session.add(PiSnapshotRow(hostname=hostname, metrics=metrics))
        await self.session.flush()

    async def prune(self, days: int) -> None:
        """删超过保留期的旧快照。走 ix_pi_snapshot_ts 索引，稳态下每次约删 1 行，
        表不再无限增长（每 30s 一行，常开一天 ~2880 行）。"""
        cutoff = datetime.now(UTC) - timedelta(days=days)
        await self.session.execute(delete(PiSnapshotRow).where(PiSnapshotRow.ts < cutoff))

    async def latest(self) -> PiSnapshotRow | None:
        return await self.session.scalar(select(PiSnapshotRow).order_by(PiSnapshotRow.ts.desc()).limit(1))

    async def recent(self, hostname: str, limit: int) -> list[PiSnapshotRow]:
        """某主机最近 limit 条，按时间正序返回（便于前端直接画图）。
        按 hostname 过滤，避免历史 sparkline 混入别的机器 / 测试数据。"""
        rows = (
            (
                await self.session.execute(
                    select(PiSnapshotRow)
                    .where(PiSnapshotRow.hostname == hostname)
                    .order_by(PiSnapshotRow.ts.desc())
                    .limit(limit),
                )
            )
            .scalars()
            .all()
        )
        return list(reversed(rows))
