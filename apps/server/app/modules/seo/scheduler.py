"""SEO 模块的定时任务：

- 每天 03:00 UTC+8 拉 GSC 前一天的数据 → web_vitals 不动，seo_search_snapshot 入库
- 每天 04:00 UTC+8 拉百度收录（待实现）
- 每天 05:00 UTC+8 拉 Bing 收录（待实现）

调度器在 FastAPI lifespan 启动时跑起来，shutdown 时优雅关闭。所有任务
凭借 SeoService 已有的 skip 逻辑：缺 secret 静默不跑，不会报错。
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from db import async_pg

from .service import seo_service

logger = logging.getLogger(__name__)

CN_TZ = ZoneInfo("Asia/Shanghai")
_scheduler: AsyncIOScheduler | None = None


async def _run_gsc_fetch() -> None:
    """在新的 session 里跑 GSC 拉取。"""
    started = datetime.now(CN_TZ)
    try:
        async with async_pg.session() as session:
            n = await seo_service.fetch_gsc_daily(session)
        logger.info(f"GSC fetch done: {n} rows, took {(datetime.now(CN_TZ) - started).total_seconds():.1f}s")
    except Exception:
        logger.exception("GSC fetch failed")


async def _run_baidu_fetch() -> None:
    try:
        async with async_pg.session() as session:
            await seo_service.fetch_baidu_daily(session)
    except Exception:
        logger.exception("Baidu fetch failed")


async def _run_bing_fetch() -> None:
    try:
        async with async_pg.session() as session:
            await seo_service.fetch_bing_daily(session)
    except Exception:
        logger.exception("Bing fetch failed")


async def _run_retention() -> None:
    """删除超过保留期的埋点数据，防止 web_vitals / seo_search_snapshot 无限增长。"""
    try:
        async with async_pg.session() as session:
            result = await seo_service.purge_old_data(session)
        logger.info(f"Retention purge done: {result}")
    except Exception:
        logger.exception("Retention purge failed")


def start_seo_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    sched = AsyncIOScheduler(timezone=CN_TZ)
    sched.add_job(
        _run_retention,
        CronTrigger(hour=2, minute=0, timezone=CN_TZ),
        id="seo_retention_daily",
        name="埋点数据保留清理",
        max_instances=1,
        coalesce=True,
    )
    sched.add_job(
        _run_gsc_fetch,
        CronTrigger(hour=3, minute=0, timezone=CN_TZ),
        id="seo_gsc_daily",
        name="GSC daily fetch",
        max_instances=1,
        coalesce=True,
    )
    sched.add_job(
        _run_baidu_fetch,
        CronTrigger(hour=4, minute=0, timezone=CN_TZ),
        id="seo_baidu_daily",
        name="Baidu daily fetch",
        max_instances=1,
        coalesce=True,
    )
    sched.add_job(
        _run_bing_fetch,
        CronTrigger(hour=5, minute=0, timezone=CN_TZ),
        id="seo_bing_daily",
        name="Bing daily fetch",
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("SEO scheduler started: Retention@02:00, GSC@03:00, Baidu@04:00, Bing@05:00 Asia/Shanghai")


def stop_seo_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("SEO scheduler stopped")
