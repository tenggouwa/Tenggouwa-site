import hashlib
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from .repository import AnalyticsRepository
from .schema import TrackRequest
from .ua import is_bot, parse_ua

logger = logging.getLogger(__name__)


class AnalyticsService:
    async def track(
        self,
        session: AsyncSession,
        payload: TrackRequest,
        *,
        ip: str | None,
        ua: str | None,
        country: str | None,
    ) -> bool:
        """写一条 PV。返回是否真的入库（bot 等情况下 skip）。"""
        if is_bot(ua):
            return False
        path = _normalize_path(payload.path)
        if not path:
            return False
        browser, os, is_mobile = parse_ua(ua)
        visitor_hash = self._make_visitor_hash(ip, ua)
        await AnalyticsRepository(session).insert_view(
            path=path,
            referrer=_normalize_referrer(payload.referrer),
            country=(country or None),
            browser=browser,
            os=os,
            is_mobile=is_mobile,
            visitor_hash=visitor_hash,
        )
        return True

    async def overview(self, session: AsyncSession, days: int) -> dict:
        return await AnalyticsRepository(session).overview(days=_clamp_days(days))

    async def top_pages(self, session: AsyncSession, days: int, limit: int) -> list[dict]:
        return await AnalyticsRepository(session).top_pages(
            days=_clamp_days(days),
            limit=max(1, min(limit, 50)),
        )

    async def top_referrers(self, session: AsyncSession, days: int, limit: int) -> list[dict]:
        return await AnalyticsRepository(session).top_referrers(
            days=_clamp_days(days),
            limit=max(1, min(limit, 50)),
        )

    async def by_country(self, session: AsyncSession, days: int, limit: int) -> list[dict]:
        return await AnalyticsRepository(session).by_country(
            days=_clamp_days(days),
            limit=max(1, min(limit, 50)),
        )

    async def devices(self, session: AsyncSession, days: int) -> dict:
        return await AnalyticsRepository(session).devices(days=_clamp_days(days))

    @staticmethod
    def _make_visitor_hash(ip: str | None, ua: str | None) -> str:
        # sha256(ip + ua + YYYYMMDD UTC)[:32]
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        raw = f"{ip or ''}::{ua or ''}::{today}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _normalize_path(path: str) -> str:
    # 去掉 query / hash，保留 pathname
    p = path.strip()
    for sep in ("?", "#"):
        idx = p.find(sep)
        if idx >= 0:
            p = p[:idx]
    # 去掉末尾斜杠（除根）
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]
    return p[:500]


def _normalize_referrer(ref: str | None) -> str | None:
    if not ref:
        return None
    r = ref.strip()
    return (r[:500]) if r else None


def _clamp_days(days: int) -> int:
    return max(1, min(int(days), 365))


analytics_service = AnalyticsService()
