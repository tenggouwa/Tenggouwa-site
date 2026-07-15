"""web_search skill：给 agent 一个「找 URL」的能力，和 web_fetch 配成「搜→抓→综合」闭环。

走 DuckDuckGo 的 HTML 端点（无需 API key），解析出前若干条结果的标题 / 链接 / 摘要。
- 只读、无副作用（readonly）；公开通道即可用（和 web_fetch 一致）。
- 只做一次固定端点的 GET（目标就是 DDG，非用户可控 host，无 SSRF 面）；返回的结果 URL 只是文本，
  模型要抓再走 web_fetch（那里有 SSRF 校验）。
- 结果标题/摘要粗剥 HTML + 反转义实体；条数与摘要长度都有上限，别撑爆上下文。
"""

import html as htmllib
import re
from urllib.parse import parse_qs, urlparse

import httpx

from .base import Skill

_ENDPOINT = "https://html.duckduckgo.com/html/"
_MAX_RESULTS = 6
_SNIPPET_MAX = 280
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

_RESULT_A = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
_SNIPPET = re.compile(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def _clean(fragment: str) -> str:
    return htmllib.unescape(_TAG.sub("", fragment)).strip()


def _real_url(href: str) -> str:
    """DDG 结果链接是 //duckduckgo.com/l/?uddg=<真实URL> 的跳转壳，解出真实 URL。"""
    if href.startswith("//"):
        href = "https:" + href
    q = parse_qs(urlparse(href).query).get("uddg")
    return q[0] if q else href


def _parse(body: str) -> list[dict]:
    links = _RESULT_A.findall(body)
    snippets = _SNIPPET.findall(body)
    out: list[dict] = []
    for i, (href, title) in enumerate(links[:_MAX_RESULTS]):
        snippet = _clean(snippets[i]) if i < len(snippets) else ""
        out.append({"url": _real_url(href), "title": _clean(title), "snippet": snippet[:_SNIPPET_MAX]})
    return out


async def _handler(_session, args: dict) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        return "（未提供查询）"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=True) as client:
            resp = await client.get(_ENDPOINT, params={"q": query, "kl": "wt-wt"}, headers={"User-Agent": _UA})
            resp.raise_for_status()
            body = resp.text
    except httpx.HTTPError as e:
        return f"（搜索失败：{e}）"
    results = _parse(body)
    if not results:
        return "（没搜到结果，换个关键词或改用 web_fetch 直接抓已知链接。）"
    # 给出可粘贴的 markdown 链接，模型综合时可直接回引来源。
    blocks = [f"[{i}] [{r['title']}]({r['url']})\n{r['snippet']}" for i, r in enumerate(results, 1)]
    return "\n\n".join(blocks)


WEB_SEARCH = Skill(
    name="web_search",
    description=(
        "用搜索引擎查公网，返回前若干条结果的标题、链接、摘要。当需要外部/实时信息又没有现成链接时先用它找，"
        "再用 web_fetch 抓某条链接的正文。只读。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索关键词或自然语言查询"},
        },
        "required": ["query"],
    },
    handler=_handler,
)
