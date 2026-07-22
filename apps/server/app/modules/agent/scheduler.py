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


def _proactive_config() -> tuple[str, str, int] | None:
    """主动任务配置（env 门控，未配则 inert）：AGENT_PROACTIVE_OWNER / _PROMPT / _HOUR(UTC)。"""
    owner = os.environ.get("AGENT_PROACTIVE_OWNER", "").strip()
    prompt = os.environ.get("AGENT_PROACTIVE_PROMPT", "").strip()
    if not (owner and prompt):
        return None
    try:
        hour = int(os.environ.get("AGENT_PROACTIVE_HOUR", "0"))
    except ValueError:
        hour = 0
    return owner, prompt, max(0, min(23, hour))


async def _run_proactive() -> None:
    cfg = _proactive_config()
    if cfg is None:
        return
    owner, prompt, _ = cfg
    from .service import agent_service  # 延迟导入破循环（service 不依赖 scheduler）

    try:
        async with async_pg.session() as session:
            await agent_service.run_proactive(session, owner, prompt, "每日主动简报")
        logger.info("Agent proactive run done for owner=%s", owner)
    except Exception:
        logger.exception("Agent proactive run failed")


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
    cfg = _proactive_config()
    if cfg is not None:  # 配了 AGENT_PROACTIVE_* 才挂主动任务，否则 inert
        _owner, _prompt, hour = cfg
        scheduler.add_job(
            _run_proactive,
            CronTrigger(hour=hour, minute=0, timezone=UTC),
            id="agent_proactive_daily",
            name="Agent proactive daily task",
            max_instances=1,
            coalesce=True,
        )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Agent scheduler started: anonymous-retention@02:30 UTC%s", " + proactive" if cfg else "")


def stop_agent_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("Agent scheduler stopped")
