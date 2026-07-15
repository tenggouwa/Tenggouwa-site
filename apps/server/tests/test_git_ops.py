"""git skill：门控 + 白名单子命令 + 路由到 Pi 沙箱（git <args>）。"""

import modules.skills.git_ops as g


async def test_git_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_PI_SANDBOX", raising=False)
    assert "未启用" in await g._handler(None, {"args": "status"})


async def test_git_routes_git_command(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls = []

    async def fake_submit(cmd, *, cwd, **_kw):
        calls.append((cmd, cwd))
        return {"rc": 0, "output": "On branch main"}

    monkeypatch.setattr(g.pi_exec, "submit", fake_submit)
    out = await g._handler(None, {"args": "log --oneline -5"})
    assert calls == [("git log --oneline -5", "workspace")]  # 前面自动补 git、在沙箱 workspace 跑
    assert "On branch main" in out and "[rc=0]" in out


async def test_git_rejects_non_whitelisted_subcommand(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")

    async def fake_submit(*_a, **_k):
        raise AssertionError("不该执行到 submit")

    monkeypatch.setattr(g.pi_exec, "submit", fake_submit)
    out = await g._handler(None, {"args": "daemon --export-all"})  # daemon 不在白名单
    assert "不支持的 git 子命令：daemon" in out


async def test_git_empty_args(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    assert "未提供 git 参数" in await g._handler(None, {"args": "  "})


async def test_git_timeout(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")

    async def fake_submit(*_a, **_k):
        raise TimeoutError

    monkeypatch.setattr(g.pi_exec, "submit", fake_submit)
    assert "无响应" in await g._handler(None, {"args": "status"})


def test_git_flags():
    assert g.GIT.private and g.GIT.risk == "write" and g.GIT.name == "git"
