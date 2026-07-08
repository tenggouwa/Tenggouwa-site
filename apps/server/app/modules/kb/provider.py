"""KB 的 LLM 提供方：OpenAI 兼容 chat（默认直连 DeepSeek 官方 deepseek-chat）。

env 配置，换供应商不改代码：
  KB_LLM_BASE_URL  默认 https://api.deepseek.com
  KB_LLM_API_KEY   （放 .env，勿提交）
  KB_LLM_MODEL     默认 deepseek-chat（官方现已指向 deepseek-v4-flash）

v0 只用生成；嵌入暂缺（需另配专用嵌入端点，见 docs/kb-design.md §3）。
"""

import json
import logging
import os
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)


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
    ) -> AsyncIterator[str]:
        """流式生成，逐 token yield 文本增量。OpenAI 兼容 SSE。"""
        if not self.api_key:
            raise RuntimeError("KB_LLM_API_KEY 未配置")
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
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
                delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta

    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        tool_choice: str = "auto",
        max_tokens: int = 1024,
        temperature: float = 0.3,
    ) -> dict:
        """非流式，返回 choices[0].message（含 content / tool_calls）。M4 agent 的工具决策用。"""
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
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            return (resp.json().get("choices") or [{}])[0].get("message", {})


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
