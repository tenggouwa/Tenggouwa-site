"""MCP manager 测试（第 2 层，确定性）：配置解析 + 工具桥接排序 + 路由调用 + 隔离降级。

不起真 server：往 manager 注入 fake ClientSession（有 list_tools / call_tool）。
"""

from types import SimpleNamespace

import pytest
from modules.mcp.manager import MCPManager, load_configs


def _tool(name, desc="d", schema=None):
    return SimpleNamespace(name=name, description=desc, inputSchema=schema or {"type": "object", "properties": {}})


class _FakeSession:
    def __init__(self, tools, *, list_raises=False, result=None):
        self._tools = tools
        self._list_raises = list_raises
        self._result = result
        self.called = None  # 记录最后一次 call_tool 的 (name, arguments)

    async def list_tools(self):
        if self._list_raises:
            raise RuntimeError("boom")
        return SimpleNamespace(tools=self._tools)

    async def call_tool(self, name, arguments):
        self.called = (name, arguments)
        return self._result


# ---------- load_configs ----------


def test_load_configs_empty(monkeypatch):
    monkeypatch.delenv("MCP_SERVERS", raising=False)
    assert load_configs() == []


def test_load_configs_invalid_json(monkeypatch):
    monkeypatch.setenv("MCP_SERVERS", "not-json")
    assert load_configs() == []


def test_load_configs_valid(monkeypatch):
    monkeypatch.setenv("MCP_SERVERS", '[{"name":"fs","command":"npx"}]')
    assert load_configs() == [{"name": "fs", "command": "npx"}]


def test_load_configs_filters_non_dict(monkeypatch):
    # 手误少包一层 object（"fs" 而非 {"name":"fs"}）→ 过滤掉，别崩全站启动（F1）
    monkeypatch.setenv("MCP_SERVERS", '["fs", {"name":"ok"}]')
    assert load_configs() == [{"name": "ok"}]


# ---------- refresh_tools 桥接 + 确定性排序 ----------


async def test_refresh_tools_sorted_and_routed():
    m = MCPManager()
    # 两个 server，故意乱序注入
    m._sessions = {
        "zeta": _FakeSession([_tool("write")]),
        "alpha": _FakeSession([_tool("read"), _tool("list")]),
    }
    await m.refresh_tools()
    names = [t["function"]["name"] for t in m.tools()]
    assert names == ["alpha__list", "alpha__read", "zeta__write"]  # 按 (server,tool) 字典序稳定
    assert m.has("alpha__read") and m.has("zeta__write")
    assert not m.has("read")  # 必须带 server 前缀


async def test_refresh_tools_isolates_failing_server():
    m = MCPManager()
    m._sessions = {
        "good": _FakeSession([_tool("ok")]),
        "bad": _FakeSession([], list_raises=True),  # list_tools 抛异常
    }
    await m.refresh_tools()  # 不该整体崩
    assert [t["function"]["name"] for t in m.tools()] == ["good__ok"]  # 坏 server 被跳过


# ---------- invoke 路由 ----------


async def test_invoke_routes_and_stringifies():
    result = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="文件内容")], isError=False, structuredContent=None
    )
    sess = _FakeSession([_tool("read")], result=result)
    m = MCPManager()
    m._sessions = {"fs": sess}
    await m.refresh_tools()
    assert await m.invoke("fs__read", {"path": "/a"}) == "文件内容"
    # 路由必须把「去前缀的 mcp 工具名」传给 server，而非 openai 名 fs__read（F6）
    assert sess.called == ("read", {"path": "/a"})


async def test_is_auto_tracks_trusted_server():
    m = MCPManager()
    m._sessions = {"trusted": _FakeSession([_tool("read")]), "other": _FakeSession([_tool("write")])}
    m._server_auto = {"trusted": True, "other": False}  # 仅 trusted 标了 auto
    await m.refresh_tools()
    assert m.is_auto("trusted__read") is True
    assert m.is_auto("other__write") is False


async def test_refresh_tools_dedups_name_collision():
    m = MCPManager()
    # 两个 tool sanitize 后同名 read_file → 只保留一个、不覆盖路由、不发重名 function（F3）
    m._sessions = {"fs": _FakeSession([_tool("read.file"), _tool("read/file")])}
    await m.refresh_tools()
    names = [t["function"]["name"] for t in m.tools()]
    assert names == ["fs__read_file"] and len(m._route) == 1


# ---------- 集成：skills_service 合并 MCP 工具 ----------


async def test_skills_service_merges_mcp_tools(monkeypatch):
    from modules.skills.service import skills_service

    m = MCPManager()
    m._sessions = {"fs": _FakeSession([_tool("read")])}
    await m.refresh_tools()
    monkeypatch.setattr("modules.skills.service.mcp_manager", m)

    names = [t["function"]["name"] for t in skills_service.tools()]
    assert names[:4] == ["kb_search", "update_plan", "web_fetch", "ask_user"]  # 原生在前、顺序固定
    assert "fs__read" in names  # MCP 追加在后
    # invoke 路由到 MCP
    m._sessions["fs"] = _FakeSession(
        [_tool("read")],
        result=SimpleNamespace(
            content=[SimpleNamespace(type="text", text="ok")], isError=False, structuredContent=None
        ),
    )
    await m.refresh_tools()
    assert await skills_service.invoke(None, "fs__read", {}) == "ok"


async def test_inert_when_no_servers():
    m = MCPManager()
    assert m.tools() == [] and not m.has("anything")
    with pytest.raises(KeyError):
        await m.invoke("nope", {})  # 未注册直接 KeyError（上层用 has() 先判）
