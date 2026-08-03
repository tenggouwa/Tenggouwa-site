"""Operations overview aggregation with a deliberately small, non-sensitive surface."""

import time

import httpx
from common import config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent import scheduler as agent_scheduler
from ..agent.repository import AgentRepository
from ..mail import scheduler as mail_scheduler
from ..mcp.manager import mcp_manager
from ..pi.service import pi_service
from .schema import OpsAgentMetrics, OpsLiveSmoke, OpsMcp, OpsOverview, OpsPi, OpsScheduler

_LIVE_SMOKE_URL = (
    "https://api.github.com/repos/tenggouwa/Tenggouwa-site/actions/workflows/live-smoke.yml/runs?per_page=30"
)
_LIVE_SMOKE_CACHE_SECONDS = 60
_live_smoke_cache: tuple[float, list[OpsLiveSmoke]] | None = None


class OpsService:
    @staticmethod
    async def _agent_metrics(session: AsyncSession) -> OpsAgentMetrics:
        return OpsAgentMetrics(**await AgentRepository(session).ops_metrics())

    @staticmethod
    def _live_smoke(run: dict) -> OpsLiveSmoke:
        status = str(run.get("conclusion") or run.get("status") or "unknown")
        if status == "success":
            summary = "夜间冒烟通过。"
        elif status in {"queued", "in_progress", "requested", "waiting", "pending"}:
            summary = "夜间冒烟正在运行或等待执行。"
        else:
            summary = f"夜间冒烟未通过（{status}）。"
        return OpsLiveSmoke(
            status=status,
            completed_at=run.get("updated_at"),
            summary=summary,
            url=run.get("html_url"),
        )

    async def _live_smoke_history(self) -> list[OpsLiveSmoke]:
        global _live_smoke_cache
        if _live_smoke_cache is not None and time.monotonic() - _live_smoke_cache[0] < _LIVE_SMOKE_CACHE_SECONDS:
            return _live_smoke_cache[1]
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
                response = await client.get(_LIVE_SMOKE_URL, headers={"Accept": "application/vnd.github+json"})
                response.raise_for_status()
            value = [self._live_smoke(run) for run in response.json().get("workflow_runs") or []]
        except httpx.HTTPError:
            value = []
        _live_smoke_cache = (time.monotonic(), value)
        return value

    async def overview(self, session: AsyncSession) -> OpsOverview:
        revision = await session.scalar(text("select version_num from alembic_version limit 1"))
        pi = await pi_service.status(session)
        agent_metrics = await self._agent_metrics(session)
        mcp = mcp_manager.status()
        history = await self._live_smoke_history()
        latest = history[0] if history else OpsLiveSmoke(status="unknown", summary="暂时无法读取夜间冒烟状态。")
        return OpsOverview(
            environment=str(config.get("ENV") or "unknown"),
            alembic_revision=str(revision) if revision else None,
            agent_scheduler=OpsScheduler(**agent_scheduler.scheduler_status()),
            mail_scheduler=OpsScheduler(**mail_scheduler.scheduler_status()),
            mcp=OpsMcp(
                configured=mcp["configured"],
                connected=mcp["connected"],
                tool_count=len(mcp["tools"]),
            ),
            pi=OpsPi(online=pi.online, last_seen=pi.last_seen, age_seconds=pi.age_seconds),
            agent_metrics=agent_metrics,
            live_smoke=latest,
            live_smoke_history=history,
        )


ops_service = OpsService()
