"""SEO 业务逻辑：Web Vitals 上报、搜索快照查询、外部 API 拉取（GSC / 百度 / Bing）。

外部拉取（fetch_*）由调度器（定时任务）调用，secret 从环境变量读：
  GSC_SERVICE_ACCOUNT_JSON   Google Search Console service account JSON 内容
  GSC_SITE_URL                e.g. "sc-domain:tenggouwa.com" 或 "https://tenggouwa.com/"
  BAIDU_SITE / BAIDU_TOKEN    百度站长 push（push api 不取数；取数靠抓 sitelinks 或 sandbox API）
缺 secret 时 fetch_* 直接 skip，不报错。
"""

import hashlib
import logging
import os
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..analytics.ua import is_bot, parse_ua
from .repository import SeoRepository
from .schema import VitalsReport

logger = logging.getLogger(__name__)


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
        """从 Google Search Console 拉前一天的所有 URL 数据，写入快照表。

        要求环境变量：GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL。
        未配置则 skip。
        """
        sa_json = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
        site = os.environ.get("GSC_SITE_URL")
        if not sa_json or not site:
            logger.info("GSC fetch skip: secret/site not configured")
            return 0
        # 真实实现：调用 google-api-python-client / google-auth
        # 此处先 stub，待 secret 配齐后实现
        logger.warning("GSC fetch stub: not implemented yet, secret detected but no fetch code")
        return 0

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


def _visitor_hash(ip: str | None, ua: str | None) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    raw = f"{ip or ''}::{ua or ''}::{today}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _clamp_days(days: int) -> int:
    if days < 1:
        return 1
    if days > 365:
        return 365
    return days


seo_service = SeoService()
