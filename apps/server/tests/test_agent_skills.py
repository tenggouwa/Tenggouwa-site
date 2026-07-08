"""agent v2 的纯逻辑测试：update_plan 渲染、web_fetch SSRF 守卫与剥标签、token 估算。

都不碰 DB / 网络：_host_is_public 用 IP 字面量（getaddrinfo 不触发 DNS），
web_fetch 的拒绝分支在任何请求之前就返回。
"""

import pytest
from modules.agent.service import _est_tokens, _strip_leak
from modules.kb.provider import _merge_tool_call_deltas
from modules.skills.ask_user import _handler as ask_handler
from modules.skills.update_plan import _handler as plan_handler
from modules.skills.web_fetch import _handler as fetch_handler
from modules.skills.web_fetch import _host_is_public, _to_text

# ---------- stream_step 的 tool_calls 分片累积 ----------


def test_merge_tool_calls_fragmented_arguments():
    acc: dict = {}
    # 第一片带 id+name+参数开头，后续片只追加 arguments
    _merge_tool_call_deltas(acc, [{"index": 0, "id": "c1", "function": {"name": "kb_search", "arguments": '{"q'}}])
    _merge_tool_call_deltas(acc, [{"index": 0, "function": {"arguments": 'uery":"'}}])
    _merge_tool_call_deltas(acc, [{"index": 0, "function": {"arguments": '梅兰芳"}'}}])
    out = [acc[i] for i in sorted(acc)]
    assert out == [
        {"id": "c1", "type": "function", "function": {"name": "kb_search", "arguments": '{"query":"梅兰芳"}'}}
    ]


def test_merge_tool_calls_parallel_indexes_no_crosstalk():
    acc: dict = {}
    _merge_tool_call_deltas(acc, [{"index": 0, "id": "a", "function": {"name": "kb_search", "arguments": ""}}])
    _merge_tool_call_deltas(acc, [{"index": 1, "id": "b", "function": {"name": "web_fetch", "arguments": ""}}])
    _merge_tool_call_deltas(acc, [{"index": 1, "function": {"arguments": '{"url":"x"}'}}])
    _merge_tool_call_deltas(acc, [{"index": 0, "function": {"arguments": '{"query":"y"}'}}])
    out = [acc[i] for i in sorted(acc)]
    assert out[0]["id"] == "a" and out[0]["function"] == {"name": "kb_search", "arguments": '{"query":"y"}'}
    assert out[1]["id"] == "b" and out[1]["function"] == {"name": "web_fetch", "arguments": '{"url":"x"}'}


def test_merge_tool_calls_empty_deltas_noop():
    acc: dict = {}
    _merge_tool_call_deltas(acc, [])
    assert acc == {}


# ---------- H1：skill 抛异常不得留下孤儿 tool_call（否则会话 resume 被 DeepSeek 400 毒化）----------


class _FakeRepo:
    def __init__(self, session, rows):
        self._rows = rows

    async def create_session(self, title):
        return "s"

    async def get_session(self, sid):
        class _R:
            id = "s"
            summary = None
            summarized_upto_seq = 0

        return _R() if sid else None

    async def load_window(self, sid):
        from modules.agent.repository import AgentWindow

        return AgentWindow(None, [], 1, 0)

    async def append(self, sid, seq, role, content, *, tool_calls=None, tool_call_id=None):
        self._rows.append((role, bool(tool_calls), content))

    async def rows_after(self, sid, seq):
        return []

    async def save_summary(self, *a, **k):
        pass


async def test_skill_exception_keeps_toolcall_paired(monkeypatch):
    import modules.agent.service as svc

    rows: list = []
    monkeypatch.setattr(svc, "AgentRepository", lambda session: _FakeRepo(session, rows))
    monkeypatch.setattr(svc.skills_service, "tools", list)  # 空 tools

    calls = {"n": 0}

    async def fake_stream_step(_messages, **_kw):
        calls["n"] += 1
        if calls["n"] == 1:
            yield {"type": "content", "delta": "好的我来抓取"}
            yield {
                "type": "tool_calls",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "web_fetch", "arguments": '{"url":"http://x"}'},
                    }
                ],
            }
        else:
            yield {"type": "content", "delta": "抓取失败了，建议直接看官方账号。"}

    monkeypatch.setattr(svc.chat_llm, "stream_step", fake_stream_step)

    async def boom(*_a):
        raise RuntimeError("timeout")

    monkeypatch.setattr(svc.skills_service, "invoke", boom)

    events = [ev async for ev in svc.agent_service.answer_stream(None, "帮我抓 x")]

    # 带 tool_calls 的 assistant 之后必须紧跟一条 tool 结果（配对，无孤儿）
    idx = next(i for i, (role, tc, _) in enumerate(rows) if role == "assistant" and tc)
    assert rows[idx + 1][0] == "tool"
    assert "执行失败" in rows[idx + 1][2]
    # 且仍产出了最终 assistant 答案 + token 流
    assert any(role == "assistant" and not tc for role, tc, _ in rows)
    assert any(e["type"] == "token" for e in events)


# ---------- tool-call 泄漏过滤 ----------


def test_strip_leak_removes_deepseek_toolcall():
    ans = '方案已给出，见上文代码。<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="update_plan">'
    assert _strip_leak(ans) == "方案已给出，见上文代码。"


def test_strip_leak_trims_dangling_lt():
    assert _strip_leak("答案完整。\n\n<｜tool") == "答案完整。"


def test_strip_leak_passthrough_clean():
    clean = "普通答案，含 List<int> 和 a < b，无特殊 token。"
    assert _strip_leak(clean) == clean


# ---------- ask_user ----------


async def test_ask_empty():
    assert await ask_handler(None, {"questions": []}) == "（未提供问题）"
    assert await ask_handler(None, {}) == "（未提供问题）"


async def test_ask_counts_questions():
    out = await ask_handler(
        None,
        {
            "questions": [
                {"question": "会写 Python 吗？", "options": ["会", "不会"]},
                {"question": "有服务器吗？", "options": ["有", "没有"]},
            ]
        },
    )
    assert "2" in out


# ---------- update_plan ----------


async def test_plan_empty():
    assert await plan_handler(None, {"plan": []}) == "（计划为空）"
    assert await plan_handler(None, {}) == "（计划为空）"


async def test_plan_renders_marks():
    out = await plan_handler(
        None,
        {
            "plan": [
                {"step": "查知识库", "status": "completed"},
                {"step": "综合作答", "status": "in_progress"},
                {"step": "补链接", "status": "pending"},
            ]
        },
    )
    assert "[✓] 查知识库" in out
    assert "[·] 综合作答" in out
    assert "[ ] 补链接" in out


async def test_plan_warns_on_multiple_in_progress():
    out = await plan_handler(
        None,
        {"plan": [{"step": "a", "status": "in_progress"}, {"step": "b", "status": "in_progress"}]},
    )
    assert "至多一个" in out


async def test_plan_bad_status_falls_back_to_pending():
    out = await plan_handler(None, {"plan": [{"step": "x", "status": "garbage"}]})
    assert "[ ] x" in out


# ---------- web_fetch SSRF 守卫 ----------


@pytest.mark.parametrize("host", ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "0.0.0.0"])
def test_host_private_rejected(host):
    assert _host_is_public(host) is False


def test_host_public_ok():
    assert _host_is_public("8.8.8.8") is True


async def test_fetch_rejects_non_http():
    assert "http" in await fetch_handler(None, {"url": "ftp://example.com/x"})
    assert "http" in await fetch_handler(None, {"url": "file:///etc/passwd"})


async def test_fetch_rejects_private_target():
    out = await fetch_handler(None, {"url": "http://127.0.0.1:8000/admin"})
    assert "公网" in out


def test_to_text_strips_tags_and_scripts():
    html = "<html><head><style>.a{color:red}</style></head><body><p>你好</p><script>evil()</script>世界</body></html>"
    text = _to_text(html)
    assert "你好" in text
    assert "世界" in text
    assert "evil" not in text
    assert "<" not in text


# ---------- token 估算 ----------


@pytest.mark.parametrize("text,expected", [("", 0), ("ab", 1), ("abcd", 2), ("六个字六个字", 3)])
def test_est_tokens(text, expected):
    assert _est_tokens(text) == expected
