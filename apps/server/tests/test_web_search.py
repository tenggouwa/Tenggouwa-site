"""web_search：Bing 结果解析 + /ck/a 跳转壳 URL 解码（纯函数，不联网）。"""

import base64

import modules.skills.web_search as ws

_SAMPLE = """
<li class="b_algo"><h2 class="">
  <a target="_blank" href="https://www.deepseek.com/" h="ID=SERP,1">Deep<strong>Seek</strong> 官网</a>
  </h2><div class="b_caption"><p class="b_lineclamp2">深度求索 &amp; 公司简介……</p></div></li>
<li class="b_algo"><h2 class="">
  <a href="https://github.com/deepseek-ai/DeepSeek-V3" h="ID=SERP,2">GitHub - DeepSeek-V3</a>
  </h2><div class="b_caption"><p>MoE 671B 模型</p></div></li>
"""


def test_parse_extracts_title_url_snippet():
    rows = ws._parse(_SAMPLE)
    assert len(rows) == 2
    assert rows[0] == {"url": "https://www.deepseek.com/", "title": "DeepSeek 官网", "snippet": "深度求索 & 公司简介……"}
    assert rows[1]["url"] == "https://github.com/deepseek-ai/DeepSeek-V3"


def test_parse_caps_results():
    many = '<li class="b_algo"><h2><a href="https://e.com/">t</a></h2></li>' * 20
    assert len(ws._parse(many)) == ws._MAX_RESULTS


def test_real_url_decodes_ck_redirect():
    real = "https://example.com/page?x=1"
    b64 = base64.urlsafe_b64encode(real.encode()).decode().rstrip("=")
    href = f"https://www.bing.com/ck/a?!&&p=abc&u=a1{b64}&ntb=1"
    assert ws._real_url(href) == real


def test_real_url_passthrough_direct():
    assert ws._real_url("https://direct.example/x") == "https://direct.example/x"


async def test_handler_empty_query():
    assert "未提供查询" in await ws._handler(None, {"query": "  "})


def test_registered_public_readonly():
    from modules.skills.registry import REGISTRY

    s = REGISTRY["web_search"]
    assert s.risk == "readonly" and not getattr(s, "private", False)  # 公开可用、无副作用
