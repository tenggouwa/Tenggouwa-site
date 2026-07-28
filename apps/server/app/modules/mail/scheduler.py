"""Mail retention maintenance jobs."""

import logging
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from db import async_pg

from .repository import MailRepository

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


async def run_mail_retention() -> None:
    """Purge expired disposable mailbox messages without retaining their contents in logs."""
    now = datetime.now(UTC)
    try:
        async with async_pg.session() as session:
            deleted = await MailRepository(session).delete_expired(now)
        logger.info("Mail retention deleted %d expired messages", deleted)
    except Exception:
        logger.exception("Mail retention failed")


def start_mail_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    scheduler = AsyncIOScheduler(timezone=UTC)
    scheduler.add_job(
        run_mail_retention,
        CronTrigger(hour=2, minute=15, timezone=UTC),
        id="mail_retention_daily",
        name="Mail expiry retention",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Mail scheduler started: retention@02:15 UTC")


def stop_mail_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("Mail scheduler stopped")


def scheduler_status() -> dict:
    """Return safe scheduler metadata for the admin operations overview."""
    jobs = []
    if _scheduler is not None:
        jobs = [
            {"id": job.id, "next_run": job.next_run_time.isoformat() if job.next_run_time else None}
            for job in _scheduler.get_jobs()
        ]
    return {"running": _scheduler is not None, "jobs": jobs}
