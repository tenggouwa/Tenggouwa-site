"""本轮收敛闸 _turn_cap：检索归一化去重 + 每轮硬上限 + 子代理上限（纯函数，不联网不碰 DB）。"""

from modules.agent.service import (
    MAX_SEARCHES_PER_TURN,
    MAX_SUBAGENTS_PER_TURN,
    _norm_query,
    _turn_cap,
)
from modules.skills.subagent import SUBAGENT_SKILL


def _fresh() -> dict:
    return {"subagents": 0, "searched": set(), "loaded": set()}


def test_norm_query_collapses_punct_space_case():
    assert _norm_query("大模型省显存?") == _norm_query("大模型 省显存")
    assert _norm_query("DeepSeek V3") == _norm_query("deepseek-v3")
    assert _norm_query("  ") == ""


def test_first_search_passes_and_is_recorded():
    state = _fresh()
    assert _turn_cap("web_search", {"query": "大模型怎么省显存"}, state) is None
    assert len(state["searched"]) == 1


def test_near_duplicate_query_blocked():
    state = _fresh()
    assert _turn_cap("web_search", {"query": "大模型省显存?"}, state) is None
    # 换措辞/标点搜同一件事 → 归一化后同一个，拦住
    blocked = _turn_cap("kb_search", {"query": "大模型 省显存"}, state)
    assert blocked is not None and "已经搜过" in blocked
    assert len(state["searched"]) == 1


def test_hard_cap_after_max_distinct_searches():
    state = _fresh()
    for i in range(MAX_SEARCHES_PER_TURN):
        assert _turn_cap("web_search", {"query": f"实质不同的问题{i}"}, state) is None
    # 第 MAX+1 个「实质不同」的检索也被拦——挡归一化抓不住的换角度重搜
    over = _turn_cap("web_search", {"query": "又一个不同的问题"}, state)
    assert over is not None and "上限" in over
    assert len(state["searched"]) == MAX_SEARCHES_PER_TURN


def test_empty_query_not_counted():
    state = _fresh()
    assert _turn_cap("web_search", {"query": "   "}, state) is None
    assert len(state["searched"]) == 0


def test_subagent_cap():
    state = _fresh()
    for _ in range(MAX_SUBAGENTS_PER_TURN):
        assert _turn_cap(SUBAGENT_SKILL, {}, state) is None
    over = _turn_cap(SUBAGENT_SKILL, {}, state)
    assert over is not None and "子代理已达上限" in over
