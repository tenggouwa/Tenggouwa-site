import base64

import pytest
from agent_harness import ScriptedLLM, run_agent, tokens
from modules.agent.attachments import AttachmentError, PreparedAttachment, prepare_attachments, user_content
from modules.agent.schema import AgentAttachment


def test_pdf_attachment_is_extracted_with_strict_budget(monkeypatch):
    class _Page:
        def extract_text(self):
            return "合同正文"

    class _Reader:
        pages = [_Page()]

    monkeypatch.setattr("modules.agent.attachments.PdfReader", lambda _stream: _Reader())
    attachment = AgentAttachment(
        name="contract.pdf", media_type="application/pdf", data=base64.b64encode(b"pdf").decode()
    )
    prepared = prepare_attachments([attachment], vision_enabled=False)
    assert prepared == [PreparedAttachment("contract.pdf", "application/pdf", text="合同正文")]
    assert "合同正文" in user_content("总结", prepared)


def test_image_attachment_requires_explicit_vision_provider():
    attachment = AgentAttachment(name="screen.png", media_type="image/png", data=base64.b64encode(b"png").decode())
    with pytest.raises(AttachmentError, match="vision provider"):
        prepare_attachments([attachment], vision_enabled=False)


async def test_image_attachment_uses_vision_model_for_this_request(monkeypatch):
    class _LLM(ScriptedLLM):
        def __init__(self):
            super().__init__([[{"type": "content", "delta": "已分析图片"}]])
            self.vision_values: list[bool] = []
            self.tool_values: list[object] = []

        async def stream_step(self, messages, *, vision=False, **kwargs):
            self.vision_values.append(vision)
            self.tool_values.append(kwargs.get("tools"))
            assert isinstance(messages[-1]["content"], list)
            async for event in super().stream_step(messages, **kwargs):
                yield event

    llm = _LLM()
    events, _ = await run_agent(
        monkeypatch,
        [],
        llm=llm,
        attachments=[PreparedAttachment("screen.png", "image/png", data_url="data:image/png;base64,cG5n")],
    )
    assert tokens(events) == "已分析图片"
    assert llm.vision_values == [True]
    assert llm.tool_values == [None]
