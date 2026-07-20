"""Agent maintenance jobs."""

import logging
import os
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from db import async_pg

from .repository import AgentRepository

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


def _anonymous_retention_days() -> int:
    try:
        return max(1, int(os.environ.get("AGENT_ANONYMOUS_RETENTION_DAYS", "7")))
    except ValueError:
        return 7


async def _run_anonymous_retention() -> None:
    cutoff = datetime.now(UTC) - timedelta(days=_anonymous_retention_days())
    try:
        async with async_pg.session() as session:
            deleted = await AgentRepository(session).delete_anonymous_before(cutoff)
        logger.info("Agent anonymous retention deleted %d sessions before %s", deleted, cutoff.isoformat())
    except Exception:
        logger.exception("Agent anonymous retention failed")


def start_agent_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    scheduler = AsyncIOScheduler(timezone=UTC)
    scheduler.add_job(
        _run_anonymous_retention,
        CronTrigger(hour=2, minute=30, timezone=UTC),
        id="agent_anonymous_retention_daily",
        name="Agent anonymous session retention",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Agent scheduler started: anonymous-retention@02:30 UTC")


def stop_agent_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("Agent scheduler stopped")
