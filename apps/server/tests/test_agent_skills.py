"""agent v2 的纯逻辑测试：update_plan 渲染、web_fetch SSRF 守卫与剥标签、token 估算。

都不碰 DB / 网络：_host_is_public 用 IP 字面量（getaddrinfo 不触发 DNS），
web_fetch 的拒绝分支在任何请求之前就返回。
"""

from urllib.parse import urlparse

import pytest
from modules.agent.service import _est_tokens, _strip_leak
from modules.kb.provider import _merge_tool_call_deltas
from modules.skills.ask_user import _handler as ask_handler
from modules.skills.update_plan import _handler as plan_handler
from modules.skills.web_fetch import _handler as fetch_handler
from modules.skills.web_fetch import _host_is_public, _pinned_url, _to_text

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


# 循环层场景（H1 skill 异常配对、多工具、ask_user、泄漏等）见 test_agent_loop.py。


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


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "0.0.0.0"],
)
def test_host_private_rejected(host):
    assert _host_is_public(host) is False


def test_host_public_ok():
    assert _host_is_public("8.8.8.8") is True


def test_pinned_url_uses_validated_ip_and_keeps_path_query():
    parsed = urlparse("https://example.com:8443/a/b?q=1#fragment")
    assert _pinned_url(parsed, "8.8.8.8") == "https://8.8.8.8:8443/a/b?q=1"


def test_pinned_url_brackets_ipv6():
    parsed = urlparse("https://example.com/a")
    assert _pinned_url(parsed, "2001:4860:4860::8888") == "https://[2001:4860:4860::8888]/a"


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
