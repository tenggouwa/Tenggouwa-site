"""MCP 桥接纯函数测试（第 1 层，确定性、无 SDK/网络）。"""

from types import SimpleNamespace

from modules.mcp.bridge import content_to_text, mcp_tool_to_openai, openai_tool_name


def test_openai_tool_name_namespaced_and_sanitized():
    assert openai_tool_name("fs", "read_file") == "fs__read_file"
    # 非法字符替成 _
    assert openai_tool_name("my server", "a.b/c") == "my_server__a_b_c"


def test_openai_tool_name_truncated_to_64():
    name = openai_tool_name("s", "x" * 100)
    assert len(name) == 64


def test_mcp_tool_to_openai_strips_nonstandard_keys():
    schema = {"type": "object", "properties": {"p": {"type": "string"}}, "$schema": "...", "default": {}}
    out = mcp_tool_to_openai("fs", "read_file", "读文件", schema)
    assert out == {
        "type": "function",
        "function": {
            "name": "fs__read_file",
            "description": "读文件",
            "parameters": {"type": "object", "properties": {"p": {"type": "string"}}},
        },
    }


def test_mcp_tool_to_openai_none_schema():
    out = mcp_tool_to_openai("fs", "t", "", None)
    assert out["function"]["parameters"] == {"type": "object", "properties": {}}


def _text(t):
    return SimpleNamespace(type="text", text=t)


def test_content_to_text_joins_text_blocks():
    assert content_to_text([_text("你好"), _text("世界")]) == "你好\n世界"


def test_content_to_text_structured_wins():
    assert content_to_text([_text("忽略")], structured={"a": 1}) == '{"a": 1}'


def test_content_to_text_error_prefix():
    assert content_to_text([_text("boom")], is_error=True) == "[tool error] boom"


def test_content_to_text_omits_binary_keeps_resource():
    blocks = [
        SimpleNamespace(type="image"),
        _text("正文"),
        SimpleNamespace(type="resource", resource=SimpleNamespace(text="资源内容")),
        SimpleNamespace(type="resource_link", uri="http://x"),
    ]
    out = content_to_text(blocks)
    assert "image 内容已省略" in out
    assert "正文" in out
    assert "资源内容" in out
    assert "[link http://x]" in out


def test_content_to_text_empty():
    assert content_to_text([]) == ""
    assert content_to_text(None) == ""
