import logging

from dependencies import DetailedHTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .repository import InspirationRepository
from .schema import Inspiration, InspirationCreate

logger = logging.getLogger(__name__)


class InspirationService:
    async def create(self, session: AsyncSession, payload: InspirationCreate) -> Inspiration:
        return await InspirationRepository(session).create(payload)

    async def delete(self, session: AsyncSession, item_id: int) -> None:
        if not await InspirationRepository(session).delete(item_id):
            raise DetailedHTTPException(
                status_code=404,
                detail="inspiration not found",
                full_detail=f"id={item_id}",
            )

    async def list_all(self, session: AsyncSession) -> list[Inspiration]:
        return await InspirationRepository(session).list_all()


inspiration_service = InspirationService()
