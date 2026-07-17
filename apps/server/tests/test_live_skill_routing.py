"""技能路由金标准（第 5 层 live）：跑真 DeepSeek，断言「给定 query，模型首个工具选择对不对」。

SYSTEM 去枚举后，选哪个工具**完全靠 skill 描述**——但没东西盯着它。web_search 一轮搜 13 次那种
routing 退化，之前是肉眼撞见的。这套把它变成夜跑网兜：改描述 / 加 skill / 换模型后，路由跑偏立刻红。

默认 skip：只有 RUN_LIVE_TESTS=1 + KB_LLM_API_KEY 才跑（同 test_live_smoke）。routing 天生带一点
模型抖动，所以放夜跑、不进 PR 门禁；case 只挑无歧义的，判定用「首轮工具集 ∩ 预期 非空」放宽。

用法：
    RUN_LIVE_TESTS=1 KB_LLM_API_KEY=sk-... uv run pytest tests/test_live_skill_routing.py -q
"""

import os
from types import SimpleNamespace

import httpx
import pytest
from agent_harness import first_tool_calls, run_agent_live

_live = pytest.mark.skipif(
    not (os.environ.get("RUN_LIVE_TESTS") and os.environ.get("KB_LLM_API_KEY")),
    reason="live 测试默认关：需 RUN_LIVE_TESTS=1 + KB_LLM_API_KEY",
)

_NET_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError)

_SEARCH = {"kb_search", "kb_graph", "web_search", "web_fetch"}


async def _canned_invoke(_session, name, _args):
    """所有 skill 返回短占位：不联网、不碰 DB，只为让循环走完、拿到首个工具选择。"""
    return f"（{name} 占位结果，仅用于路由评测）"


async def _route(monkeypatch, q) -> list[str]:
    last = None
    for _ in range(3):  # 本机连 DeepSeek 抖 → 重试几次仍不可达就 skip
        try:
            _, repo = await run_agent_live(monkeypatch, q, invoke=_canned_invoke)
            return first_tool_calls(repo.rows)
        except _NET_ERRORS as e:  # noqa: PERF203
            last = e
    return pytest.skip(f"DeepSeek 不可达（本机网络）：{last}")


# (query, 首轮工具集应命中其中之一) —— 只挑路由无歧义的。
_CASES = [
    ("RAG 和 embedding 之间是什么关系？顺便说说还跟哪些概念相关", {"kb_graph"}),
    ("站里那篇讲 RAG 的文章是怎么定义 RAG 的？", {"kb_search", "kb_graph"}),
    ("帮我查下现在 GitHub 上 star 最多的开源大模型项目是哪个", {"web_search", "web_fetch"}),
]


@_live
@pytest.mark.parametrize("q,expected", _CASES)
async def test_routing_picks_expected_tool(monkeypatch, q, expected):
    picked = await _route(monkeypatch, q)
    assert set(picked) & expected, f"路由跑偏：{q!r} 首轮工具={picked}，预期命中 {expected}"


@_live
async def test_pure_transform_does_not_over_search(monkeypatch):
    """纯转换任务（翻译）不该乱调检索——过度调用检索正是 web_search 13 次那类毛病的根。"""
    picked = await _route(monkeypatch, "把这句话翻译成英文：路由评测是agent的护栏")
    assert not (set(picked) & _SEARCH), f"翻译任务不该调检索工具，却调了 {picked}"


def test_first_tool_calls_helper_offline():
    """离线守住 harness 抽取器：跳过纯文本 assistant，取第一个带 tool_calls 的轮。"""
    rows = [
        SimpleNamespace(role="assistant", tool_calls=None),
        SimpleNamespace(
            role="assistant",
            tool_calls=[{"function": {"name": "kb_graph"}}, {"function": {"name": "kb_search"}}],
        ),
        SimpleNamespace(role="assistant", tool_calls=[{"function": {"name": "web_search"}}]),
    ]
    assert first_tool_calls(rows) == ["kb_graph", "kb_search"]
    assert first_tool_calls([SimpleNamespace(role="assistant", tool_calls=None)]) == []
