"""文件工具（D1，现走 Pi 沙箱）：路由到 pi_exec.submit_file + 门控。

jail 逻辑已移到 Pi 侧（apps/pi-agent/agent/executor._run_file，那里 realpath jail 在 PI_AGENT_WORKSPACE 内，
含 `..`/符号链接/绝对路径防越狱——用 pi-agent 自身 smoke 验，不在本 CI 路径）。这里只验服务端路由与门控。
"""

import modules.skills.file_ops as fo


async def test_file_ops_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_PI_SANDBOX", raising=False)
    assert "未启用" in await fo._read_handler(None, {"path": "a"})
    assert "未启用" in await fo._write_handler(None, {"path": "a", "content": "x"})
    assert "未启用" in await fo._list_handler(None, {"path": "."})


async def test_file_read_routes_to_pi(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake(op, path, content, **_kw):
        calls.append((op, path, content))
        return {"rc": 0, "output": "file body"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    assert await fo._read_handler(None, {"path": "notes/a.txt"}) == "file body"
    assert calls == [("read", "notes/a.txt", "")]  # read 不传 content


async def test_file_write_routes_with_content(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake(op, path, content, **_kw):
        calls.append((op, path, content))
        return {"rc": 0, "output": "（已写入 a）"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    out = await fo._write_handler(None, {"path": "a", "content": "hi"})
    assert calls == [("write", "a", "hi")] and "已写入" in out


async def test_file_list_routes(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")

    async def fake(op, *_a, **_kw):
        assert op == "list"
        return {"rc": 0, "output": "./\nfile\t3\ta.txt"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    assert "a.txt" in await fo._list_handler(None, {"path": "."})


async def test_file_edit_routes_with_strings(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake(op, path, _content="", **kw):
        calls.append((op, path, kw.get("old_string"), kw.get("new_string"), kw.get("replace_all")))
        return {"rc": 0, "output": "（已编辑 a，替换 1 处。）"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    out = await fo._edit_handler(None, {"path": "a", "old_string": "x", "new_string": "y"})
    assert calls == [("edit", "a", "x", "y", False)] and "已编辑" in out


async def test_file_edit_replace_all_flag(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake(_op, _path, _content="", **kw):
        calls.append(kw.get("replace_all"))
        return {"rc": 0, "output": "ok"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    await fo._edit_handler(None, {"path": "a", "old_string": "x", "new_string": "y", "replace_all": True})
    assert calls == [True]


async def test_file_edit_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_PI_SANDBOX", raising=False)
    assert "未启用" in await fo._edit_handler(None, {"path": "a", "old_string": "x", "new_string": "y"})


async def test_file_op_timeout(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")

    async def fake(*_a, **_k):
        raise TimeoutError

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake)
    assert "无响应" in await fo._read_handler(None, {"path": "a"})


def test_channel_and_risk_flags():
    assert fo.FILE_LIST.private and fo.FILE_READ.private and fo.FILE_WRITE.private and fo.FILE_EDIT.private
    assert fo.FILE_LIST.risk == "readonly" and fo.FILE_READ.risk == "readonly"
    assert fo.FILE_WRITE.risk == "write" and fo.FILE_EDIT.risk == "write"
