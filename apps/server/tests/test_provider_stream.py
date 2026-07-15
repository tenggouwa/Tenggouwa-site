"""provider.stream_step SSE 解析 golden 测试（第 3 层，确定性、不联网）。

mock httpx 喂录制的 SSE 行给 stream_step，断言解析出的 content / tool_calls 事件。
覆盖真实 DeepSeek 会发的形态：正文分片、tool_calls 分片累积、末尾 usage-only chunk、｜ 原样透传。
"""

import json

import httpx
import pytest


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


async def test_stream_reasoning_deltas(monkeypatch):
    # reasoner：reasoning_content 先于 content，解析成独立 reasoning 事件
    lines = [
        _sse({"choices": [{"delta": {"reasoning_content": "先想想"}}]}),
        _sse({"choices": [{"delta": {"content": "答案"}}]}),
    ]
    events = await _collect(monkeypatch, lines)
    assert events == [
        {"type": "reasoning", "delta": "先想想"},
        {"type": "content", "delta": "答案"},
    ]


async def test_stream_model_override_in_payload(monkeypatch):
    from modules.kb import provider

    captured: dict = {}

    class _CapClient(_FakeClient):
        def stream(self, _method, _url, *, headers=None, json=None):  # noqa: A002
            captured.update(json or {})
            return _FakeResp(self._lines)

    monkeypatch.setattr(provider.chat_llm, "api_key", "test-key")
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_kw: _CapClient(["data: [DONE]"]))
    async for _ in provider.chat_llm.stream_step([{"role": "user", "content": "x"}], model="deepseek-reasoner"):
        pass
    assert captured["model"] == "deepseek-reasoner"


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
        },
        {"type": "usage", "usage": {"prompt_tokens": 10, "prompt_cache_hit_tokens": 8}},
    ]


async def test_stream_yields_usage_event(monkeypatch):
    # include_usage：末尾 usage-only chunk（无 choices）→ 末尾 yield 一个 usage 事件
    lines = [
        _sse({"choices": [{"delta": {"content": "hi"}}]}),
        _sse({"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 3}}),
    ]
    events = await _collect(monkeypatch, lines)
    assert events == [
        {"type": "content", "delta": "hi"},
        {"type": "usage", "usage": {"prompt_tokens": 5, "completion_tokens": 3}},
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


# ---------- A1 瞬时错误重试 ----------


async def _anoop(_attempt):  # 免真 sleep
    pass


def _req():
    return httpx.Request("POST", "http://x/chat/completions")


class _StreamAttempt:
    """一次流式尝试：connect_fail→__aenter__ 抛 ConnectError；status→raise_for_status 抛；
    否则吐 lines；mid_fail→吐一行后在 aiter_lines 抛（模拟流式中途断）。"""

    def __init__(self, *, connect_fail=False, status=None, lines=None, mid_fail=False):
        self._connect_fail = connect_fail
        self._status = status
        self._lines = lines or []
        self._mid_fail = mid_fail

    def raise_for_status(self):
        if self._status is not None:
            raise httpx.HTTPStatusError("e", request=_req(), response=httpx.Response(self._status, request=_req()))

    async def aiter_lines(self):
        for line in self._lines:
            yield line
        if self._mid_fail:
            raise httpx.RemoteProtocolError("dropped mid-stream", request=_req())

    async def __aenter__(self):
        if self._connect_fail:
            raise httpx.ConnectError("boom")
        return self

    async def __aexit__(self, *_a):
        pass


class _SeqStreamClient:
    def __init__(self, counter, attempts):
        self._c = counter
        self._attempts = attempts

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        pass

    def stream(self, *_a, **_kw):
        i = self._c[0]
        self._c[0] += 1
        return self._attempts[min(i, len(self._attempts) - 1)]


def _install_stream(monkeypatch, attempts):
    from modules.kb import provider

    monkeypatch.setattr(provider.chat_llm, "api_key", "k")
    monkeypatch.setattr(provider, "_backoff", _anoop)
    counter = [0]
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_kw: _SeqStreamClient(counter, attempts))
    return provider, counter


async def _run_stream(provider):
    return [ev async for ev in provider.chat_llm.stream_step([{"role": "user", "content": "x"}], tools=[])]


_OK = [_sse({"choices": [{"delta": {"content": "ok"}}]})]


async def test_stream_retries_connect_then_succeeds(monkeypatch):
    provider, c = _install_stream(monkeypatch, [_StreamAttempt(connect_fail=True), _StreamAttempt(lines=_OK)])
    assert await _run_stream(provider) == [{"type": "content", "delta": "ok"}]
    assert c[0] == 2  # 首次失败、重试第二次成功


async def test_stream_retries_5xx_then_succeeds(monkeypatch):
    provider, c = _install_stream(monkeypatch, [_StreamAttempt(status=503), _StreamAttempt(lines=_OK)])
    assert await _run_stream(provider) == [{"type": "content", "delta": "ok"}]
    assert c[0] == 2


async def test_stream_no_retry_on_4xx(monkeypatch):
    provider, c = _install_stream(monkeypatch, [_StreamAttempt(status=400)])
    with pytest.raises(httpx.HTTPStatusError):
        await _run_stream(provider)
    assert c[0] == 1  # 4xx 不重试


async def test_stream_midstream_error_propagates_no_retry(monkeypatch):
    # 已开始流式再断 → 透传、不重发（防重复输出）
    provider, c = _install_stream(monkeypatch, [_StreamAttempt(lines=_OK, mid_fail=True)])
    with pytest.raises(httpx.RemoteProtocolError):
        await _run_stream(provider)
    assert c[0] == 1


async def test_stream_retry_exhausted_raises(monkeypatch):
    provider, _ = _install_stream(monkeypatch, [_StreamAttempt(connect_fail=True)])  # 每次都失败
    with pytest.raises(httpx.ConnectError):
        await _run_stream(provider)


# ---------- A1 complete 重试 ----------


class _SeqPostClient:
    def __init__(self, counter, attempts):
        self._c = counter
        self._attempts = attempts

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        pass

    async def post(self, *_a, **_kw):
        i = self._c[0]
        self._c[0] += 1
        a = self._attempts[min(i, len(self._attempts) - 1)]
        if a == "connect":
            raise httpx.ConnectError("boom")
        status = a if isinstance(a, int) else 200
        body = {"choices": [{"message": {"content": "ok"}}]}
        return httpx.Response(status, json=body, request=_req())


def _install_post(monkeypatch, attempts):
    from modules.kb import provider

    monkeypatch.setattr(provider.chat_llm, "api_key", "k")
    monkeypatch.setattr(provider, "_backoff", _anoop)
    counter = [0]
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_kw: _SeqPostClient(counter, attempts))
    return provider, counter


async def test_complete_retries_then_succeeds(monkeypatch):
    provider, c = _install_post(monkeypatch, ["connect", 429, "ok"])
    msg = await provider.chat_llm.complete([{"role": "user", "content": "x"}])
    assert msg == {"content": "ok"}
    assert c[0] == 3  # connect 失败 + 429 + 成功


async def test_complete_no_retry_on_4xx(monkeypatch):
    provider, c = _install_post(monkeypatch, [400])
    with pytest.raises(httpx.HTTPStatusError):
        await provider.chat_llm.complete([{"role": "user", "content": "x"}])
    assert c[0] == 1
