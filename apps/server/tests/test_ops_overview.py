"""Ops overview only aggregates safe metadata."""

import modules.ops.service as ops
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

    data = await ops.ops_service.overview(_Session())
    assert data.model_dump() == {
        "environment": "prod",
        "alembic_revision": "20260728_0100",
        "agent_scheduler": {"running": True, "jobs": [{"id": "agent", "next_run": None}]},
        "mail_scheduler": {"running": True, "jobs": [{"id": "mail", "next_run": None}]},
        "mcp": {"configured": 2, "connected": ["tools"], "tool_count": 1},
        "pi": {"online": True, "last_seen": "2026-07-28T00:00:00+00:00", "age_seconds": 12.5},
    }
