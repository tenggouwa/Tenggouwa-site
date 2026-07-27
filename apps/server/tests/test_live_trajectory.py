"""轨迹级评估（第 5 层 live）：跑真 DeepSeek，评一整段运行——不只首个工具，而是全程。

三维：完成度（答案非空、命中要点）、效率（工具数 ≤ 预算）、绕路（无完全重复调用）。
默认 skip（同 test_live_skill_routing，需 RUN_LIVE_TESTS + KB_LLM_API_KEY）；夜跑、不进 PR 门禁。
纯函数打分（score_trajectory）另有离线单测（test_trajectory.py）守 PR 门。
"""

import os

import httpx
import pytest
from agent_harness import extract_trajectory, run_agent_live, score_trajectory, tokens

_live = pytest.mark.skipif(
    not (os.environ.get("RUN_LIVE_TESTS") and os.environ.get("KB_LLM_API_KEY")),
    reason="live 测试默认关：需 RUN_LIVE_TESTS=1 + KB_LLM_API_KEY",
)

_NET_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError)


async def _canned_invoke(_session, name, _args):
    return f"（{name} 占位结果，仅用于轨迹评测）"


async def _run(monkeypatch, q):
    last = None
    for _ in range(3):
        try:
            events, repo = await run_agent_live(monkeypatch, q, invoke=_canned_invoke)
            return extract_trajectory(repo.rows), tokens(events)
        except _NET_ERRORS as e:  # noqa: PERF203
            last = e
    return pytest.skip(f"DeepSeek 不可达（本机网络）：{last}")


# (query, 首轮/全程应命中的工具集, 工具预算)
_CASES = [
    ("站里那篇讲 RAG 的文章是怎么定义 RAG 的？", {"kb_search", "kb_graph"}, 6),
    ("帮我查现在 GitHub 上 star 最多的开源大模型项目", {"web_search", "web_fetch"}, 8),
]


@_live
@pytest.mark.parametrize("q,expected,budget", _CASES)
async def test_trajectory_efficient_and_on_task(monkeypatch, q, expected, budget):
    traj, answer = await _run(monkeypatch, q)
    names = {t["name"] for t in traj}
    score = score_trajectory(traj, budget=budget)
    # 效率 + 绕路：不超预算、无完全重复调用
    assert not score["over_budget"], f"{q!r} 工具用超预算：{score}"
    assert score["duplicates"] == 0, f"{q!r} 有重复调用（绕路）：{[t['name'] for t in traj]}"
    # 命中该用的工具
    assert names & expected, f"{q!r} 全程没用到预期工具：{names}，预期命中 {expected}"
    # 完成度（轻）：产出非空答案
    assert len(answer.strip()) > 20, f"{q!r} 答案过短/没收口：{answer!r}"


@_live
async def test_pure_qa_no_detour(monkeypatch):
    """纯通用知识问答：不该乱调工具、也不该绕路。"""
    traj, answer = await _run(monkeypatch, "用一句话说说快速排序的核心思想")
    score = score_trajectory(traj, budget=2)
    assert score["duplicates"] == 0
    assert len(answer.strip()) > 10
