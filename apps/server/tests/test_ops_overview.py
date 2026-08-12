"""Ops overview only aggregates safe metadata."""

import modules.ops.service as ops
from modules.ops.schema import OpsLiveSmoke
from modules.pi.schema import PiStatus


async def test_ops_overview_aggregates_safe_metadata(monkeypatch):
    class _Session:
        async def scalar(self, _statement):
            return "20260728_0100"

    class _Pi:
        async def status(self, _session):
            return PiStatus(online=True, last_seen="2026-07-28T00:00:00+00:00", age_seconds=12.5)

    monkeypatch.setattr(ops, "pi_service", _Pi())
    monkeypatch.setattr(ops.agent_scheduler, "scheduler_status", lambda: {"running": True, "jobs": [{"id": "agent"}]})
    monkeypatch.setattr(ops.mail_scheduler, "scheduler_status", lambda: {"running": True, "jobs": [{"id": "mail"}]})
    monkeypatch.setattr(
        ops.mcp_manager,
        "status",
        lambda: {"configured": 2, "connected": ["tools"], "tools": [{"name": "x"}]},
    )
    monkeypatch.setattr(ops.config, "get", lambda _key, _default=None: "prod")

    async def agent_metrics(_session):
        return ops.OpsAgentMetrics(
            window_hours=24,
            total_runs=12,
            completed_runs=10,
            awaiting_approval_runs=1,
            avg_duration_ms=850,
            tool_calls=18,
            prompt_tokens=1200,
            completion_tokens=500,
            cache_hit_tokens=900,
            cache_miss_tokens=300,
            external_research_calls=4,
            external_research_capped_runs=1,
            p95_duration_ms=1200,
            long_running_runs=1,
            high_prompt_runs=1,
            failed_runs=0,
            alert_level="warning",
            alerts=[],
        )

    monkeypatch.setattr(ops.ops_service, "_agent_metrics", agent_metrics)

    async def live_smoke_history():
        return [
            OpsLiveSmoke(
                status="failure",
                completed_at="2026-07-30T00:00:00+00:00",
                summary="最近一次夜间冒烟未通过，请查看运行详情。",
                url="https://github.com/tenggouwa/Tenggouwa-site/actions/runs/1",
            )
        ]

    monkeypatch.setattr(ops.ops_service, "_live_smoke_history", live_smoke_history)

    data = await ops.ops_service.overview(_Session())
    assert data.model_dump() == {
        "environment": "prod",
        "alembic_revision": "20260728_0100",
        "agent_scheduler": {"running": True, "jobs": [{"id": "agent", "next_run": None}]},
        "mail_scheduler": {"running": True, "jobs": [{"id": "mail", "next_run": None}]},
        "mcp": {"configured": 2, "connected": ["tools"], "tool_count": 1},
        "pi": {"online": True, "last_seen": "2026-07-28T00:00:00+00:00", "age_seconds": 12.5},
        "agent_metrics": {
            "window_hours": 24,
            "total_runs": 12,
            "completed_runs": 10,
            "awaiting_approval_runs": 1,
            "avg_duration_ms": 850,
            "tool_calls": 18,
            "prompt_tokens": 1200,
            "completion_tokens": 500,
            "cache_hit_tokens": 900,
            "cache_miss_tokens": 300,
            "external_research_calls": 4,
            "external_research_capped_runs": 1,
            "p95_duration_ms": 1200,
            "long_running_runs": 1,
            "high_prompt_runs": 1,
            "failed_runs": 0,
            "alert_level": "warning",
            "alerts": [],
        },
        "live_smoke": {
            "status": "failure",
            "completed_at": "2026-07-30T00:00:00+00:00",
            "summary": "最近一次夜间冒烟未通过，请查看运行详情。",
            "url": "https://github.com/tenggouwa/Tenggouwa-site/actions/runs/1",
        },
        "live_smoke_history": [
            {
                "status": "failure",
                "completed_at": "2026-07-30T00:00:00+00:00",
                "summary": "最近一次夜间冒烟未通过，请查看运行详情。",
                "url": "https://github.com/tenggouwa/Tenggouwa-site/actions/runs/1",
            }
        ],
    }


async def test_agent_metrics_marks_cost_latency_and_cap_anomalies(monkeypatch):
    class _Repo:
        def __init__(self, _session):
            pass

        async def ops_metrics(self):
            return {
                "window_hours": 24,
                "total_runs": 3,
                "completed_runs": 3,
                "awaiting_approval_runs": 0,
                "avg_duration_ms": 1000,
                "tool_calls": 6,
                "prompt_tokens": 101_000,
                "completion_tokens": 300,
                "cache_hit_tokens": 0,
                "cache_miss_tokens": 101_000,
                "external_research_calls": 4,
                "external_research_capped_runs": 1,
                "p95_duration_ms": 61_000,
                "long_running_runs": 1,
                "high_prompt_runs": 1,
                "failed_runs": 0,
            }

    monkeypatch.setattr(ops, "AgentRepository", _Repo)
    metrics = await ops.ops_service._agent_metrics(None)
    assert metrics.alert_level == "critical"
    assert metrics.alerts == [
        "1 次输入超过 100k token，建议检查上下文或工具输出。",
        "1 次运行超过 60 秒，建议检查工具或模型延迟。",
        "1 次触发网页研究上限，已自动收口。",
    ]
