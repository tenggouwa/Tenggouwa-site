"""Pi 沙箱 exec 传输：内存 broker rendezvous + 端点鉴权 + shell_exec skill 门控。"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from modules.pi.exec import PiExecBroker


async def test_submit_poll_deliver_roundtrip():
    b = PiExecBroker()

    async def pi_worker():
        cmd = await b.poll()
        assert cmd is not None and cmd["cmd"] == "echo hi" and cmd["cwd"] == "workspace"
        b.deliver(cmd["id"], {"id": cmd["id"], "rc": 0, "output": "hi", "truncated": False, "timed_out": False})

    task = asyncio.create_task(pi_worker())
    r = await b.submit("echo hi", cwd="workspace", timeout=5)
    assert r["rc"] == 0 and r["output"] == "hi"
    await task


async def test_submit_times_out_when_no_pi(monkeypatch):
    import modules.pi.exec as pe

    monkeypatch.setattr(pe, "_RESULT_GRACE", 0.02)
    b = pe.PiExecBroker()
    with pytest.raises(TimeoutError):
        await b.submit("sleep 100", cwd="workspace", timeout=0.02)


async def test_poll_returns_none_when_empty(monkeypatch):
    import modules.pi.exec as pe

    monkeypatch.setattr(pe, "_POLL_WAIT", 0.02)
    assert await pe.PiExecBroker().poll() is None


def test_deliver_unknown_id_is_false():
    assert PiExecBroker().deliver("nope", {"rc": 0}) is False


async def test_poll_drops_timed_out_command(monkeypatch):
    # 安全铁律：submit 超时的命令仍在队列，但 future 已没 → poll 丢弃、返回 None，绝不迟到执行
    import modules.pi.exec as pe

    monkeypatch.setattr(pe, "_RESULT_GRACE", 0.02)
    monkeypatch.setattr(pe, "_POLL_WAIT", 0.1)
    b = pe.PiExecBroker()
    with pytest.raises(TimeoutError):
        await b.submit("rm -rf ./x", cwd="workspace", timeout=0.02)
    assert await b.poll() is None  # 陈旧命令被丢弃，没投递出去


async def test_backlog_full_rejects(monkeypatch):
    import modules.pi.exec as pe

    monkeypatch.setattr(pe, "_MAX_QUEUE", 2)
    monkeypatch.setattr(pe, "_RESULT_GRACE", 0.05)
    b = pe.PiExecBroker()
    t1 = asyncio.create_task(b.submit("a", cwd="w", timeout=0.05))
    t2 = asyncio.create_task(b.submit("b", cwd="w", timeout=0.05))
    await asyncio.sleep(0.01)  # 让 t1/t2 入队占满
    with pytest.raises(pe.SandboxBusy):
        await b.submit("c", cwd="w", timeout=0.05)
    for t in (t1, t2):
        with pytest.raises(TimeoutError):
            await t


# ---------- 端点鉴权 ----------


def _pi_client() -> TestClient:
    from modules.pi.router import agent_router

    app = FastAPI()
    app.include_router(agent_router, prefix="/api")
    return TestClient(app)


def test_exec_poll_requires_pi_token(monkeypatch):
    import modules.pi.router as pr

    monkeypatch.setattr(pr.pi_service, "verify_token", lambda _t: False)
    assert _pi_client().get("/api/agent/pi/exec-poll").status_code == 401


def test_exec_poll_empty_returns_null(monkeypatch):
    import modules.pi.exec as pe
    import modules.pi.router as pr

    monkeypatch.setattr(pr.pi_service, "verify_token", lambda _t: True)
    monkeypatch.setattr(pe, "_POLL_WAIT", 0.02)
    r = _pi_client().get("/api/agent/pi/exec-poll", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200 and r.json()["data"]["command"] is None


def test_exec_result_needs_token_then_delivers(monkeypatch):
    import modules.pi.router as pr

    monkeypatch.setattr(pr.pi_service, "verify_token", lambda _t: False)
    body = {"id": "x", "rc": 0, "output": "", "truncated": False, "timed_out": False}
    assert _pi_client().post("/api/agent/pi/exec-result", json=body).status_code == 401

    monkeypatch.setattr(pr.pi_service, "verify_token", lambda _t: True)
    r = _pi_client().post("/api/agent/pi/exec-result", json=body)
    assert r.status_code == 200 and r.json()["data"]["ok"] is False  # 未知 id → deliver False


# ---------- shell_exec skill ----------


async def test_shell_exec_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AGENT_PI_SANDBOX", raising=False)
    from modules.skills.shell_exec import _handler

    assert "未启用" in await _handler(None, {"cmd": "ls"})


async def test_shell_exec_formats_result(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    import modules.skills.shell_exec as se

    async def fake_submit(_cmd, **_kw):
        return {"rc": 3, "output": "boom", "truncated": True, "timed_out": False}

    monkeypatch.setattr(se.pi_exec, "submit", fake_submit)
    out = await se._handler(None, {"cmd": "false"})
    assert "rc=3" in out and "已截断" in out and "boom" in out


def test_shell_exec_channel_and_risk():
    from modules.skills.shell_exec import SHELL_EXEC

    assert SHELL_EXEC.risk == "write" and SHELL_EXEC.private is True
