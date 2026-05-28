"""SEO 业务逻辑：Web Vitals 上报、搜索快照查询、外部 API 拉取（GSC / 百度 / Bing）。

外部拉取（fetch_*）由调度器（定时任务）调用，secret 从环境变量读：
  GSC_SERVICE_ACCOUNT_JSON   Google Search Console service account JSON 内容
  GSC_SITE_URL                e.g. "sc-domain:tenggouwa.com" 或 "https://tenggouwa.com/"
  BAIDU_SITE / BAIDU_TOKEN    百度站长 push（push api 不取数；取数靠抓 sitelinks 或 sandbox API）
缺 secret 时 fetch_* 直接 skip，不报错。
"""

import asyncio
import hashlib
import logging
import os
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from ..analytics.ua import is_bot, parse_ua
from . import gsc
from .repository import SeoRepository
from .schema import VitalsReport

logger = logging.getLogger(__name__)

# 埋点数据保留期：web_vitals 看近期性能趋势，90 天足够；搜索快照有长期分析价值，留 1 年。
VITALS_RETENTION_DAYS = 90
SNAPSHOT_RETENTION_DAYS = 365


class SeoService:
    # ---------- Web Vitals 接收 ----------

    async def record_vitals(
        self,
        session: AsyncSession,
        payload: VitalsReport,
        *,
        ip: str | None,
        ua: str | None,
    ) -> bool:
        if is_bot(ua):
            return False
        _, _, is_mobile = parse_ua(ua)
        visitor_hash = _visitor_hash(ip, ua)
        await SeoRepository(session).insert_vitals(
            path=payload.path[:500],
            metric=payload.metric,
            value=payload.value,
            rating=payload.rating,
            nav_type=payload.nav_type,
            is_mobile=is_mobile,
            visitor_hash=visitor_hash,
        )
        return True

    async def vitals_overview(self, session: AsyncSession, days: int) -> dict:
        return await SeoRepository(session).vitals_overview(_clamp_days(days))

    # ---------- 搜索快照查询 ----------

    async def search_overview(self, session: AsyncSession, channel: str, days: int) -> dict:
        return await SeoRepository(session).search_channel_overview(channel, _clamp_days(days))

    async def keywords(self, session: AsyncSession, channel: str, days: int, limit: int) -> list[dict]:
        return await SeoRepository(session).top_keywords(channel, _clamp_days(days), max(1, min(limit, 100)))

    async def indexing_status(self, session: AsyncSession, days: int) -> list[dict]:
        return await SeoRepository(session).indexing_status(_clamp_days(days))

    # ---------- 外部 fetch（占位，secret 配齐后接入真实 API） ----------

    async def fetch_gsc_daily(self, session: AsyncSession) -> int:
        """从 Google Search Console 拉前一天的所有 URL+query 数据，写入快照表。

        要求环境变量：GSC_SERVICE_ACCOUNT_JSON（或 _FILE）+ GSC_SITE_URL。未配置 skip。
        """
        if not (os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or os.environ.get("GSC_SERVICE_ACCOUNT_FILE")):
            logger.info("GSC fetch skip: no service account configured")
            return 0
        if not os.environ.get("GSC_SITE_URL"):
            logger.info("GSC fetch skip: GSC_SITE_URL not set")
            return 0
        # google-api-python-client 是同步的，丢到 default executor 跑
        loop = asyncio.get_running_loop()
        rows = await loop.run_in_executor(None, gsc.fetch_search_analytics_sync)
        if not rows:
            logger.info("GSC fetch: 0 rows returned")
            return 0
        # 按 page 聚合：sum impressions/clicks，平均 ctr/position，top_queries 收前 10
        agg: dict[str, dict] = defaultdict(
            lambda: {
                "impressions": 0,
                "clicks": 0,
                "ctr_sum": 0.0,
                "position_sum": 0.0,
                "count": 0,
                "queries": [],
            }
        )
        for r in rows:
            page = r["page"]
            a = agg[page]
            a["impressions"] += r["impressions"]
            a["clicks"] += r["clicks"]
            a["ctr_sum"] += r["ctr"]
            a["position_sum"] += r["position"]
            a["count"] += 1
            if r["query"]:
                a["queries"].append((r["query"], r["impressions"]))
        snapshot_date = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        snapshots = []
        for page, a in agg.items():
            top_queries = [q for q, _ in sorted(a["queries"], key=lambda x: -x[1])[:10]]
            snapshots.append(
                {
                    "snapshot_date": snapshot_date,
                    "channel": "google",
                    "url": page[:500],
                    "impressions": a["impressions"],
                    "clicks": a["clicks"],
                    "ctr": a["ctr_sum"] / max(a["count"], 1),
                    "position": a["position_sum"] / max(a["count"], 1),
                    "top_queries": top_queries,
                    "indexed": a["impressions"] > 0,  # 有展示就当作已收录
                }
            )
        n = await SeoRepository(session).upsert_snapshots(snapshots)
        # session 由 async_pg.session() / get_session 在退出时自动 commit
        logger.info(f"GSC fetch: wrote {n} snapshots for {snapshot_date.date()}")
        return n

    async def submit_to_google_indexing(self, urls: list[str]) -> int:
        """把一批 URL 推给 Google Indexing API，加速抓取。新文章发布 / 重要更新时调。"""
        if not (os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or os.environ.get("GSC_SERVICE_ACCOUNT_FILE")):
            logger.info("Indexing API skip: no service account configured")
            return 0
        loop = asyncio.get_running_loop()
        ok = 0
        for url in urls:
            success = await loop.run_in_executor(None, gsc.submit_url_for_indexing_sync, url)
            if success:
                ok += 1
        logger.info(f"Indexing API: submitted {ok}/{len(urls)}")
        return ok

    async def fetch_baidu_daily(self, session: AsyncSession) -> int:
        """百度站长平台不提供搜索表现 API（只能 push）。这里仅检查每个 URL 的
        收录状态（Site: 命令 / sitelinks 接口），不取展示/点击。"""
        if not os.environ.get("BAIDU_TOKEN"):
            logger.info("Baidu fetch skip: BAIDU_TOKEN not configured")
            return 0
        logger.warning("Baidu fetch stub: not implemented yet")
        return 0

    async def fetch_bing_daily(self, session: AsyncSession) -> int:
        """Bing Webmaster Tools API。"""
        if not os.environ.get("BING_WEBMASTER_API_KEY"):
            logger.info("Bing fetch skip: BING_WEBMASTER_API_KEY not configured")
            return 0
        logger.warning("Bing fetch stub: not implemented yet")
        return 0

    # ---------- 数据保留清理（定时任务调用） ----------

    async def purge_old_data(self, session: AsyncSession) -> dict[str, int]:
        """删除超过保留期的埋点数据，防止埋点表无限增长。session 退出时自动 commit。"""
        now = datetime.now(UTC)
        repo = SeoRepository(session)
        vitals = await repo.delete_vitals_before(now - timedelta(days=VITALS_RETENTION_DAYS))
        snapshots = await repo.delete_snapshots_before(now - timedelta(days=SNAPSHOT_RETENTION_DAYS))
        return {"web_vitals": vitals, "seo_search_snapshot": snapshots}


def _visitor_hash(ip: str | None, ua: str | None) -> str:
    today = datetime.now(UTC).strftime("%Y%m%d")
    raw = f"{ip or ''}::{ua or ''}::{today}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _clamp_days(days: int) -> int:
    if days < 1:
        return 1
    if days > 365:
        return 365
    return days


seo_service = SeoService()
