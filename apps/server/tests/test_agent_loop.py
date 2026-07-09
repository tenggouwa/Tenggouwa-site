"""agent 循环层场景测试（第 2 层，确定性、不联网）。

每修一个 bug 就往这里加一个永久场景（golden scenario corpus，只增不减）。
harness 见 agent_harness.py。
"""

from types import SimpleNamespace

from agent_harness import assert_no_leak, assert_paired, of_type, run_agent, tokens, tool_call


async def test_plain_answer_no_tools(monkeypatch):
    """无工具调用：正文即最终答案，落库一条 user + 一条 assistant。"""
    events, repo = await run_agent(monkeypatch, [[{"type": "content", "delta": "你好世界"}]])
    assert tokens(events) == "你好世界"
    assert events[0]["type"] == "session"
    assert events[-1]["type"] == "done"
    assert [r.role for r in repo.rows] == ["user", "assistant"]
    assert_paired(repo.rows)


async def test_multi_tool_parallel_then_answer(monkeypatch):
    """一轮并行两个工具 → 都执行并配对 → 下一轮出最终答案。"""
    rounds = [
        [
            {"type": "content", "delta": "好的我查一下。"},
            {
                "type": "tool_calls",
                "tool_calls": [
                    tool_call("kb_search", '{"query":"x"}', tid="a"),
                    tool_call("web_fetch", '{"url":"http://x"}', tid="b"),
                ],
            },
        ],
        [{"type": "content", "delta": "综合结论。"}],
    ]
    events, repo = await run_agent(monkeypatch, rounds)
    assert [t["name"] for t in of_type(events, "tool")] == ["kb_search", "web_fetch"]
    assert tokens(events).endswith("综合结论。")
    # user, assistant(2 tc), tool, tool, assistant(final)
    assert [r.role for r in repo.rows] == ["user", "assistant", "tool", "tool", "assistant"]
    assert_paired(repo.rows)
    assert_no_leak(tokens(events))


async def test_ask_user_ends_turn(monkeypatch):
    """ask_user：发 ask 事件、结束本轮（不再流式作答），且 tool 结果已落库配对。"""
    rounds = [
        [
            {"type": "content", "delta": "先确认几点。"},
            {
                "type": "tool_calls",
                "tool_calls": [tool_call("ask_user", '{"questions":[{"question":"q","options":["a","b"]}]}')],
            },
        ],
        [{"type": "content", "delta": "不该被调用"}],  # 若被调用说明没收尾
    ]
    events, repo = await run_agent(monkeypatch, rounds)
    asks = of_type(events, "ask")
    assert len(asks) == 1 and asks[0]["questions"][0]["options"] == ["a", "b"]
    assert "不该被调用" not in tokens(events)  # 抛完选择题即停
    assert [r.role for r in repo.rows] == ["user", "assistant", "tool"]
    assert_paired(repo.rows)


async def test_plan_event_emitted(monkeypatch):
    """update_plan：发 plan 事件（不当普通 tool 显示），继续到最终答案。"""
    plan = [{"step": "查", "status": "completed"}, {"step": "答", "status": "in_progress"}]
    import json

    rounds = [
        [{"type": "tool_calls", "tool_calls": [tool_call("update_plan", json.dumps({"plan": plan}))]}],
        [{"type": "content", "delta": "答案"}],
    ]
    events, _ = await run_agent(monkeypatch, rounds)
    plans = of_type(events, "plan")
    assert len(plans) == 1 and plans[0]["plan"] == plan
    assert of_type(events, "tool") == []  # plan 不走 tool 事件


async def test_leak_in_content_single_delta(monkeypatch):
    """content 里混入 ｜ 泄漏：截断丢弃，答案与落库都干净。"""
    events, repo = await run_agent(
        monkeypatch, [[{"type": "content", "delta": "答案完整。<｜｜DSML｜｜tool_calls>脏"}]]
    )
    assert tokens(events) == "答案完整。"
    assert_no_leak(tokens(events))
    assert repo.rows[-1].role == "assistant" and "｜" not in repo.rows[-1].content


async def test_leak_across_deltas_stops_emitting(monkeypatch):
    """泄漏跨 delta：见到 ｜ 后本轮后续 content 全丢，不漏后段 junk。"""
    rounds = [
        [
            {"type": "content", "delta": "答案"},
            {"type": "content", "delta": "结尾"},
            {"type": "content", "delta": "<｜junk"},
            {"type": "content", "delta": "more junk"},
        ]
    ]
    events, _ = await run_agent(monkeypatch, rounds)
    assert tokens(events) == "答案结尾"
    assert "junk" not in tokens(events)


async def test_usage_emitted(monkeypatch):
    """A4：stream_step 的 usage 累计后，收尾发一个扁平的 event: usage。"""
    rounds = [
        [
            {"type": "content", "delta": "答"},
            {"type": "usage", "usage": {"prompt_tokens": 10, "completion_tokens": 5}},
        ],
    ]
    events, _ = await run_agent(monkeypatch, rounds)
    u = of_type(events, "usage")
    assert len(u) == 1 and u[0]["prompt_tokens"] == 10 and u[0]["completion_tokens"] == 5


async def test_usage_summed_across_steps(monkeypatch):
    """A4：一轮多次 LLM 调用（工具往返）→ usage 各字段累加。"""
    rounds = [
        [
            {"type": "tool_calls", "tool_calls": [tool_call("kb_search", "{}")]},
            {"type": "usage", "usage": {"prompt_tokens": 10}},
        ],
        [
            {"type": "content", "delta": "答"},
            {"type": "usage", "usage": {"prompt_tokens": 20, "completion_tokens": 8}},
        ],
    ]
    events, _ = await run_agent(monkeypatch, rounds)
    u = of_type(events, "usage")[0]
    assert u["prompt_tokens"] == 30 and u["completion_tokens"] == 8


async def test_no_usage_event_when_absent(monkeypatch):
    """无 usage → 不发 usage 事件（不硬塞空对象）。"""
    events, _ = await run_agent(monkeypatch, [[{"type": "content", "delta": "答"}]])
    assert of_type(events, "usage") == []


async def test_usage_includes_m2_fallback(monkeypatch):
    """A4：MAX_STEPS 耗尽走 M2 收尾时，M2 那次调用的 usage 也计入（覆盖 M2 累加分支）。"""
    from modules.agent.service import MAX_STEPS

    tool_round = [
        {"type": "tool_calls", "tool_calls": [tool_call("kb_search", "{}")]},
        {"type": "usage", "usage": {"prompt_tokens": 1}},
    ]
    m2_round = [
        {"type": "content", "delta": "收尾"},
        {"type": "usage", "usage": {"prompt_tokens": 100, "completion_tokens": 5}},
    ]
    rounds = [tool_round] * MAX_STEPS + [m2_round]
    events, _ = await run_agent(monkeypatch, rounds)
    u = of_type(events, "usage")[0]
    assert u["prompt_tokens"] == MAX_STEPS * 1 + 100 and u["completion_tokens"] == 5


async def test_tool_output_truncated(monkeypatch):
    """A2：超大 tool 结果被截断，防单个工具输出撑爆上下文。"""

    async def big(_s, _name, _a):
        return "y" * 20000

    rounds = [
        [{"type": "tool_calls", "tool_calls": [tool_call("kb_search", "{}")]}],
        [{"type": "content", "delta": "答"}],
    ]
    _, repo = await run_agent(monkeypatch, rounds, invoke=big)
    tool_row = next(r for r in repo.rows if r.role == "tool")
    assert len(tool_row.content) < 20000
    assert "已截断" in tool_row.content


async def test_requires_approval_tool_blocked(monkeypatch):
    """C1：需批准的工具不执行，回一条"需批准"结果（仍配对，H1 保持）。"""
    import modules.agent.service as svc

    monkeypatch.setattr(svc, "requires_approval", lambda name: name == "danger")

    async def should_not_run(_s, _n, _a):
        raise AssertionError("被拦的工具不该执行")

    rounds = [
        [{"type": "tool_calls", "tool_calls": [tool_call("danger", "{}")]}],
        [{"type": "content", "delta": "改用别的办法"}],
    ]
    events, repo = await run_agent(monkeypatch, rounds, invoke=should_not_run)
    tool_row = next(r for r in repo.rows if r.role == "tool")
    assert "需人工批准" in tool_row.content
    assert "改用别的办法" in tokens(events)
    assert_paired(repo.rows)


async def test_skill_exception_keeps_paired(monkeypatch):
    """H1：skill handler 抛异常也补 error tool 结果，保住配对，仍出最终答案。"""

    async def boom(*_a):
        raise RuntimeError("timeout")

    rounds = [
        [
            {"type": "content", "delta": "我来抓取"},
            {"type": "tool_calls", "tool_calls": [tool_call("web_fetch", '{"url":"http://x"}')]},
        ],
        [{"type": "content", "delta": "抓取失败了，给你替代方案。"}],
    ]
    events, repo = await run_agent(monkeypatch, rounds, invoke=boom)
    idx = next(i for i, r in enumerate(repo.rows) if r.role == "assistant" and r.tool_calls)
    assert repo.rows[idx + 1].role == "tool" and "执行失败" in repo.rows[idx + 1].content
    assert "替代方案" in tokens(events)
    assert_paired(repo.rows)


async def test_max_steps_forced_final_answer(monkeypatch):
    """M2：模型一直调工具耗尽 MAX_STEPS → 强制一次不带 tools 的收尾作答，不空手而归。"""
    from modules.agent.service import MAX_STEPS

    tool_round = [{"type": "tool_calls", "tool_calls": [tool_call("kb_search", "{}")]}]
    rounds = [tool_round] * MAX_STEPS + [[{"type": "content", "delta": "达到步数上限，先给结论。"}]]
    events, repo = await run_agent(monkeypatch, rounds)
    assert "达到步数上限" in tokens(events)
    assert repo.rows[-1].role == "assistant" and repo.rows[-1].tool_calls is None
    assert_paired(repo.rows)


async def test_compaction_triggers_and_boundary_on_user_turn(monkeypatch):
    """历史超阈值且轮数足够 → 摘要旧轮，且边界钉在 user 轮上（否则 resume 会切出孤儿 tool → 400）。"""
    big = "x" * 12000  # est ~6000 token/条；8 条 ~48000 > COMPACT_TOKENS(24000)
    # seq 奇=user 偶=assistant → user_seqs=[1,3,5,7]，KEEP_TURNS=3 → boundary=user_seqs[-3]=3，upto=2
    old_rows = [SimpleNamespace(seq=i, role="user" if i % 2 else "assistant", content=big) for i in range(1, 9)]
    _, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "答"}]],
        rows_after=old_rows,
        session=SimpleNamespace(id="s", summary=None, summarized_upto_seq=0),
    )
    assert repo.saved is not None  # 触发了 compaction
    assert repo.saved[1] == 2  # summarized_upto = boundary-1；边界 seq=3 是 user 轮
    assert next(r.role for r in old_rows if r.seq == repo.saved[1] + 1) == "user"


async def test_compaction_skipped_when_small(monkeypatch):
    """历史 token 很小 → 不 compaction（token 阈值早退）。"""
    small = [SimpleNamespace(seq=i, role="user", content="短") for i in range(1, 4)]
    _, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "答"}]],
        rows_after=small,
        session=SimpleNamespace(id="s", summary=None, summarized_upto_seq=0),
    )
    assert repo.saved is None


async def test_compaction_skipped_when_few_user_turns(monkeypatch):
    """token 超阈值但 user 轮数 ≤ KEEP_TURNS → 仍 skip（切了不安全，第二条早退分支）。"""
    big = "x" * 20000  # est ~10000/条
    rows = [
        SimpleNamespace(seq=1, role="user", content=big),
        SimpleNamespace(seq=2, role="assistant", content=big),
        SimpleNamespace(seq=3, role="user", content=big),  # 仅 2 个 user 轮 ≤ KEEP_TURNS=3
    ]
    _, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "答"}]],
        rows_after=rows,
        session=SimpleNamespace(id="s", summary=None, summarized_upto_seq=0),
    )
    assert repo.saved is None


async def test_resume_reuses_session_and_continues_seq(monkeypatch):
    """传 session_id 走 resume 分支：复用已存在会话、seq 从 window.next_seq 续、历史+新增仍配对。"""
    from modules.agent.repository import AgentWindow

    # 注入一段合法历史（assistant(tool_calls) 后紧跟配对 tool，再一条最终答案）
    history = [
        {"role": "user", "content": "上一问"},
        {"role": "assistant", "content": "", "tool_calls": [tool_call("kb_search", "{}")]},
        {"role": "tool", "tool_call_id": "c1", "content": "结果"},
        {"role": "assistant", "content": "上一答"},
    ]
    window = AgentWindow("摘要", history, next_seq=5, summarized_upto_seq=0)
    events, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "续答"}]],
        window=window,
        session=SimpleNamespace(id="s", summary="摘要", summarized_upto_seq=0),
        session_id="s",
        q="继续",
    )
    assert events[0] == {"type": "session", "session_id": "s"}  # 复用会话，未新建
    assert tokens(events) == "续答"
    # 新增从 next_seq=5 续，且是 user→assistant
    assert [(r.seq, r.role) for r in repo.rows] == [(5, "user"), (6, "assistant")]
    assert_paired(repo.rows)
