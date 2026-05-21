"""极简 UA 解析，覆盖个人博客 99% 流量。
依赖一个完整库不值得；正则就够用。"""

import re


def parse_ua(ua: str | None) -> tuple[str, str, bool]:
    """返回 (browser, os, is_mobile)。识别不出来一律 'Other'。"""
    if not ua:
        return "Other", "Other", False

    is_mobile = bool(re.search(r"Mobile|Android|iPhone|iPad|iPod", ua))

    # 顺序很重要：Edg/ 含 Chrome，要先判
    if "Edg/" in ua or "EdgA/" in ua:
        browser = "Edge"
    elif "OPR/" in ua or "Opera/" in ua:
        browser = "Opera"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Chrome/" in ua and "Safari/" in ua:
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = "Other"

    if "iPhone" in ua or "iPad" in ua or "iPod" in ua:
        os = "iOS"
    elif "Android" in ua:
        os = "Android"
    elif "Mac OS" in ua or "Macintosh" in ua:
        os = "macOS"
    elif "Windows" in ua:
        os = "Windows"
    elif "Linux" in ua:
        os = "Linux"
    else:
        os = "Other"

    return browser, os, is_mobile


BOT_PATTERN = re.compile(
    r"bot|crawl|spider|wget|curl|python-requests|httpx|insomnia|postman|facebookexternalhit",
    re.IGNORECASE,
)


def is_bot(ua: str | None) -> bool:
    return bool(ua and BOT_PATTERN.search(ua))
