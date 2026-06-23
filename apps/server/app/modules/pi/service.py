import hmac
import logging
from datetime import UTC, datetime

from common.config_manager import config
from sqlalchemy.ext.asyncio import AsyncSession

from .repository import PiRepository
from .schema import (
    PiArtifact,
    PiArtifactReport,
    PiHistoryPoint,
    PiProbe,
    PiProbeReport,
    PiReport,
    PiStatus,
)

logger = logging.getLogger(__name__)

# 上报间隔默认 30s；连漏 ~2 次（>75s 没新快照）就判离线。
ONLINE_THRESHOLD_S = 75.0
HISTORY_POINTS = 40
# 快照保留天数：每次上报顺手删更早的，防表无限增长。
RETENTION_DAYS = 14
# 每日产物保留天数。
ARTIFACT_RETENTION_DAYS = 60
# 探针保留天数 + 每目标历史点数。
PROBE_RETENTION_DAYS = 7
PROBE_HISTORY_POINTS = 60


class PiService:
    async def ingest(self, session: AsyncSession, report: PiReport) -> None:
        payload = {"model": report.model, "metrics": report.metrics}
        repo = PiRepository(session)
        await repo.insert(report.hostname, payload)
        await repo.prune(RETENTION_DAYS)

    async def status(self, session: AsyncSession) -> PiStatus:
        repo = PiRepository(session)
        latest = await repo.latest()
        if latest is None:
            return PiStatus(online=False)

        age = (datetime.now(UTC) - latest.ts).total_seconds()
        payload = latest.metrics or {}
        rows = await repo.recent(latest.hostname, HISTORY_POINTS)
        history = [
            PiHistoryPoint(
                ts=r.ts.isoformat(),
                cpu_temp_c=_metric(r.metrics, "cpu_temp_c"),
                load1=_metric(r.metrics, "load1"),
            )
            for r in rows
        ]
        return PiStatus(
            online=age <= ONLINE_THRESHOLD_S,
            last_seen=latest.ts.isoformat(),
            age_seconds=round(age, 1),
            hostname=latest.hostname,
            model=payload.get("model"),
            metrics=payload.get("metrics"),
            history=history,
        )

    async def ingest_artifact(self, session: AsyncSession, report: PiArtifactReport) -> None:
        repo = PiRepository(session)
        await repo.insert_artifact(report.kind, report.title, report.content, report.meta)
        await repo.prune_artifacts(ARTIFACT_RETENTION_DAYS)

    async def get_artifact(self, session: AsyncSession) -> PiArtifact | None:
        row = await PiRepository(session).latest_artifact()
        if row is None:
            return None
        return PiArtifact(
            kind=row.kind, title=row.title, content=row.content, meta=row.meta or {}, ts=row.ts.isoformat()
        )

    async def ingest_probes(self, session: AsyncSession, reports: list[PiProbeReport]) -> None:
        repo = PiRepository(session)
        rows = [{"name": r.name, "ok": r.ok, "value": r.value, "unit": r.unit} for r in reports]
        if rows:
            await repo.insert_probes(rows)
        await repo.prune_probes(PROBE_RETENTION_DAYS)

    async def get_probes(self, session: AsyncSession) -> list[PiProbe]:
        repo = PiRepository(session)
        out: list[PiProbe] = []
        for name in await repo.probe_names():
            rows = await repo.recent_probes(name, PROBE_HISTORY_POINTS)
            if not rows:
                continue
            latest = rows[-1]
            out.append(
                PiProbe(
                    name=name,
                    ok=latest.ok,
                    value=latest.value,
                    unit=latest.unit,
                    ts=latest.ts.isoformat(),
                    history=[r.value for r in rows],
                )
            )
        return out

    @staticmethod
    def verify_token(provided: str | None) -> bool:
        expected = config.get("PI_AGENT_TOKEN")
        if not expected or not provided:
            return False
        return hmac.compare_digest(str(provided), str(expected))


def _metric(payload: dict | None, key: str) -> float | None:
    value = (payload or {}).get("metrics", {}).get(key)
    return float(value) if isinstance(value, int | float) else None


pi_service = PiService()
