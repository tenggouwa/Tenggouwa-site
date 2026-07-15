"""web_search skill：给 agent 一个「找 URL」的能力，和 web_fetch 配成「搜→抓→综合」闭环。

走 Bing 网页搜索（无需 API key），解析出前若干条结果的标题 / 链接 / 摘要。
- 只读、无副作用（readonly）；公开通道即可用（和 web_fetch 一致）。
- **强制 IPv4**：生产机（阿里云）无 IPv6 路由、且对部分搜索引擎有 DNS 污染；这里自己把 www.bing.com 解析成
  IPv4 直连、但 SNI/Host 仍用真实域名（TLS 与证书照常校验）。DDG 在该网络不可达，故选 Bing。
- 目标是固定端点（非用户可控 host，无 SSRF 面）；返回的结果 URL 只是文本，模型要抓再走 web_fetch（那有 SSRF 校验）。
- 结果标题/摘要粗剥 HTML + 反转义实体；条数与摘要长度都有上限，别撑爆上下文。
"""

import base64
import html as htmllib
import re
import socket

import httpx

from .base import Skill

_HOST = "www.bing.com"
_MAX_RESULTS = 6
_SNIPPET_MAX = 280
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

_H2_A = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
_CAPTION = re.compile(r'<div class="b_caption"[^>]*>.*?<p[^>]*>(.*?)</p>', re.DOTALL | re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def _clean(fragment: str) -> str:
    return htmllib.unescape(_TAG.sub("", fragment)).strip()


def _real_url(href: str) -> str:
    """Bing 有时把结果链接包成 /ck/a?...&u=a1<base64(真实URL)>，能解就解，解不出用原样。"""
    if "bing.com/ck/a" not in href:
        return href
    m = re.search(r"[?&]u=a1([^&]+)", href)
    if not m:
        return href
    try:
        pad = m.group(1) + "=" * (-len(m.group(1)) % 4)
        return base64.urlsafe_b64decode(pad).decode("utf-8", errors="replace")
    except (ValueError, UnicodeError):
        return href


def _parse(body: str) -> list[dict]:
    out: list[dict] = []
    for blk in body.split('class="b_algo"')[1:]:  # 每个自然结果一块
        if len(out) >= _MAX_RESULTS:
            break
        m = _H2_A.search(blk)
        if not m:
            continue
        url = _real_url(m.group(1))
        if not url.startswith(("http://", "https://")):
            continue
        cap = _CAPTION.search(blk)
        snippet = _clean(cap.group(1)) if cap else ""
        out.append({"url": url, "title": _clean(m.group(2)), "snippet": snippet[:_SNIPPET_MAX]})
    return out


async def _handler(_session, args: dict) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        return "（未提供查询）"
    try:
        ipv4 = socket.getaddrinfo(_HOST, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    except OSError as e:
        return f"（搜索失败：无法解析 {_HOST}（{e.strerror or e}））"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=6.0), follow_redirects=True) as client:
            resp = await client.get(
                f"https://{ipv4}/search",
                params={"q": query},
                headers={"User-Agent": _UA, "Host": _HOST},
                extensions={"sni_hostname": _HOST},  # 直连 IPv4，但 TLS SNI/证书仍认 www.bing.com
            )
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
