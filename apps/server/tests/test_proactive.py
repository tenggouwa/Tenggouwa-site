"""主动/定时 agent：run_proactive 收集产出→收件箱 + 调度器 config 门控（不碰真 DB）。"""

import modules.agent.scheduler as sched
import modules.agent.service as svc


class _FakeRepo:
    last: dict = {}

    def __init__(self, _session):
        pass

    async def add_inbox(self, owner, title, body):
        _FakeRepo.last = {"owner": owner, "title": title, "body": body}
        return 7


async def test_run_proactive_collects_tokens_into_inbox(monkeypatch):
    async def fake_stream(_session, _prompt, *, privileged=False, owner=None, **_kw):
        assert privileged is False and owner == "alice"  # 自主运行只用只读工具
        yield {"type": "token", "delta": "今天"}
        yield {"type": "tool", "name": "kb_search"}  # 非 token 事件不该进产出
        yield {"type": "token", "delta": "有 3 条动态"}
        yield {"type": "done"}

    monkeypatch.setattr(svc.agent_service, "answer_stream", fake_stream)
    monkeypatch.setattr(svc, "AgentRepository", _FakeRepo)
    rid = await svc.agent_service.run_proactive(None, "alice", "看看有什么动态", "每日简报")
    assert rid == 7
    assert _FakeRepo.last == {"owner": "alice", "title": "每日简报", "body": "今天有 3 条动态"}


async def test_run_proactive_empty_output_fallback(monkeypatch):
    async def fake_stream(*_a, **_k):
        yield {"type": "done"}

    monkeypatch.setattr(svc.agent_service, "answer_stream", fake_stream)
    monkeypatch.setattr(svc, "AgentRepository", _FakeRepo)
    await svc.agent_service.run_proactive(None, "bob", "x", "t")
    assert "没有产出" in _FakeRepo.last["body"]


def test_proactive_config_inert_without_env(monkeypatch):
    monkeypatch.delenv("AGENT_PROACTIVE_OWNER", raising=False)
    monkeypatch.delenv("AGENT_PROACTIVE_PROMPT", raising=False)
    assert sched._proactive_config() is None  # 未配 → inert，不挂定时任务


def test_proactive_config_parses_and_clamps_hour(monkeypatch):
    monkeypatch.setenv("AGENT_PROACTIVE_OWNER", "alice")
    monkeypatch.setenv("AGENT_PROACTIVE_PROMPT", "每日总结站点动态")
    monkeypatch.setenv("AGENT_PROACTIVE_HOUR", "30")  # 越界
    assert sched._proactive_config() == ("alice", "每日总结站点动态", 23)  # 钳到 23


def test_proactive_config_needs_both_owner_and_prompt(monkeypatch):
    monkeypatch.setenv("AGENT_PROACTIVE_OWNER", "alice")
    monkeypatch.delenv("AGENT_PROACTIVE_PROMPT", raising=False)
    assert sched._proactive_config() is None  # 只有 owner 没 prompt → 仍 inert
