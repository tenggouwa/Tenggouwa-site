"""live 冒烟套件（第 5 层）：跑真 DeepSeek，断言金标准场景的不变量。

默认 skip：只有 RUN_LIVE_TESTS=1 且配了 KB_LLM_API_KEY 才跑（普通 CI 不联网、不花钱、不 flaky）。
本地发版前 `RUN_LIVE_TESTS=1 uv run pytest tests/test_live_smoke.py` + 夜间 cron 跑。
每修一个跟真实模型行为相关的 bug，就在这里加一个金标准场景。

用法：
    RUN_LIVE_TESTS=1 KB_LLM_API_KEY=sk-... uv run pytest tests/test_live_smoke.py -q
"""

import os

import httpx
import pytest
from agent_harness import assert_no_leak, assert_paired, run_agent_live, tokens

pytestmark = pytest.mark.skipif(
    not (os.environ.get("RUN_LIVE_TESTS") and os.environ.get("KB_LLM_API_KEY")),
    reason="live 测试默认关：需 RUN_LIVE_TESTS=1 + KB_LLM_API_KEY",
)

# 瞬时网络错误（本机连 DeepSeek 抖）不算回归 → 重试几次仍不可达就 skip，
# 报告才清晰：pass=断言过 / skip=够不着模型 / fail=真回归。
_NET_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError)


async def _run(monkeypatch, q):
    last = None
    for _ in range(3):
        try:
            return await run_agent_live(monkeypatch, q, invoke=_invoke_kb_empty)
        except _NET_ERRORS as e:  # noqa: PERF203
            last = e
    return pytest.skip(f"DeepSeek 不可达（本机网络）：{last}")


async def _invoke_kb_empty(session, name, args):
    """kb_search 返回 canned 空结果（免 DB）；其余 skill（web_fetch 等）真跑其 handler。"""
    from modules.skills.registry import REGISTRY

    if name == "kb_search":
        return "知识库里没有相关内容。"
    skill = REGISTRY.get(name)
    return await skill.handler(session, args) if skill else f"（未知 skill {name}）"


def _base_invariants(events, repo):
    ans = tokens(events)
    assert_no_leak(ans)  # 绝不能有 ｜ 泄漏
    assert_paired(repo.rows)  # 会话消息配对（可 resume，不会 400）
    assert events[-1]["type"] == "done"
    usage = [e for e in events if e["type"] == "usage"]
    assert usage and usage[0].get("prompt_tokens", 0) > 0  # A4：有真实用量
    # 工具不能是「意外异常」收场：_exec_one 只在抛异常时才产出「…执行失败」。
    # 曾经 harness 签名不匹配（少收 privileged）→ 每次工具调用 TypeError 被吞成这个，
    # 而不变量照样成立 → 用例假绿、工具从没真跑过。这条就是防那种假绿的哨兵。
    # 注意：工具**优雅**报错是「抓取失败 / 搜索失败」等，不含此标记，不会误伤。
    crashed = [r.content[:80] for r in repo.rows if r.role == "tool" and "执行失败" in r.content]
    assert not crashed, f"工具以意外异常收场（harness 或 skill 坏了）: {crashed}"
    return ans


async def test_live_kb_empty_falls_back_to_general_knowledge(monkeypatch):
    """知识库查不到 → 回退通用知识正常作答，不拒答。"""
    events, repo = await _run(monkeypatch, "介绍一下梅兰芳")
    ans = _base_invariants(events, repo)
    assert len(ans) > 60, f"答案过短疑似拒答: {ans!r}"
    assert any(k in ans for k in ["京剧", "梅派", "旦", "戏曲"]), f"没回退到通用知识: {ans[:120]!r}"


async def test_live_code_answer_not_truncated(monkeypatch):
    """长代码答案完整输出：无泄漏、代码围栏成对闭合。"""
    events, repo = await _run(monkeypatch, "给我一个完整的 Python 快速排序实现，带注释，直接给代码。")
    ans = _base_invariants(events, repo)
    assert ans.count("```") % 2 == 0, f"代码围栏未闭合（疑似截断）: ...{ans[-80:]!r}"
    assert len(ans) > 80


async def test_live_multi_tool_completes(monkeypatch):
    """开放需求触发工具（web_fetch 等）→ 整轮完成、有实质答案，不断在半截。"""
    events, repo = await _run(monkeypatch, "帮我抓一下 x 上面关于 ai 的最新消息并推送给我")
    ans = _base_invariants(events, repo)
    assert len(ans) > 40, f"答案过短/断在半截: {ans!r}"
