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


async def test_approval_pause_saves_pending_no_assistant(monkeypatch):
    """C2：这批含需批准工具 → 发 approval 事件、存 pending、不落 assistant（免孤儿 tool_call）、收尾。"""
    import modules.agent.service as svc

    monkeypatch.setattr(svc, "requires_approval", lambda name: name == "danger")

    async def should_not_run(_s, _n, _a):
        raise AssertionError("暂停时不该执行任何工具")

    rounds = [
        [
            {"type": "content", "delta": "我准备删这个文件"},
            {"type": "tool_calls", "tool_calls": [tool_call("danger", '{"path":"/x"}')]},
        ],
    ]
    events, repo = await run_agent(monkeypatch, rounds, invoke=should_not_run)
    apps = of_type(events, "approval")
    assert len(apps) == 1
    req = apps[0]["requests"][0]
    assert req["name"] == "danger" and req["args"] == {"path": "/x"} and req["id"] == "c1"
    assert events[-1]["type"] == "done"
    # 只落了 user，没落 assistant(tool_calls)——孤儿 tool_call 会毒化会话（H1）
    assert [r.role for r in repo.rows] == ["user"]
    pending = repo._session.pending
    assert pending is not None and pending["content"] == "我准备删这个文件"
    assert pending["tool_calls"][0]["function"]["name"] == "danger"


async def test_approval_resume_approve_executes(monkeypatch):
    """C2：带 approvals={id:True} 续跑 → 消费 pending、真执行工具、清 pending、继续作答、全程配对。"""
    import modules.agent.service as svc
    from modules.agent.repository import AgentWindow

    monkeypatch.setattr(svc, "requires_approval", lambda name: name == "danger")

    invoked = []

    async def inv(_s, name, _a):
        invoked.append(name)
        return "已删除 /x"

    pending = {"content": "我准备删这个文件", "tool_calls": [tool_call("danger", '{"path":"/x"}')]}
    window = AgentWindow(None, [{"role": "user", "content": "删掉 /x"}], next_seq=2, summarized_upto_seq=0)
    session = SimpleNamespace(id="s", summary=None, summarized_upto_seq=0, pending=pending)
    events, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "已经删好了。"}]],
        window=window,
        session=session,
        session_id="s",
        q="",
        approvals={"c1": True},
        invoke=inv,
    )
    assert invoked == ["danger"]  # 批准 → 真执行
    assert "已经删好了" in tokens(events)
    assert [r.role for r in repo.rows] == ["assistant", "tool", "assistant"]
    tool_row = next(r for r in repo.rows if r.role == "tool")
    assert "已删除" in tool_row.content
    assert repo._session.pending is None  # 消费后清空
    assert_paired(repo.rows)


async def test_approval_resume_without_pending_is_noop(monkeypatch):
    """C2：带 approvals 续跑但 pending 已消费/过期（重复提交）→ 直接 done，不伪造空 user 轮。"""

    async def should_not_run(_s, _n, _a):
        raise AssertionError("无 pending 不该执行任何工具")

    session = SimpleNamespace(id="s", summary=None, summarized_upto_seq=0, pending=None)
    events, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "不该被调用"}]],
        session=session,
        session_id="s",
        q="",
        approvals={"c1": True},
        invoke=should_not_run,
    )
    assert [e["type"] for e in events] == ["session", "done"]
    assert repo.rows == []  # 什么都没落
    assert "不该被调用" not in tokens(events)


async def test_empty_q_without_approvals_is_noop(monkeypatch):
    """空 q 且非续跑 → 直接 done，不落空 user 轮、不空跑一次 LLM。"""
    events, repo = await run_agent(monkeypatch, [[{"type": "content", "delta": "不该被调用"}]], q="   ")
    assert [e["type"] for e in events] == ["session", "done"]
    assert repo.rows == []


async def test_approval_resume_reject_skips_execution(monkeypatch):
    """C2：带 approvals={id:False} 续跑 → 工具不执行、回"用户拒绝"结果、仍配对、继续作答。"""
    import modules.agent.service as svc
    from modules.agent.repository import AgentWindow

    monkeypatch.setattr(svc, "requires_approval", lambda name: name == "danger")

    async def inv(_s, name, _a):
        if name == "danger":
            raise AssertionError("被拒的工具不该执行")
        return "x"

    pending = {"content": "我准备删这个文件", "tool_calls": [tool_call("danger", '{"path":"/x"}')]}
    window = AgentWindow(None, [{"role": "user", "content": "删掉 /x"}], next_seq=2, summarized_upto_seq=0)
    session = SimpleNamespace(id="s", summary=None, summarized_upto_seq=0, pending=pending)
    events, repo = await run_agent(
        monkeypatch,
        [[{"type": "content", "delta": "好的，已取消。"}]],
        window=window,
        session=session,
        session_id="s",
        q="",
        approvals={"c1": False},
        invoke=inv,
    )
    tool_row = next(r for r in repo.rows if r.role == "tool")
    assert "拒绝" in tool_row.content
    assert "已取消" in tokens(events)
    assert repo._session.pending is None
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
        session=SimpleNamespace(id="s", summary="摘要", summarized_upto_seq=0, pending=None),
        session_id="s",
        q="继续",
    )
    assert events[0] == {"type": "session", "session_id": "s"}  # 复用会话，未新建
    assert tokens(events) == "续答"
    # 新增从 next_seq=5 续，且是 user→assistant
    assert [(r.seq, r.role) for r in repo.rows] == [(5, "user"), (6, "assistant")]
    assert_paired(repo.rows)
