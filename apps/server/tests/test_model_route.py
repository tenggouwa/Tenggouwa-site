"""模型路由分类器 _route_model：判 HARD→reasoner / SIMPLE→快模型，异常降级（不碰网/DB）。"""

from modules.agent import service as svc
from modules.agent.service import REASONER_MODEL, agent_service


class _LLM:
    def __init__(self, text=None, boom=False):
        self._text = text
        self._boom = boom

    async def complete(self, messages, *, tools=None, **kw):
        if self._boom:
            raise RuntimeError("classify 炸了")
        return {"content": self._text}


async def test_hard_routes_to_reasoner(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _LLM("HARD 需要多步推理"))
    model, reason = await agent_service._route_model("证明勾股定理")
    assert model == REASONER_MODEL
    assert "多步推理" in reason


async def test_simple_routes_to_fast(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _LLM("SIMPLE 常规问答"))
    model, reason = await agent_service._route_model("你好")
    assert model is None  # None = 走默认快模型
    assert "常规问答" in reason


async def test_classify_failure_degrades_to_fast(monkeypatch):
    monkeypatch.setattr(svc, "chat_llm", _LLM(boom=True))
    model, reason = await agent_service._route_model("随便问问")
    assert model is None  # 分类失败一律降级快模型，不抬成本
    assert "失败" in reason


async def test_garbled_output_defaults_fast(monkeypatch):
    # 模型没按格式回（既不 HARD 也不 SIMPLE 开头）→ 当简单，走快模型
    monkeypatch.setattr(svc, "chat_llm", _LLM("这个问题嘛……"))
    model, _ = await agent_service._route_model("x")
    assert model is None
