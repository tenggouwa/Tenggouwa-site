"""轨迹级评估的纯函数：extract_trajectory（全程工具调用）+ score_trajectory（效率/绕路）。离线确定性。"""

import json
from types import SimpleNamespace

from agent_harness import extract_trajectory, score_trajectory


def _assistant(*names_and_args):
    """造一个带 tool_calls 的 assistant row。传 (name, args_dict) 若干。"""
    tcs = [{"function": {"name": n, "arguments": json.dumps(a)}} for n, a in names_and_args]
    return SimpleNamespace(role="assistant", tool_calls=tcs)


def test_extract_spans_all_rounds_in_order():
    rows = [
        SimpleNamespace(role="user", tool_calls=None),
        _assistant(("kb_search", {"query": "a"})),
        SimpleNamespace(role="tool", tool_calls=None),
        _assistant(("web_search", {"query": "b"}), ("web_fetch", {"url": "u"})),
    ]
    traj = extract_trajectory(rows)
    assert [t["name"] for t in traj] == ["kb_search", "web_search", "web_fetch"]
    assert traj[0]["args"] == {"query": "a"}


def test_score_efficient_run():
    traj = [{"name": "kb_search", "args": {"query": "x"}}, {"name": "web_fetch", "args": {"url": "u"}}]
    s = score_trajectory(traj, budget=4)
    assert s == {"tools": 2, "over_budget": False, "duplicates": 0, "efficient": True}


def test_score_flags_duplicates():
    # 完全相同的调用重复 = 绕路
    traj = [{"name": "kb_search", "args": {"query": "x"}}, {"name": "kb_search", "args": {"query": "x"}}]
    s = score_trajectory(traj, budget=6)
    assert s["duplicates"] == 1 and s["efficient"] is False


def test_score_flags_over_budget():
    traj = [{"name": "web_search", "args": {"query": str(i)}} for i in range(5)]
    s = score_trajectory(traj, budget=3)
    assert s["over_budget"] is True and s["efficient"] is False


def test_score_same_tool_different_args_not_dup():
    # 同工具但参数不同 = 正常多步，不算绕路
    traj = [{"name": "web_fetch", "args": {"url": "a"}}, {"name": "web_fetch", "args": {"url": "b"}}]
    assert score_trajectory(traj, budget=4)["duplicates"] == 0
