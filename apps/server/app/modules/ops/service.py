"""Operations overview aggregation with a deliberately small, non-sensitive surface."""

from common import config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent import scheduler as agent_scheduler
from ..mail import scheduler as mail_scheduler
from ..mcp.manager import mcp_manager
from ..pi.service import pi_service
from .schema import OpsMcp, OpsOverview, OpsPi, OpsScheduler


class OpsService:
    async def overview(self, session: AsyncSession) -> OpsOverview:
        revision = await session.scalar(text("select version_num from alembic_version limit 1"))
        pi = await pi_service.status(session)
        mcp = mcp_manager.status()
        return OpsOverview(
            environment=str(config.get("ENV") or "unknown"),
            alembic_revision=str(revision) if revision else None,
            agent_scheduler=OpsScheduler(**agent_scheduler.scheduler_status()),
            mail_scheduler=OpsScheduler(**mail_scheduler.scheduler_status()),
            mcp=OpsMcp(
                configured=mcp["configured"],
                connected=mcp["connected"],
                tool_count=len(mcp["tools"]),
            ),
            pi=OpsPi(online=pi.online, last_seen=pi.last_seen, age_seconds=pi.age_seconds),
        )


ops_service = OpsService()
