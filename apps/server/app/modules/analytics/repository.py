"""Analytics 查询。聚合都用 SQL 里做，避免拉全量到内存。"""

from datetime import UTC, date, datetime, timedelta

from db.models import PageViewRow
from sqlalchemy import case, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession


class AnalyticsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def insert_view(
        self,
        *,
        path: str,
        referrer: str | None,
        country: str | None,
        browser: str | None,
        os: str | None,
        is_mobile: bool,
        visitor_hash: str,
    ) -> None:
        row = PageViewRow(
            path=path,
            referrer=referrer,
            country=country,
            browser=browser,
            os=os,
            is_mobile=is_mobile,
            visitor_hash=visitor_hash,
        )
        self.session.add(row)
        await self.session.flush()

    async def path_views(self, path: str) -> int:
        """单个 path 的累计 PV（走 ix_page_view_path_ts 索引）。"""
        return (
            await self.session.scalar(select(func.count()).select_from(PageViewRow).where(PageViewRow.path == path))
            or 0
        )

    async def overview(self, days: int) -> dict:
        """返回累计 + 今日 + 每日 PV / UV 序列。"""
        utc_today = datetime.now(UTC).date()
        start = utc_today - timedelta(days=days - 1)
        start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)

        # 累计
        total_pv = await self.session.scalar(select(func.count()).select_from(PageViewRow)) or 0
        total_uv = (
            await self.session.scalar(
                select(func.count(func.distinct(PageViewRow.visitor_hash))),
            )
            or 0
        )

        # 今日（UTC）
        today_dt = datetime.combine(utc_today, datetime.min.time(), tzinfo=UTC)
        pv_today = (
            await self.session.scalar(
                select(func.count()).where(PageViewRow.ts >= today_dt),
            )
            or 0
        )
        uv_today = (
            await self.session.scalar(
                select(func.count(func.distinct(PageViewRow.visitor_hash))).where(
                    PageViewRow.ts >= today_dt,
                ),
            )
            or 0
        )

        # 每日分组
        day = func.date_trunc("day", PageViewRow.ts).label("d")
        stmt = (
            select(
                day,
                func.count().label("pv"),
                func.count(func.distinct(PageViewRow.visitor_hash)).label("uv"),
            )
            .where(PageViewRow.ts >= start_dt)
            .group_by(day)
            .order_by(day)
        )
        rows = (await self.session.execute(stmt)).all()
        # 补齐没有数据的日子，便于前端画图
        bucket: dict[date, tuple[int, int]] = {r.d.date(): (r.pv, r.uv) for r in rows}
        daily: list[dict] = []
        cur = start
        while cur <= utc_today:
            pv, uv = bucket.get(cur, (0, 0))
            daily.append({"date": cur, "pv": pv, "uv": uv})
            cur += timedelta(days=1)

        return {
            "pv_total": total_pv,
            "uv_total": total_uv,
            "pv_today": pv_today,
            "uv_today": uv_today,
            "daily": daily,
        }

    async def top_pages(self, days: int, limit: int) -> list[dict]:
        start_dt = _utc_days_ago(days)
        stmt = (
            select(
                PageViewRow.path,
                func.count().label("pv"),
                func.count(func.distinct(PageViewRow.visitor_hash)).label("uv"),
            )
            .where(PageViewRow.ts >= start_dt)
            .group_by(PageViewRow.path)
            .order_by(literal_column("pv").desc())
            .limit(limit)
        )
        rows = (await self.session.execute(stmt)).all()
        return [{"path": r.path, "pv": r.pv, "uv": r.uv} for r in rows]

    async def top_referrers(self, days: int, limit: int) -> list[dict]:
        start_dt = _utc_days_ago(days)
        norm_referrer = case(
            (PageViewRow.referrer.is_(None), "(direct)"),
            (PageViewRow.referrer == "", "(direct)"),
            else_=PageViewRow.referrer,
        ).label("ref")
        stmt = (
            select(norm_referrer, func.count().label("pv"))
            .where(PageViewRow.ts >= start_dt)
            .group_by(norm_referrer)
            .order_by(literal_column("pv").desc())
            .limit(limit)
        )
        rows = (await self.session.execute(stmt)).all()
        return [{"referrer": r.ref or "(direct)", "pv": r.pv} for r in rows]

    async def by_country(self, days: int, limit: int) -> list[dict]:
        start_dt = _utc_days_ago(days)
        country = func.coalesce(PageViewRow.country, "?").label("c")
        stmt = (
            select(country, func.count().label("pv"))
            .where(PageViewRow.ts >= start_dt)
            .group_by(country)
            .order_by(literal_column("pv").desc())
            .limit(limit)
        )
        rows = (await self.session.execute(stmt)).all()
        return [{"country": r.c, "pv": r.pv} for r in rows]

    async def devices(self, days: int) -> dict:
        start_dt = _utc_days_ago(days)
        browser = func.coalesce(PageViewRow.browser, "Other").label("b")
        os = func.coalesce(PageViewRow.os, "Other").label("o")
        browsers = (
            await self.session.execute(
                select(browser, func.count().label("pv"))
                .where(PageViewRow.ts >= start_dt)
                .group_by(browser)
                .order_by(literal_column("pv").desc())
                .limit(10),
            )
        ).all()
        oss = (
            await self.session.execute(
                select(os, func.count().label("pv"))
                .where(PageViewRow.ts >= start_dt)
                .group_by(os)
                .order_by(literal_column("pv").desc())
                .limit(10),
            )
        ).all()
        total = (
            await self.session.scalar(
                select(func.count()).where(PageViewRow.ts >= start_dt),
            )
            or 0
        )
        mobile = (
            await self.session.scalar(
                select(func.count()).where(
                    PageViewRow.ts >= start_dt,
                    PageViewRow.is_mobile.is_(True),
                ),
            )
            or 0
        )
        return {
            "browsers": [{"name": r.b, "pv": r.pv} for r in browsers],
            "os": [{"name": r.o, "pv": r.pv} for r in oss],
            "mobile_ratio": (mobile / total) if total > 0 else 0.0,
        }


def _utc_days_ago(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)
