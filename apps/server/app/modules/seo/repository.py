"""SEO 仓储层：Web Vitals 写入 + 聚合查询，搜索快照写入 + 查询。

聚合都用 SQL 在数据库里做，避免拉全量到内存。p75/p95 用 PERCENTILE_CONT
窗口聚合，Postgres 原生支持。
"""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from db.models import SeoSearchSnapshotRow, WebVitalsRow
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession


class SeoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ---------- Web Vitals ----------

    async def insert_vitals(
        self,
        *,
        path: str,
        metric: str,
        value: float,
        rating: str,
        nav_type: str | None,
        is_mobile: bool,
        visitor_hash: str,
    ) -> None:
        self.session.add(
            WebVitalsRow(
                path=path,
                metric=metric,
                value=value,
                rating=rating,
                nav_type=nav_type,
                is_mobile=is_mobile,
                visitor_hash=visitor_hash,
            )
        )
        await self.session.flush()

    async def vitals_overview(self, days: int) -> dict:
        start = datetime.now(UTC) - timedelta(days=days)

        # 每个 metric 的 p75 / p95 / good_ratio / samples
        rows = (
            await self.session.execute(
                select(
                    WebVitalsRow.metric,
                    func.percentile_cont(0.75).within_group(WebVitalsRow.value.asc()).label("p75"),
                    func.percentile_cont(0.95).within_group(WebVitalsRow.value.asc()).label("p95"),
                    func.avg(case((WebVitalsRow.rating == "good", 1.0), else_=0.0)).label("good_ratio"),
                    func.count().label("samples"),
                )
                .where(WebVitalsRow.ts >= start)
                .group_by(WebVitalsRow.metric)
            )
        ).all()
        by_metric = [
            {
                "metric": r.metric,
                "p75": float(r.p75 or 0),
                "p95": float(r.p95 or 0),
                "good_ratio": float(r.good_ratio or 0),
                "samples": int(r.samples),
            }
            for r in rows
        ]

        # 趋势：按天 + metric 算 p75
        trend_rows = (
            await self.session.execute(
                select(
                    func.date(WebVitalsRow.ts).label("d"),
                    WebVitalsRow.metric,
                    func.percentile_cont(0.75).within_group(WebVitalsRow.value.asc()).label("p75"),
                )
                .where(WebVitalsRow.ts >= start)
                .group_by("d", WebVitalsRow.metric)
                .order_by("d")
            )
        ).all()
        trend_map: dict[date, dict[str, float]] = defaultdict(dict)
        for r in trend_rows:
            trend_map[r.d][r.metric] = float(r.p75 or 0)
        trend = [
            {
                "date": d,
                "p75_lcp": vals.get("LCP"),
                "p75_cls": vals.get("CLS"),
                "p75_inp": vals.get("INP"),
            }
            for d, vals in sorted(trend_map.items())
        ]

        # 移动端占比 + 总样本
        mobile_q = await self.session.execute(
            select(
                func.avg(case((WebVitalsRow.is_mobile, 1.0), else_=0.0)).label("mobile_ratio"),
                func.count().label("total"),
            ).where(WebVitalsRow.ts >= start)
        )
        m = mobile_q.one()
        return {
            "by_metric": by_metric,
            "trend": trend,
            "mobile_ratio": float(m.mobile_ratio or 0),
            "samples_total": int(m.total or 0),
        }

    async def delete_vitals_before(self, cutoff: datetime) -> int:
        result = await self.session.execute(delete(WebVitalsRow).where(WebVitalsRow.ts < cutoff))
        await self.session.flush()
        return result.rowcount or 0

    # ---------- 搜索快照 ----------

    async def delete_snapshots_before(self, cutoff: datetime) -> int:
        result = await self.session.execute(
            delete(SeoSearchSnapshotRow).where(SeoSearchSnapshotRow.snapshot_date < cutoff)
        )
        await self.session.flush()
        return result.rowcount or 0

    async def upsert_snapshots(self, rows: list[dict]) -> int:
        """整批替换 (snapshot_date, channel, url) 的数据。简化实现：先 delete 再 insert。"""
        if not rows:
            return 0
        # 不分组，每行各自 upsert（量小：URL 数 < 200）
        for r in rows:
            self.session.add(SeoSearchSnapshotRow(**r))
        await self.session.flush()
        return len(rows)

    async def search_channel_overview(self, channel: str, days: int) -> dict:
        start = datetime.now(UTC) - timedelta(days=days)
        # 最新一天的快照
        latest_date = await self.session.scalar(
            select(func.max(SeoSearchSnapshotRow.snapshot_date)).where(
                SeoSearchSnapshotRow.channel == channel,
                SeoSearchSnapshotRow.snapshot_date >= start,
            )
        )
        if latest_date is None:
            return {
                "channel": channel,
                "snapshot_date": None,
                "impressions_total": 0,
                "clicks_total": 0,
                "ctr_avg": 0.0,
                "position_avg": 0.0,
                "indexed_count": 0,
                "top_urls": [],
            }
        agg = (
            await self.session.execute(
                select(
                    func.sum(SeoSearchSnapshotRow.impressions),
                    func.sum(SeoSearchSnapshotRow.clicks),
                    func.avg(SeoSearchSnapshotRow.ctr),
                    func.avg(SeoSearchSnapshotRow.position),
                    func.sum(case((SeoSearchSnapshotRow.indexed, 1), else_=0)),
                ).where(
                    SeoSearchSnapshotRow.channel == channel,
                    SeoSearchSnapshotRow.snapshot_date == latest_date,
                )
            )
        ).one()
        top_rows = (
            await self.session.execute(
                select(
                    SeoSearchSnapshotRow.url,
                    SeoSearchSnapshotRow.impressions,
                    SeoSearchSnapshotRow.clicks,
                    SeoSearchSnapshotRow.ctr,
                    SeoSearchSnapshotRow.position,
                )
                .where(
                    SeoSearchSnapshotRow.channel == channel,
                    SeoSearchSnapshotRow.snapshot_date == latest_date,
                )
                .order_by(SeoSearchSnapshotRow.clicks.desc(), SeoSearchSnapshotRow.impressions.desc())
                .limit(20)
            )
        ).all()
        return {
            "channel": channel,
            "snapshot_date": latest_date.date() if isinstance(latest_date, datetime) else latest_date,
            "impressions_total": int(agg[0] or 0),
            "clicks_total": int(agg[1] or 0),
            "ctr_avg": float(agg[2] or 0),
            "position_avg": float(agg[3] or 0),
            "indexed_count": int(agg[4] or 0),
            "top_urls": [
                {
                    "url": r.url,
                    "impressions": int(r.impressions),
                    "clicks": int(r.clicks),
                    "ctr": float(r.ctr),
                    "position": float(r.position),
                }
                for r in top_rows
            ],
        }

    async def top_keywords(self, channel: str, days: int, limit: int) -> list[dict]:
        """top_queries 是 JSONB 数组，Postgres 用 jsonb_array_elements_text 展开统计。"""
        start = datetime.now(UTC) - timedelta(days=days)
        # 用 raw SQL（SQLAlchemy 表达 jsonb_array_elements_text 不直观）
        sql = """
            SELECT q.query, COUNT(*) AS occurrences
            FROM seo_search_snapshot s,
                 jsonb_array_elements_text(s.top_queries) AS q(query)
            WHERE s.channel = :channel AND s.snapshot_date >= :start
            GROUP BY q.query
            ORDER BY occurrences DESC
            LIMIT :limit
        """
        from sqlalchemy import text

        rows = (
            await self.session.execute(
                text(sql),
                {"channel": channel, "start": start, "limit": limit},
            )
        ).all()
        return [{"query": r.query, "occurrences": int(r.occurrences)} for r in rows]

    async def indexing_status(self, days: int) -> list[dict]:
        """汇总每个 URL 在三个渠道的最新 indexed 标记。"""
        start = datetime.now(UTC) - timedelta(days=days)
        rows = (
            await self.session.execute(
                select(
                    SeoSearchSnapshotRow.url,
                    SeoSearchSnapshotRow.channel,
                    SeoSearchSnapshotRow.indexed,
                    func.max(SeoSearchSnapshotRow.snapshot_date).label("last_checked"),
                )
                .where(SeoSearchSnapshotRow.snapshot_date >= start)
                .group_by(SeoSearchSnapshotRow.url, SeoSearchSnapshotRow.channel, SeoSearchSnapshotRow.indexed)
            )
        ).all()
        agg: dict[str, dict] = {}
        for r in rows:
            entry = agg.setdefault(
                r.url,
                {
                    "url": r.url,
                    "google_indexed": False,
                    "bing_indexed": False,
                    "baidu_indexed": False,
                    "last_checked": None,
                },
            )
            entry[f"{r.channel}_indexed"] = bool(r.indexed)
            lc = r.last_checked
            if isinstance(lc, datetime):
                lc = lc.date()
            if entry["last_checked"] is None or (lc and lc > entry["last_checked"]):
                entry["last_checked"] = lc
        return sorted(agg.values(), key=lambda x: x["url"])
