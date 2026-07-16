"""MCP manager 测试（第 2 层，确定性）：配置解析 + 工具桥接排序 + 路由调用 + 隔离降级。

不起真 server：往 manager 注入 fake ClientSession（有 list_tools / call_tool）。
"""

import asyncio
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

    # MCP 是私有（鉴权）通道能力：privileged=True 才追加；公开通道拿不到
    assert "fs__read" not in [t["function"]["name"] for t in skills_service.tools(privileged=False)]
    names = [t["function"]["name"] for t in skills_service.tools(privileged=True)]
    assert names[:4] == ["kb_search", "update_plan", "web_fetch", "ask_user"]  # 原生在前、顺序固定
    assert "fs__read" in names  # MCP 追加在后
    # invoke 路由到 MCP（私有通道）
    m._sessions["fs"] = _FakeSession(
        [_tool("read")],
        result=SimpleNamespace(
            content=[SimpleNamespace(type="text", text="ok")], isError=False, structuredContent=None
        ),
    )
    await m.refresh_tools()
    assert await skills_service.invoke(None, "fs__read", {}, privileged=True) == "ok"


async def test_inert_when_no_servers():
    m = MCPManager()
    assert m.tools() == [] and not m.has("anything")
    with pytest.raises(KeyError):
        await m.invoke("nope", {})  # 未注册直接 KeyError（上层用 has() 先判）


# ---------- 超时兜底（启用真 server 的前置） ----------


class _HangingSession:
    """永远不返回的 server：真实场景是首次 uvx 要下载依赖、或 server 卡死。"""

    def __init__(self):
        self.called = False

    async def list_tools(self):
        self.called = True
        await asyncio.sleep(3600)

    async def call_tool(self, _name, arguments=None):
        await asyncio.sleep(3600)


async def test_hanging_list_tools_does_not_block_startup(monkeypatch):
    """MCP 在 app lifespan 里连——list_tools 卡死绝不能让 FastAPI 起不来（整站挂）。"""
    import modules.mcp.manager as m

    monkeypatch.setattr(m, "_LIST_TIMEOUT", 0.05)
    mgr = MCPManager()
    mgr._sessions = {"slow": _HangingSession()}
    mgr._server_auto = {"slow": False}
    await asyncio.wait_for(mgr.refresh_tools(), timeout=2)  # 没超时=没被吊死
    assert mgr.tools() == []  # 卡死的 server 被跳过，其余照常


async def test_hanging_tool_call_returns_message_not_hang(monkeypatch):
    """外部 server 卡住 → 收敛成工具结果让模型继续，别把 agent 这轮永远吊死。"""
    import modules.mcp.manager as m

    monkeypatch.setattr(m, "_CALL_TIMEOUT", 0.05)
    mgr = MCPManager()
    mgr._sessions = {"slow": _HangingSession()}
    mgr._route = {"slow__x": ("slow", "x")}
    out = await asyncio.wait_for(mgr.invoke("slow__x", {}), timeout=2)
    assert "无响应" in out  # 有结果、不抛、不吊死


async def test_connect_timeout_skips_server(monkeypatch):
    """连接/initialize 卡死 → 跳过该 server，站照常起（宁可少几个工具）。"""
    import modules.mcp.manager as m

    monkeypatch.setattr(m, "_CONNECT_TIMEOUT", 0.05)
    monkeypatch.setattr(m, "load_configs", lambda: [{"name": "hang", "command": "x"}])

    async def _never(_self, _name, _cfg):
        await asyncio.sleep(3600)

    monkeypatch.setattr(MCPManager, "_connect", _never)
    mgr = MCPManager()
    await asyncio.wait_for(mgr.start(), timeout=2)  # start 正常返回 = 站能起来
    assert mgr.tools() == []


async def test_status_reports_servers_and_tools():
    """status 是 MCP 唯一的可观测入口（工具只在私有通道、启动日志被 prod 过滤）。"""
    mgr = MCPManager()
    mgr._sessions = {"time": object()}
    mgr._route = {"time__get_current_time": ("time", "get_current_time")}
    mgr._auto = set()
    st = mgr.status()
    assert st["connected"] == ["time"]
    assert st["tools"] == [{"name": "time__get_current_time", "server": "time", "auto": False}]
