"""D1 端到端（无网络）：私有通道 → file_write → C2 审批 → 真落盘。

只脚本化模型大脑（chat_llm），skills_service.tools()/invoke() 和 file_ops 处理器都用真的，
验证「私有通道曝光 → write 触发审批暂停 → 批准续跑真写文件」整条链在一起工作。
"""

import modules.agent.service as svc
from agent_harness import FakeRepo, ScriptedLLM, of_type, tokens, tool_call


async def test_private_file_write_full_chain(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_WORKSPACE", str(tmp_path))
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
    # 注意：不 mock skills_service —— tools()/invoke()/file_ops 全走真实现。

    # 第一轮（私有通道）：file_write 是 write+private → C2 暂停，尚未落盘
    ev1 = [e async for e in svc.agent_service.answer_stream(None, "写个便签", privileged=True)]
    apps = of_type(ev1, "approval")
    assert len(apps) == 1 and apps[0]["requests"][0]["name"] == "file_write"
    tid = apps[0]["requests"][0]["id"]
    assert not (tmp_path / "note.txt").exists()  # 暂停时绝不执行

    # 第二轮：批准 → 真写入 workspace
    sid = ev1[0]["session_id"]
    ev2 = [
        e
        async for e in svc.agent_service.answer_stream(None, "", session_id=sid, approvals={tid: True}, privileged=True)
    ]
    assert (tmp_path / "note.txt").read_text() == "hi"  # 审批后真落盘
    assert "写好了" in tokens(ev2)


async def test_public_channel_cannot_file_write(tmp_path, monkeypatch):
    """公开通道即便模型幻觉调 file_write，也不暂停、不落盘（invoke 纵深拒）。"""
    monkeypatch.setenv("AGENT_WORKSPACE", str(tmp_path))
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
    assert not (tmp_path / "x.txt").exists()  # invoke 层拒执行，没落盘
