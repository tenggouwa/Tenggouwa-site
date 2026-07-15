"""会话归属（owner 隔离）+ transcript 重建。

- owner 隔离：只续自己名下的会话；owner 不匹配 → 当作新会话新建，绝不把别人的历史喂进来（防公开读私有）。
- transcript：把 append-only 消息重建成前端可渲染的轮次（user 起一轮、assistant 累进 answer + tools）。
"""

import json
from types import SimpleNamespace

from agent_harness import run_agent
from modules.agent.repository import AgentRepository, AgentWindow
from modules.agent.service import PRIVATE_SYSTEM, SYSTEM, AgentService


async def test_new_private_session_records_owner(monkeypatch):
    # 私有通道首问（无 session_id）→ create_session 带上 owner。
    _, repo = await run_agent(monkeypatch, [[{"type": "content", "delta": "答"}]], owner="alice", privileged=True)
    assert repo.created is not None and repo.created[1] == "alice"


async def test_resume_own_session_reuses(monkeypatch):
    # owner 匹配 → 续用已存在会话，不新建。
    sess = SimpleNamespace(id="s", owner="alice", summary=None, summarized_upto_seq=0, pending=None)
    _, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "答"}]],
        session=sess,
        session_id="s",
        owner="alice",
        privileged=True,
    )
    assert repo.created is None  # 复用，没新建


async def test_resume_foreign_session_starts_fresh(monkeypatch):
    # owner 不匹配（bob 拿 alice 的 session_id / 公开拿私有）→ 忽略该会话、新建，绝不泄漏历史。
    sess = SimpleNamespace(id="s", owner="alice", summary=None, summarized_upto_seq=0, pending=None)
    _, repo = await run_agent(
        monkeypatch, [[{"type": "content", "delta": "答"}]], session=sess, session_id="s", owner="bob", privileged=True
    )
    assert repo.created is not None and repo.created[1] == "bob"  # 新建成 bob 的


async def test_public_cannot_resume_private(monkeypatch):
    # 公开通道（owner=None）拿到私有会话 id → 也当作新会话，不加载私有历史。
    sess = SimpleNamespace(id="s", owner="alice", summary=None, summarized_upto_seq=0, pending=None)
    _, repo = await run_agent(
        monkeypatch, [[{"type": "content", "delta": "答"}]], session=sess, session_id="s", owner=None
    )
    assert repo.created is not None and repo.created[1] is None


# ---- transcript 重建（用轻量 fake session 喂消息行）----


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _Session:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _q):
        return _Result(self._rows)


def _msg(seq, role, content, tool_calls=None):
    return SimpleNamespace(seq=seq, role=role, content=content, tool_calls=tool_calls, tool_call_id=None)


async def test_transcript_rebuilds_turns():
    rows = [
        _msg(1, "user", "写个脚本"),
        _msg(
            2,
            "assistant",
            "好的，我来写",
            tool_calls=[{"function": {"name": "file_write", "arguments": json.dumps({"path": "a.sh"})}}],
        ),
        _msg(3, "tool", "（已写入 a.sh）"),
        _msg(4, "assistant", "写好了"),
        _msg(5, "user", "跑一下"),
        _msg(6, "assistant", "执行完毕"),
    ]
    turns = await AgentRepository(_Session(rows)).transcript("s")
    assert len(turns) == 2
    assert turns[0]["q"] == "写个脚本"
    assert turns[0]["answer"] == "好的，我来写写好了"  # 同轮多个 assistant 正文累进
    assert turns[0]["tools"] == [{"name": "file_write", "args": {"path": "a.sh"}}]
    assert turns[1]["q"] == "跑一下" and turns[1]["answer"] == "执行完毕"


async def test_transcript_tolerates_bad_tool_args():
    rows = [
        _msg(1, "user", "q"),
        _msg(2, "assistant", "", tool_calls=[{"function": {"name": "x", "arguments": "not-json"}}]),
    ]
    turns = await AgentRepository(_Session(rows)).transcript("s")
    assert turns[0]["tools"] == [{"name": "x", "args": {}}]  # 坏 JSON 参数降级为空 dict，不炸


# ---- 私有模式「做事」系统提示 ----


def test_seed_public_is_bare_system():
    msgs = AgentService._seed(AgentWindow(None, [], 1, 0), False)
    assert len(msgs) == 1 and msgs[0]["content"] == SYSTEM  # 公开：仅 SYSTEM，无做事引导


def test_seed_private_appends_do_things_guidance():
    msgs = AgentService._seed(AgentWindow(None, [], 1, 0), True)
    assert msgs[0]["content"] == SYSTEM  # 首块逐字不变（保住共享缓存前缀）
    assert msgs[1]["content"] == PRIVATE_SYSTEM  # 私有：紧跟一条做事引导


def test_seed_private_guidance_before_summary():
    # 做事引导排在早前摘要之前（都属 system 装配区，保前缀稳定）
    msgs = AgentService._seed(AgentWindow("旧摘要", [], 1, 0), True)
    assert [m["content"] for m in msgs[:2]] == [SYSTEM, PRIVATE_SYSTEM]
    assert "旧摘要" in msgs[2]["content"]
