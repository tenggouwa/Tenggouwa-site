"""agent v2 的纯逻辑测试：update_plan 渲染、web_fetch SSRF 守卫与剥标签、token 估算。

都不碰 DB / 网络：_host_is_public 用 IP 字面量（getaddrinfo 不触发 DNS），
web_fetch 的拒绝分支在任何请求之前就返回。
"""

import pytest
from modules.agent.service import _est_tokens
from modules.skills.update_plan import _handler as plan_handler
from modules.skills.web_fetch import _handler as fetch_handler
from modules.skills.web_fetch import _host_is_public, _to_text

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
