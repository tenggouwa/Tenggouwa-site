"""web_search：DDG 结果解析 + 跳转壳 URL 解码（纯函数，不联网）。"""

import modules.skills.web_search as ws

_SAMPLE = """
<div class="result__body">
  <a rel="nofollow" class="result__a"
     href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=xx">标题 <b>一</b></a>
  <a class="result__snippet" href="...">这是 &amp; 第一条摘要</a>
</div>
<div class="result__body">
  <a rel="nofollow" class="result__a"
     href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffoo.org%2Fb">标题二</a>
  <a class="result__snippet" href="...">第二条摘要</a>
</div>
"""


def test_real_url_decodes_ddg_redirect():
    href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=xx"
    assert ws._real_url(href) == "https://example.com/a"


def test_real_url_passthrough_when_no_uddg():
    assert ws._real_url("https://direct.example/x") == "https://direct.example/x"


def test_parse_extracts_title_url_snippet():
    rows = ws._parse(_SAMPLE)
    assert len(rows) == 2
    assert rows[0] == {"url": "https://example.com/a", "title": "标题 一", "snippet": "这是 & 第一条摘要"}
    assert rows[1]["url"] == "https://foo.org/b" and rows[1]["title"] == "标题二"


async def test_handler_empty_query():
    assert "未提供查询" in await ws._handler(None, {"query": "  "})


def test_registered_public_readonly():
    from modules.skills.registry import REGISTRY

    s = REGISTRY["web_search"]
    assert s.risk == "readonly" and not getattr(s, "private", False)  # 公开可用、无副作用
