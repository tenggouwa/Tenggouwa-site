"""KB 定时任务：每天 06:00 UTC+8 增量 reindex blog 源。

让新发布 / 到点调度（published_at 到期）的文章自动进知识库——比"发文时 hook"更稳，
因为调度发布没有写事件、hook 抓不到。v0 的 reindex 只切块入库、不调 LLM，按
content_hash 增量，很轻。缺数据时自然是空跑，不报错。
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from db import async_pg

from .service import kb_service

logger = logging.getLogger(__name__)

CN_TZ = ZoneInfo("Asia/Shanghai")
_scheduler: AsyncIOScheduler | None = None


async def _run_reindex() -> None:
    started = datetime.now(CN_TZ)
    try:
        async with async_pg.session() as session:
            result = await kb_service.reindex(session, "blog")
        took = (datetime.now(CN_TZ) - started).total_seconds()
        logger.info(f"KB reindex done: {result.model_dump()}, took {took:.1f}s")
    except Exception:
        logger.exception("KB reindex failed")


def start_kb_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    sched = AsyncIOScheduler(timezone=CN_TZ)
    sched.add_job(
        _run_reindex,
        CronTrigger(hour=6, minute=0, timezone=CN_TZ),
        id="kb_reindex_daily",
        name="KB blog 增量 reindex",
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("KB scheduler started: reindex@06:00 Asia/Shanghai")


def stop_kb_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("KB scheduler stopped")
