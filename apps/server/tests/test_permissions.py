"""工具权限判定测试（C1）：哪些工具调用需批准。"""

from types import SimpleNamespace

import modules.skills.permissions as perm
from modules.skills.base import Skill


async def _noop(_s, _a):
    return "x"


def test_control_flow_no_approval():
    assert perm.requires_approval("update_plan") is False
    assert perm.requires_approval("ask_user") is False


def test_readonly_native_no_approval():
    assert perm.requires_approval("kb_search") is False  # 现有原生都 readonly
    assert perm.requires_approval("web_fetch") is False


def test_write_native_needs_approval(monkeypatch):
    danger = Skill(name="danger", description="d", parameters={}, handler=_noop, risk="write")
    monkeypatch.setitem(perm.REGISTRY, "danger", danger)
    assert perm.requires_approval("danger") is True


def test_mcp_non_auto_needs_approval(monkeypatch):
    fake = SimpleNamespace(has=lambda n: n == "fs__rm", is_auto=lambda _n: False)
    monkeypatch.setattr(perm, "mcp_manager", fake)
    assert perm.requires_approval("fs__rm") is True


def test_mcp_auto_no_approval(monkeypatch):
    fake = SimpleNamespace(has=lambda n: n == "fs__read", is_auto=lambda _n: True)
    monkeypatch.setattr(perm, "mcp_manager", fake)
    assert perm.requires_approval("fs__read") is False


def test_unknown_tool_no_approval():
    assert perm.requires_approval("nope__x") is False  # 未知交给上层报错，不在此拦
