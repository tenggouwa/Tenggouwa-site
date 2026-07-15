"""D1 端到端（无网络）：私有通道 → file_write → C2 审批 → 路由到 Pi 沙箱写文件。

文件工具现走 Pi 沙箱（file_ops → pi_exec.submit_file，实际 jail 写盘在 Pi 的 executor._run_file）。
这里 mock 掉 pi_exec.submit_file（无 Pi），验证「私有曝光 → write 触发审批暂停 → 批准续跑才调 Pi 写」整链。
"""

import modules.agent.service as svc
import modules.skills.file_ops as fo
from agent_harness import FakeRepo, ScriptedLLM, of_type, tokens, tool_call


async def test_private_file_write_full_chain(monkeypatch):
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake_submit_file(op, path, content, **_kw):
        calls.append((op, path, content))
        return {"rc": 0, "output": f"（已写入 {path}）"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake_submit_file)
    repo = FakeRepo()
    monkeypatch.setattr(svc, "AgentRepository", lambda _s: repo)
    monkeypatch.setattr(
        svc,
        "chat_llm",
        ScriptedLLM(
            [
                [
                    {"type": "content", "delta": "我来写文件"},
                    {
                        "type": "tool_calls",
                        "tool_calls": [tool_call("file_write", '{"path":"note.txt","content":"hi"}')],
                    },
                ],
                [{"type": "content", "delta": "写好了。"}],
            ]
        ),
    )
    # 不 mock skills_service —— tools()/invoke()/file_ops 全走真实现（file_ops 再路由到 mock 的 pi_exec）。

    # 第一轮（私有通道）：file_write 是 write+private → C2 暂停，尚未触达 Pi
    ev1 = [e async for e in svc.agent_service.answer_stream(None, "写个便签", privileged=True)]
    apps = of_type(ev1, "approval")
    assert len(apps) == 1 and apps[0]["requests"][0]["name"] == "file_write"
    tid = apps[0]["requests"][0]["id"]
    assert calls == []  # 暂停时绝不执行

    # 第二轮：批准 → 才调 Pi 沙箱写
    sid = ev1[0]["session_id"]
    ev2 = [
        e
        async for e in svc.agent_service.answer_stream(None, "", session_id=sid, approvals={tid: True}, privileged=True)
    ]
    assert calls == [("write", "note.txt", "hi")]  # 审批后才路由到 Pi
    assert "写好了" in tokens(ev2)


async def test_public_channel_cannot_file_write(monkeypatch):
    """公开通道即便模型幻觉调 file_write，也不暂停、不触达 Pi（invoke 纵深拒）。"""
    monkeypatch.setenv("AGENT_PI_SANDBOX", "1")
    calls: list = []

    async def fake_submit_file(op, path, content, **_kw):
        calls.append((op, path, content))
        return {"rc": 0, "output": "ok"}

    monkeypatch.setattr(fo.pi_exec, "submit_file", fake_submit_file)
    repo = FakeRepo()
    monkeypatch.setattr(svc, "AgentRepository", lambda _s: repo)
    monkeypatch.setattr(
        svc,
        "chat_llm",
        ScriptedLLM(
            [
                [{"type": "tool_calls", "tool_calls": [tool_call("file_write", '{"path":"x.txt","content":"y"}')]}],
                [{"type": "content", "delta": "好的"}],
            ]
        ),
    )
    ev = [e async for e in svc.agent_service.answer_stream(None, "写文件", privileged=False)]
    assert of_type(ev, "approval") == []  # 公开通道不暂停审批
    assert calls == []  # invoke 层拒执行，没触达 Pi
