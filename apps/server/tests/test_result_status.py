"""工具结果状态前缀：empty / error 两类打标签，模型一眼分清「查了没有」和「工具坏了」。

集成路径（handler 真的打上标签）由 test_kb_search_cite.test_kb_search_empty 覆盖；这里只锁约定本身。
"""

from modules.skills.results import empty, error


def test_prefixes_are_distinct_and_self_describing():
    assert empty("x") == "[无结果] x"
    assert error("x") == "[出错] x"
    assert empty("x") != error("x")


def test_prefix_only_prepends_keeps_core_message():
    # 前缀只前置、不吞原文——旧的子串断言（如「没有相关内容」「搜索失败」）不该被打破
    assert "没搜到" in empty("没搜到结果，换个关键词")
    assert "搜索失败" in error("搜索失败：连接超时")
