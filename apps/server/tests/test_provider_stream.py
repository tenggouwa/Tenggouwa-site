"""provider.stream_step SSE 解析 golden 测试（第 3 层，确定性、不联网）。

mock httpx 喂录制的 SSE 行给 stream_step，断言解析出的 content / tool_calls 事件。
覆盖真实 DeepSeek 会发的形态：正文分片、tool_calls 分片累积、末尾 usage-only chunk、｜ 原样透传。
"""

import json


class _FakeResp:
    def __init__(self, lines):
        self._lines = lines

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        pass


class _FakeClient:
    def __init__(self, lines):
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        pass

    def stream(self, *_a, **_kw):
        return _FakeResp(self._lines)


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}"


async def _collect(monkeypatch, lines):
    from modules.kb import provider

    monkeypatch.setattr(provider.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_kw: _FakeClient([*lines, "data: [DONE]"]))
    return [ev async for ev in provider.chat_llm.stream_step([{"role": "user", "content": "x"}], tools=[])]


async def test_stream_content_chunks(monkeypatch):
    lines = [
        _sse({"choices": [{"delta": {"content": "你好"}}]}),
        _sse({"choices": [{"delta": {"content": "世界"}}]}),
    ]
    events = await _collect(monkeypatch, lines)
    assert events == [
        {"type": "content", "delta": "你好"},
        {"type": "content", "delta": "世界"},
    ]


async def test_stream_toolcalls_fragmented(monkeypatch):
    # name 在首片，arguments 分三片，末尾一个 usage-only chunk（无 choices）
    lines = [
        _sse(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [{"index": 0, "id": "c1", "function": {"name": "kb_search", "arguments": ""}}]
                        }
                    }
                ]
            }
        ),
        _sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"que'}}]}}]}),
        _sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ry":"梅兰芳"}'}}]}}]}),
        _sse({"choices": [], "usage": {"prompt_tokens": 10, "prompt_cache_hit_tokens": 8}}),
    ]
    events = await _collect(monkeypatch, lines)
    assert events == [
        {
            "type": "tool_calls",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "kb_search", "arguments": '{"query":"梅兰芳"}'}}
            ],
        }
    ]


async def test_stream_parallel_toolcalls(monkeypatch):
    lines = [
        _sse(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "a", "function": {"name": "kb_search", "arguments": "{}"}}
                            ]
                        }
                    }
                ]
            }
        ),
        _sse(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 1, "id": "b", "function": {"name": "web_fetch", "arguments": "{}"}}
                            ]
                        }
                    }
                ]
            }
        ),
    ]
    events = await _collect(monkeypatch, lines)
    names = [tc["function"]["name"] for tc in events[0]["tool_calls"]]
    assert events[0]["type"] == "tool_calls" and names == ["kb_search", "web_fetch"]


async def test_stream_content_then_toolcalls(monkeypatch):
    # 先 preamble 正文，再 tool_calls（梅兰芳/抓X 那种一次返回 content+tool_calls）
    lines = [
        _sse({"choices": [{"delta": {"content": "好的我查一下。"}}]}),
        _sse(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "c1", "function": {"name": "kb_search", "arguments": "{}"}}
                            ]
                        }
                    }
                ]
            }
        ),
    ]
    events = await _collect(monkeypatch, lines)
    assert events[0] == {"type": "content", "delta": "好的我查一下。"}
    assert events[1]["type"] == "tool_calls"


async def test_stream_leak_content_passthrough(monkeypatch):
    # stream_step 只负责解析、原样透传 ｜；泄漏截断是 service 层的事（见 test_agent_loop 泄漏场景）
    lines = [_sse({"choices": [{"delta": {"content": "答案<｜｜DSML｜｜tool_calls>"}}]})]
    events = await _collect(monkeypatch, lines)
    assert events == [{"type": "content", "delta": "答案<｜｜DSML｜｜tool_calls>"}]


async def test_stream_ignores_malformed_lines(monkeypatch):
    lines = [
        "event: ping",  # 非 data 行，忽略
        "data: not-json",  # 坏 JSON，跳过
        _sse({"choices": [{"delta": {"content": "ok"}}]}),
    ]
    events = await _collect(monkeypatch, lines)
    assert events == [{"type": "content", "delta": "ok"}]
