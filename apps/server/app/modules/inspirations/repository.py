"""Inspiration 持久化层。"""

from db.models import InspirationRow
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import Inspiration, InspirationCreate


def _row_to_schema(row: InspirationRow) -> Inspiration:
    return Inspiration(
        id=row.id,
        content=row.content,
        mood=row.mood,
        created_at=row.created_at,
    )


class InspirationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, payload: InspirationCreate) -> Inspiration:
        row = InspirationRow(content=payload.content, mood=payload.mood)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return _row_to_schema(row)

    async def delete(self, item_id: int) -> bool:
        row = await self.session.get(InspirationRow, item_id)
        if row is None:
            return False
        await self.session.delete(row)
        await self.session.flush()
        return True

    async def list_all(self) -> list[Inspiration]:
        stmt = select(InspirationRow).order_by(InspirationRow.created_at.desc())
        rows = (await self.session.execute(stmt)).scalars().all()
        return [_row_to_schema(r) for r in rows]

    async def list_page(self, *, limit: int, offset: int) -> tuple[list[Inspiration], int]:
        stmt = select(InspirationRow).order_by(InspirationRow.created_at.desc()).limit(limit).offset(offset)
        rows = (await self.session.execute(stmt)).scalars().all()
        total = (await self.session.execute(select(func.count(InspirationRow.id)))).scalar_one()
        return [_row_to_schema(r) for r in rows], total
