"""KB 的 LLM 提供方：OpenAI 兼容 chat（默认直连 DeepSeek 官方 deepseek-chat）。

env 配置，换供应商不改代码：
  KB_LLM_BASE_URL  默认 https://api.deepseek.com
  KB_LLM_API_KEY   （放 .env，勿提交）
  KB_LLM_MODEL     默认 deepseek-chat（官方现已指向 deepseek-v4-flash）

v0 只用生成；嵌入暂缺（需另配专用嵌入端点，见 docs/agent/kb-design.md §3）。
"""

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)

# 瞬时错误重试（对齐 Codex responses_retry）：连接抖动 / 超时 / 5xx / 429 退避重试。
# 流式的坑：只在「首个事件到达前」失败可安全重试；已开始流式再断则不重发（避免重复输出）。
_RETRY_MAX = 3
_RETRY_TRANSPORT = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.ReadError,  # 硬 reset 常落这
    httpx.WriteError,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)


def _retriable_status(status: int) -> bool:
    return status == 429 or status >= 500


async def _backoff(attempt: int) -> None:
    await asyncio.sleep(0.5 * (2**attempt))  # 0.5s / 1s（最后一次 attempt 不 backoff、直接 raise）


def _merge_tool_call_deltas(acc: dict[int, dict], deltas: list[dict]) -> None:
    """把流式 delta.tool_calls 分片按 index 累积进 acc：id/name 覆盖赋值、arguments 追加拼接。"""
    for tc in deltas:
        idx = tc.get("index", 0)
        slot = acc.setdefault(idx, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
        if tc.get("id"):
            slot["id"] = tc["id"]
        fn = tc.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] = fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] += fn["arguments"]


def _log_cache(where: str, usage: dict | None) -> None:
    """打 DeepSeek 上下文缓存命中，验证 prefix 稳定性（见 docs/agent/agent-v2-design.md §2）。

    多轮对话里 hit 应随历史增长而上升；若长期为 0，说明消息前缀（system + tools）
    被变动内容污染，缓存全 miss。命中不影响功能，只影响成本，故只记日志。
    """
    if not usage:
        return
    hit = usage.get("prompt_cache_hit_tokens")
    miss = usage.get("prompt_cache_miss_tokens")
    if hit is not None or miss is not None:
        logger.info("llm cache %s: hit=%s miss=%s", where, hit, miss)


class ChatLLM:
    def __init__(self) -> None:
        self.base_url = (os.environ.get("KB_LLM_BASE_URL") or "https://api.deepseek.com").rstrip("/")
        self.api_key = os.environ.get("KB_LLM_API_KEY", "")
        self.model = os.environ.get("KB_LLM_MODEL") or "deepseek-chat"

    async def stream(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 1024,
        temperature: float = 0.3,
        tools: list[dict] | None = None,
        tool_choice: str | None = None,
    ) -> AsyncIterator[str]:
        """流式生成，逐 token yield 文本增量。OpenAI 兼容 SSE。

        agent 最终作答传 tools + tool_choice="none"：显式禁止本轮调工具，否则 DeepSeek 会被
        前文的工具调用带跑偏、把 tool-call 语法当普通文本吐出来（污染排版 + 吃光 token 致截断）。
        """
        if not self.api_key:
            raise RuntimeError("KB_LLM_API_KEY 未配置")
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},  # 末尾 chunk 带 usage，用于打缓存命中
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools is not None and tool_choice is not None:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(120.0, connect=10.0)
        url = f"{self.base_url}/chat/completions"
        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream("POST", url, headers=headers, json=payload) as resp,
        ):
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                _log_cache("stream", obj.get("usage"))  # include_usage：usage 在无 choices 的末尾 chunk
                delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta

    async def stream_step(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        model: str | None = None,
    ) -> AsyncIterator[dict]:
        """流式跑一轮：实时 yield 正文增量，并把结构化 tool_calls 累积到最后一并 yield。

        事件：{"type":"content","delta": str} / {"type":"reasoning","delta": str}（reasoner 思维链）
        / {"type":"tool_calls","tool_calls": [...]}。
        tools 一直带着（tool_choice=auto）——模型走结构化 delta.tool_calls，不会把工具调用吐成文本。
        model 传入覆盖默认模型（深度思考模式用 deepseek-reasoner）。
        瞬时错误只在「首个事件到达前」重试；已开始流式再断则透传（避免重复输出）。
        """
        if not self.api_key:
            raise RuntimeError("KB_LLM_API_KEY 未配置")
        payload: dict = {
            "model": model or self.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        for attempt in range(_RETRY_MAX):
            yielded = False
            try:
                async for ev in self._stream_step_once(payload):
                    yielded = True
                    yield ev
                return
            except _RETRY_TRANSPORT as e:
                if yielded or attempt == _RETRY_MAX - 1:
                    raise
                logger.warning("stream_step 连接失败重试 %d/%d: %s", attempt + 1, _RETRY_MAX, e)
                await _backoff(attempt)
            except httpx.HTTPStatusError as e:
                if yielded or attempt == _RETRY_MAX - 1 or not _retriable_status(e.response.status_code):
                    raise
                logger.warning("stream_step %d 重试 %d/%d", e.response.status_code, attempt + 1, _RETRY_MAX)
                await _backoff(attempt)

    async def _stream_step_once(self, payload: dict) -> AsyncIterator[dict]:
        """单次流式请求（不含重试）。stream_step 的重试包装调用它。"""
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(120.0, connect=10.0)
        url = f"{self.base_url}/chat/completions"
        acc: dict[int, dict] = {}  # index -> {id, type, function:{name, arguments}}
        usage: dict | None = None
        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream("POST", url, headers=headers, json=payload) as resp,
        ):
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if obj.get("usage"):
                    usage = obj["usage"]  # include_usage：usage 在无 choices 的末尾 chunk
                    _log_cache("stream_step", usage)
                choice = (obj.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                if delta.get("reasoning_content"):  # reasoner 思维链，前端单独展示、不进正文
                    yield {"type": "reasoning", "delta": delta["reasoning_content"]}
                if delta.get("content"):
                    yield {"type": "content", "delta": delta["content"]}
                _merge_tool_call_deltas(acc, delta.get("tool_calls") or [])
        if acc:
            yield {"type": "tool_calls", "tool_calls": [acc[i] for i in sorted(acc)]}
        if usage:
            yield {"type": "usage", "usage": usage}

    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        tool_choice: str | dict = "auto",
        max_tokens: int = 1024,
        temperature: float = 0.3,
    ) -> dict:
        """非流式，返回 choices[0].message（含 content / tool_calls）。M4 agent 的工具决策用。

        tool_choice 除 "auto"/"none" 外也可传 {"type":"function","function":{"name":...}} 强制指定函数，
        用来把模型输出钉成结构化 JSON（概念图谱抽取就靠这个）。
        """
        if not self.api_key:
            raise RuntimeError("KB_LLM_API_KEY 未配置")
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        url = f"{self.base_url}/chat/completions"
        for attempt in range(_RETRY_MAX):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
                    resp = await client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    body = resp.json()
                    _log_cache("complete", body.get("usage"))
                    return (body.get("choices") or [{}])[0].get("message", {})
            except _RETRY_TRANSPORT as e:
                if attempt == _RETRY_MAX - 1:
                    raise
                logger.warning("complete 连接失败重试 %d/%d: %s", attempt + 1, _RETRY_MAX, e)
                await _backoff(attempt)
            except httpx.HTTPStatusError as e:
                if attempt == _RETRY_MAX - 1 or not _retriable_status(e.response.status_code):
                    raise
                logger.warning("complete %d 重试 %d/%d", e.response.status_code, attempt + 1, _RETRY_MAX)
                await _backoff(attempt)
        raise RuntimeError("complete 重试耗尽")  # 不可达（最后一次要么 return 要么 raise）


chat_llm = ChatLLM()


class Embedder:
    """OpenAI 兼容嵌入（默认 OpenRouter baai/bge-m3，1024 维）。

    env：KB_EMBED_BASE_URL / KB_EMBED_API_KEY / KB_EMBED_MODEL。
    未配 key 时 configured=False，检索/灌库自动降级到纯 pg_trgm。
    """

    def __init__(self) -> None:
        self.base_url = (os.environ.get("KB_EMBED_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
        self.api_key = os.environ.get("KB_EMBED_API_KEY", "")
        self.model = os.environ.get("KB_EMBED_MODEL") or "baai/bge-m3"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def embed(self, texts: list[str], *, batch: int = 64) -> list[list[float]]:
        """批量嵌入，分批发送。texts 空则返回 []。"""
        if not self.configured:
            raise RuntimeError("KB_EMBED_API_KEY 未配置")
        if not texts:
            return []
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        out: list[list[float]] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            for start in range(0, len(texts), batch):
                part = texts[start : start + batch]
                resp = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=headers,
                    json={"model": self.model, "input": part},
                )
                resp.raise_for_status()
                data = resp.json().get("data", [])
                data.sort(key=lambda d: d.get("index", 0))
                out.extend(d["embedding"] for d in data)
        return out

    async def embed_one(self, text: str) -> list[float]:
        vecs = await self.embed([text])
        return vecs[0]


embedder = Embedder()
