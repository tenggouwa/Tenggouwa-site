"""E2 并发工具执行：整批 parallel-safe → 并发跑；含 write → 退回串行；结果顺序/H1 不变。"""

import asyncio

from agent_harness import run_agent
from modules.skills.permissions import is_parallel_safe


def _tc(name, tid):
    return {"id": tid, "type": "function", "function": {"name": name, "arguments": "{}"}}


def _round(*names):
    return [{"type": "tool_calls", "tool_calls": [_tc(n, f"c{i}") for i, n in enumerate(names)]}]


def _probe():
    """返回 (fake_invoke, stats)：记录并发峰值，并让先发的睡更久（证明顺序不是完成顺序）。"""
    stats = {"inflight": 0, "peak": 0, "order": []}
    delays = {"kb_search": 0.05, "web_search": 0.03, "web_fetch": 0.01, "file_write": 0.01}

    async def fake_invoke(_session, name, _args):
        stats["inflight"] += 1
        stats["peak"] = max(stats["peak"], stats["inflight"])
        await asyncio.sleep(delays.get(name, 0.01))
        stats["inflight"] -= 1
        stats["order"].append(name)  # 完成顺序
        return f"[{name}]"

    return fake_invoke, stats


async def test_readonly_batch_runs_concurrently(monkeypatch):
    invoke, stats = _probe()
    rounds = [_round("kb_search", "web_search", "web_fetch"), [{"type": "content", "delta": "done"}]]
    _events, repo = await run_agent(monkeypatch, rounds, invoke=invoke)
    assert stats["peak"] >= 2, "整批只读工具应并发跑"
    # 完成顺序按耗时（web_fetch 最快先完成），但落库仍按 tool_calls 原顺序
    assert stats["order"] == ["web_fetch", "web_search", "kb_search"]
    tool_rows = [r.content for r in repo.rows if r.role == "tool"]
    assert tool_rows == ["[kb_search]", "[web_search]", "[web_fetch]"]  # H1：顺序与 tool_calls 对齐


async def test_write_in_batch_forces_serial(monkeypatch):
    invoke, stats = _probe()
    rounds = [_round("kb_search", "file_write"), [{"type": "content", "delta": "done"}]]
    await run_agent(monkeypatch, rounds, invoke=invoke)
    assert stats["peak"] == 1, "含 write 工具的批次必须串行（Pi 侧本就串行 + 防 workspace 竞态）"


async def test_single_tool_batch_serial(monkeypatch):
    invoke, stats = _probe()
    await run_agent(monkeypatch, rounds=[_round("kb_search"), [{"type": "content", "delta": "d"}]], invoke=invoke)
    assert stats["peak"] == 1


async def test_h1_one_result_per_tool_call(monkeypatch):
    invoke, _ = _probe()
    rounds = [_round("kb_search", "web_search", "web_fetch"), [{"type": "content", "delta": "done"}]]
    _events, repo = await run_agent(monkeypatch, rounds, invoke=invoke)
    tool_rows = [r for r in repo.rows if r.role == "tool"]
    assert len(tool_rows) == 3
    assert [r.tool_call_id for r in tool_rows] == ["c0", "c1", "c2"]  # 每个 tool_call 配一条、id 对得上
    assert [r.seq for r in tool_rows] == sorted(r.seq for r in tool_rows)  # seq 递增不乱


def test_is_parallel_safe():
    assert is_parallel_safe("kb_search") and is_parallel_safe("web_search") and is_parallel_safe("run_subagent")
    assert is_parallel_safe("update_plan") and is_parallel_safe("ask_user")  # 控制类无副作用
    assert not is_parallel_safe("file_write") and not is_parallel_safe("shell_exec") and not is_parallel_safe("git")
    assert not is_parallel_safe("mcp__srv__tool")  # 未知/MCP 保守串行
