"""KB 的 LLM 提供方：OpenAI 兼容 chat（默认 OpenRouter deepseek-v4-flash）。

env 配置，换供应商不改代码：
  KB_LLM_BASE_URL  默认 https://openrouter.ai/api/v1
  KB_LLM_API_KEY   （放 .env，勿提交）
  KB_LLM_MODEL     默认 deepseek/deepseek-v4-flash

v0 只用生成；嵌入暂缺（OpenRouter 无 embedding 模型，见 docs/kb-design.md §3）。
"""

import json
import logging
import os
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)


class ChatLLM:
    def __init__(self) -> None:
        self.base_url = (os.environ.get("KB_LLM_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
        self.api_key = os.environ.get("KB_LLM_API_KEY", "")
        self.model = os.environ.get("KB_LLM_MODEL") or "deepseek/deepseek-v4-flash"

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


chat_llm = ChatLLM()
