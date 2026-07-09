"""MCP ↔ OpenAI function-calling 桥接（纯函数，无 SDK 依赖，好测）。

把 MCP server 的 tool（name + description + inputSchema）转成 agent 用的 OpenAI tool 定义，
把 call_tool 的结果 content blocks 转成回灌给 LLM 的字符串。见 docs/agent/agent-roadmap.md B2。
"""

import json
import re

_NAME_BAD = re.compile(r"[^a-zA-Z0-9_-]")


def _sanitize(s: str) -> str:
    return _NAME_BAD.sub("_", s)


def openai_tool_name(server: str, tool: str) -> str:
    """<server>__<tool>，sanitize 到 ^[a-zA-Z0-9_-]+$、≤64 字（OpenAI/DeepSeek function name 限制）。"""
    return f"{_sanitize(server)}__{_sanitize(tool)}"[:64]


def mcp_tool_to_openai(server: str, tool_name: str, description: str, input_schema: dict | None) -> dict:
    """MCP tool → OpenAI function 定义。inputSchema 本就是 JSON Schema，剥掉易触发 400 的非标准键。"""
    schema = dict(input_schema or {"type": "object", "properties": {}})
    schema.pop("$schema", None)
    schema.pop("default", None)
    return {
        "type": "function",
        "function": {
            "name": openai_tool_name(server, tool_name),
            "description": description or "",
            "parameters": schema,
        },
    }


def content_to_text(content: list, *, is_error: bool = False, structured: object | None = None) -> str:
    """call_tool 结果 → 回灌 LLM 的字符串。优先 structuredContent，否则拼 text block。

    二进制（image/audio）不塞进文本上下文；isError 加前缀让模型知道调用失败。
    content block 是 pydantic 模型，用 getattr 兼容。
    """
    if structured is not None:
        return json.dumps(structured, ensure_ascii=False)
    parts: list[str] = []
    for block in content or []:
        btype = getattr(block, "type", None)
        if btype == "text":
            parts.append(getattr(block, "text", "") or "")
        elif btype in ("image", "audio"):
            parts.append(f"[{btype} 内容已省略]")
        elif btype == "resource":
            res = getattr(block, "resource", None)
            parts.append(getattr(res, "text", None) or f"[resource {getattr(res, 'uri', '?')}]")
        elif btype == "resource_link":
            parts.append(f"[link {getattr(block, 'uri', '?')}]")
    text = "\n".join(p for p in parts if p)
    return f"[tool error] {text}" if is_error else text
