"""run_subagent：只读子代理循环 + 递归排除 + 主代理侧进度流式。"""

import modules.skills.subagent as sub
from agent_harness import run_agent


class _Scripted:
    """假 chat_llm.stream_step：按 rounds 逐轮 yield 事件，记录最近一次收到的 tools。"""

    def __init__(self, rounds):
        self.rounds = rounds
        self.i = 0
        self.last_tools = None

    async def stream_step(self, _messages, *, tools=None, **_kw):
        self.last_tools = tools
        r = self.rounds[min(self.i, len(self.rounds) - 1)]
        self.i += 1
        for ev in r:
            yield ev


def _tc(name, args="{}"):
    return {"type": "tool_calls", "tool_calls": [{"id": "c1", "function": {"name": name, "arguments": args}}]}


async def test_subagent_loops_excludes_self_and_returns(monkeypatch):
    from modules.kb import provider
    from modules.skills import service as svc

    scripted = _Scripted([[_tc("web_search", '{"query":"x"}')], [{"type": "content", "delta": "结论"}]])
    monkeypatch.setattr(provider.chat_llm, "stream_step", scripted.stream_step)

    calls = []

    async def fake_invoke(_session, name, _args, *, privileged=False):
        calls.append((name, privileged))
        return "检索结果"

    monkeypatch.setattr(svc.skills_service, "invoke", fake_invoke)
    monkeypatch.setattr(
        svc.skills_service,
        "tools",
        lambda **_kw: [
            {"type": "function", "function": {"name": "web_search"}},
            {"type": "function", "function": {"name": "run_subagent"}},  # 必须被排除，防递归
        ],
    )

    evs = [e async for e in sub.stream_run(None, "查点东西")]
    assert all(t["function"]["name"] != "run_subagent" for t in scripted.last_tools)  # 排除自身
    assert calls == [("web_search", False)]  # 子代理只读、privileged 恒 False
    assert {"progress": "· web_search"} in evs
    assert evs[-1] == {"result": "结论"}


async def test_subagent_empty_task():
    evs = [e async for e in sub.stream_run(None, "   ")]
    assert evs == [{"result": "（未提供子任务 task）"}]


async def test_subagent_step_cap(monkeypatch):
    from modules.kb import provider
    from modules.skills import service as svc

    scripted = _Scripted([[_tc("web_search")]])  # 每轮都回工具调用 → 撞步数上限
    monkeypatch.setattr(provider.chat_llm, "stream_step", scripted.stream_step)

    async def fake_invoke(*_a, **_k):
        return "r"

    monkeypatch.setattr(svc.skills_service, "invoke", fake_invoke)
    monkeypatch.setattr(
        svc.skills_service,
        "tools",
        lambda **_kw: [{"type": "function", "function": {"name": "web_search"}}],
    )
    evs = [e async for e in sub.stream_run(None, "loop")]
    assert "步数上限" in evs[-1]["result"]


async def test_subagent_progress_streamed_to_parent(monkeypatch):
    # 主代理调 run_subagent → _execute_batch 特判把子代理进度当 tool_output 流出、结论落库回灌。
    import modules.agent.service as agsvc

    async def fake_sub(_session, _task):
        yield {"progress": "· web_search"}
        yield {"result": "子结论"}

    monkeypatch.setattr(agsvc, "subagent_run", fake_sub)
    rounds = [
        [
            {
                "type": "tool_calls",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "run_subagent", "arguments": '{"task":"t"}'}}
                ],
            }
        ],
        [{"type": "content", "delta": "综合完成"}],
    ]
    events, repo = await run_agent(monkeypatch, rounds)
    assert any(e["type"] == "tool_output" and "web_search" in e["delta"] for e in events)
    assert any(r.role == "tool" and "子结论" in r.content for r in repo.rows)  # 子结论作 tool 结果落库


def test_registered_readonly_public():
    from modules.skills.registry import REGISTRY

    s = REGISTRY["run_subagent"]
    assert s.risk == "readonly" and not s.private


async def test_subagent_internal_dedup(monkeypatch):
    # 子代理连续两轮搜等价 query（大小写/空格归一化后相同）→ 第二次本地去重、不再 invoke。
    from modules.kb import provider
    from modules.skills import service as svc

    scripted = _Scripted(
        [
            [_tc("web_search", '{"query":"x"}')],
            [_tc("web_search", '{"query":" X "}')],
            [{"type": "content", "delta": "done"}],
        ]
    )
    monkeypatch.setattr(provider.chat_llm, "stream_step", scripted.stream_step)
    calls = []

    async def fake_invoke(_session, _name, args, **_kw):
        calls.append(args.get("query"))
        return "结果"

    monkeypatch.setattr(svc.skills_service, "invoke", fake_invoke)
    monkeypatch.setattr(
        svc.skills_service, "tools", lambda **_kw: [{"type": "function", "function": {"name": "web_search"}}]
    )
    evs = [e async for e in sub.stream_run(None, "查 x")]
    assert calls == ["x"]  # 只真搜了一次；第二次等价 query 被去重
    assert evs[-1] == {"result": "done"}


# ---- 主代理侧收敛闸（_turn_cap）----


def test_turn_cap_subagent_limit():
    from modules.agent.service import MAX_SUBAGENTS_PER_TURN, _turn_cap

    state = {"subagents": 0, "searched": set()}
    for _ in range(MAX_SUBAGENTS_PER_TURN):
        assert _turn_cap("run_subagent", {}, state) is None  # 上限内放行
    assert "上限" in _turn_cap("run_subagent", {}, state)  # 超限拦截


def test_turn_cap_search_dedup():
    from modules.agent.service import _turn_cap

    state = {"subagents": 0, "searched": set()}
    assert _turn_cap("web_search", {"query": "DeepSeek"}, state) is None
    assert _turn_cap("web_search", {"query": " deepseek "}, state) is not None  # 归一化后同 query → 拦
    assert _turn_cap("kb_search", {"query": "别的"}, state) is None  # 不同 query 放行
    assert _turn_cap("web_fetch", {"url": "x"}, state) is None  # 非检索类不受去重影响
