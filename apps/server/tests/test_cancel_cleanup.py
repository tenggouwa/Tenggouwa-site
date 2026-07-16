"""A3 取消 / 断连清理：客户端断开时事务回滚、生成器干净停止，不留半条脏消息（H1）。"""

import asyncio

import pytest
from agent_harness import FakeRepo, ScriptedLLM
from db import pg


class _FakeSession:
    def __init__(self, calls):
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        self.calls.append("close")
        return False

    async def commit(self):
        self.calls.append("commit")

    async def rollback(self):
        self.calls.append("rollback")


def _fake_pg(calls):
    p = pg.AsyncPostgres()
    p._sessionmaker = lambda: _FakeSession(calls)  # 绕开真引擎
    return p


async def test_session_commits_on_success():
    calls: list[str] = []
    async with _fake_pg(calls).session():
        pass
    assert calls == ["commit", "close"]


async def test_session_rolls_back_on_cancel():
    # CancelledError 是 BaseException：用 except Exception 会漏掉它 → 既不 commit 也不显式 rollback。
    calls: list[str] = []
    with pytest.raises(asyncio.CancelledError):
        async with _fake_pg(calls).session():
            raise asyncio.CancelledError
    assert "rollback" in calls and "commit" not in calls


async def test_session_rolls_back_on_error():
    calls: list[str] = []
    with pytest.raises(ValueError):
        async with _fake_pg(calls).session():
            raise ValueError("boom")
    assert "rollback" in calls and "commit" not in calls


async def test_stream_closed_midway_stops_before_running_tools(monkeypatch):
    """客户端中途断开（aclose 生成器）→ 干净停止：不炸、不再执行后续工具。"""
    import modules.agent.service as svc

    executed: list[str] = []

    async def fake_invoke(_session, name, _args, **_kw):
        executed.append(name)
        return "结果"

    rounds = [
        [{"type": "tool_calls", "tool_calls": [{"id": "c1", "function": {"name": "kb_search", "arguments": "{}"}}]}],
        [{"type": "content", "delta": "第二轮不该跑到"}],
    ]
    repo = FakeRepo()
    monkeypatch.setattr(svc, "chat_llm", ScriptedLLM(rounds))
    monkeypatch.setattr(svc, "AgentRepository", lambda _s: repo)
    monkeypatch.setattr(svc.skills_service, "tools", lambda **_kw: [])
    monkeypatch.setattr(svc.skills_service, "invoke", fake_invoke)

    agen = svc.agent_service.answer_stream(None, "问题")
    first = await agen.__anext__()  # 只取第一个事件（session）
    await agen.aclose()  # 模拟客户端断连

    assert first["type"] == "session"
    assert executed == []  # 断开后没继续跑工具
    assert not [r for r in repo.rows if r.role == "tool"]  # 没留半条 tool 结果
