"""反思 / evaluator-optimizer：评审判定 + 反思循环（假 LLM，不联网）。"""

import modules.agent.service as svc


class _FakeLLM:
    """按 verdicts 逐次返回评审文本；stream_step 逐字吐 revised 当改写正文。"""

    def __init__(self, verdicts, revised=""):
        self.verdicts = list(verdicts)
        self.revised = revised
        self.calls = 0

    async def complete(self, messages, *, tools=None, **_kw):
        v = self.verdicts[min(self.calls, len(self.verdicts) - 1)]
        self.calls += 1
        return {"content": v}

    async def stream_step(self, messages, *, tools=None, **_kw):
        for ch in self.revised:
            yield {"type": "content", "delta": ch}


async def test_evaluate_parses_pass(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _FakeLLM(["PASS"]))
    r = await svc.agent_service._evaluate("问题", "答案")
    assert r["verdict"] == "pass"


async def test_evaluate_parses_revise(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _FakeLLM(["REVISE\n- 少了复杂度分析"]))
    r = await svc.agent_service._evaluate("问题", "答案")
    assert r["verdict"] == "revise" and "复杂度" in r["text"]


async def test_reflect_pass_keeps_draft_no_revision(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _FakeLLM(["PASS"]))
    evs = [e async for e in svc.agent_service._reflect([], "问题", "草稿答案")]
    assert any(e["type"] == "reflect" and e["verdict"] == "pass" for e in evs)
    assert not any(e["type"] == "token" for e in evs)  # 过关 → 不改写
    final = next(e for e in evs if e["type"] == "final")
    assert final["content"] == "草稿答案"  # 存的是原稿


async def test_reflect_revise_then_pass_streams_revision(monkeypatch):
    # 第 1 轮 REVISE → 改写；第 2 轮 PASS → 收
    monkeypatch.setattr(svc, "chat_llm", _FakeLLM(["REVISE\n- 补充 X", "PASS"], revised="改进后的答案"))
    evs = [e async for e in svc.agent_service._reflect([], "问题", "初稿")]
    reflects = [e for e in evs if e["type"] == "reflect"]
    assert reflects[0]["verdict"] == "revise" and reflects[1]["verdict"] == "pass"
    assert "".join(e["delta"] for e in evs if e["type"] == "token") == "改进后的答案"  # 改写流式发出
    final = next(e for e in evs if e["type"] == "final")
    assert final["content"] == "改进后的答案"  # 存改写版


async def test_reflect_caps_rounds(monkeypatch):
    # 一直 REVISE：最多 MAX_REFLECT_ROUNDS 轮，不无限打磨
    monkeypatch.setattr(svc, "chat_llm", _FakeLLM(["REVISE\n- 还不行"], revised="x"))
    evs = [e async for e in svc.agent_service._reflect([], "问题", "初稿")]
    assert len([e for e in evs if e["type"] == "reflect"]) == svc.MAX_REFLECT_ROUNDS
