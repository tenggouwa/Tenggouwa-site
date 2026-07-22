"""browser skill：沙箱门控 + 参数校验 + 结果透传 + 注册属性（不联网、不碰真 Pi）。"""

import modules.skills.browser as br
import pytest


async def test_disabled_without_sandbox(monkeypatch):
    monkeypatch.delenv("AGENT_PI_SANDBOX", raising=False)
    assert "未启用 Pi 沙箱" in await br._handler(None, {"action": "snapshot"})


async def test_unknown_action(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    out = await br._handler(None, {"action": "teleport"})
    assert "未知浏览器动作" in out


async def test_navigate_requires_url(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    assert "需要 url" in await br._handler(None, {"action": "navigate"})


async def test_click_requires_ref(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    assert "需要 ref" in await br._handler(None, {"action": "click"})


async def test_navigate_passes_url_and_returns_snapshot(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    seen = {}

    async def fake_submit(action, **kw):
        kw.pop("timeout", None)
        seen.update(action=action, **kw)
        return {"rc": 0, "output": '[标题] Example\n[可交互元素] 共 1\n  e1   link "更多"', "truncated": False}

    monkeypatch.setattr(br.pi_exec, "submit_browser", fake_submit)
    out = await br._handler(None, {"action": "navigate", "url": "https://example.com"})
    assert seen == {"action": "navigate", "url": "https://example.com"}
    assert "可交互元素" in out and "e1" in out


async def test_type_passes_text_and_submit(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    seen = {}

    async def fake_submit(action, **kw):
        kw.pop("timeout", None)
        seen.update(action=action, **kw)
        return {"rc": 0, "output": "ok"}

    monkeypatch.setattr(br.pi_exec, "submit_browser", fake_submit)
    await br._handler(None, {"action": "type", "ref": "e2", "text": "hello", "submit": True})
    assert seen == {"action": "type", "ref": "e2", "text": "hello", "submit": True}


async def test_sandbox_no_response(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")

    async def boom(*_a, **_k):
        raise TimeoutError

    monkeypatch.setattr(br.pi_exec, "submit_browser", boom)
    assert "无响应" in await br._handler(None, {"action": "snapshot"})


def test_registered_private_readonly_and_serial():
    from modules.skills.permissions import is_parallel_safe
    from modules.skills.registry import REGISTRY

    s = REGISTRY["browser"]
    assert s.private is True and s.risk == "readonly"
    assert is_parallel_safe("browser") is False  # 持久页面状态 → 串行


def test_not_in_public_channel():
    from modules.skills.service import skills_service

    names = {t["function"]["name"] for t in skills_service.tools(privileged=False)}
    assert "browser" not in names  # private → 公开通道不暴露


@pytest.mark.parametrize("action", ["navigate", "snapshot", "click", "type", "back", "close"])
def test_all_actions_in_enum(action):
    props = br.BROWSER.parameters["properties"]
    assert action in props["action"]["enum"]
