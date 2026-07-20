"""web_fetch skill：抓一个公网 URL 的正文，供 agent 补充知识库之外的信息。

安全红线（见 docs/agent/agent-v2-design.md §6，抄 Codex exec_command 的截断 + execpolicy 判定思路）：
- 只读、仅 http/https；
- SSRF 防护：解析主机 IP，拒绝环回 / 私网 / 保留段（防打内网服务）；
- 不跟随重定向（跟随会绕过上面的 IP 校验）；
- 响应大小上限 + 超时；粗剥 HTML 标签后截断返回。
"""

import ipaddress
import re
import socket
from urllib.parse import urlparse, urlunsplit

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from .base import Skill
from .results import empty, error

_MAX_BYTES = 200_000  # 读取上限，超出截断
_MAX_CHARS = 8_000  # 回给 LLM 的正文上限（对齐 Codex 工具输出截断）
_TAG_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_ANY_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\n{3,}")


def _public_ips(host: str) -> list[str]:
    """Resolve once and return public IPs only; an empty list means reject."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return []
    ips: list[str] = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return []
        value = str(ip)
        if value not in ips:
            ips.append(value)
    return sorted(ips, key=lambda value: ipaddress.ip_address(value).version)  # IPv4 first; prod has no IPv6 route


def _host_is_public(host: str) -> bool:
    """Compatibility helper used by tests and diagnostics."""
    return bool(_public_ips(host))


def _pinned_url(parsed, ip: str) -> str:
    """Build a URL that connects to the already-validated IP, avoiding a second DNS lookup."""
    address = f"[{ip}]" if ":" in ip else ip
    netloc = f"{address}:{parsed.port}" if parsed.port else address
    return urlunsplit((parsed.scheme, netloc, parsed.path or "/", parsed.query, ""))


def _to_text(body: str) -> str:
    body = _TAG_RE.sub(" ", body)
    body = _ANY_TAG.sub(" ", body)
    body = _WS.sub("\n\n", body).strip()
    return body[:_MAX_CHARS]


async def _handler(_session: AsyncSession, args: dict) -> str:
    url = str(args.get("url", "")).strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "（只支持 http/https URL）"
    ips = _public_ips(parsed.hostname)
    if not ips:
        return "（拒绝：目标不是公网地址）"
    host_header = parsed.hostname
    if parsed.port:
        host_header = f"{host_header}:{parsed.port}"
    target = _pinned_url(parsed, ips[0])
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False) as client:
            resp = await client.get(
                target,
                headers={"User-Agent": "tenggouwa-agent/1.0", "Host": host_header},
                extensions={"sni_hostname": parsed.hostname},
            )
            if resp.is_redirect:
                return f"（目标发生重定向到 {resp.headers.get('location', '?')}，未跟随）"
            resp.raise_for_status()
            raw = resp.content[:_MAX_BYTES].decode(resp.encoding or "utf-8", errors="replace")
    except httpx.HTTPError as e:
        return error(f"抓取失败：{e}")
    text = _to_text(raw)
    return text or empty("页面无可读正文。")


WEB_FETCH = Skill(
    name="web_fetch",
    description=(
        "抓取一个公网 URL 的正文文本。当用户给了链接、或需要知识库之外的实时/外部信息时使用。只读、只支持 http/https。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "要抓取的完整 URL（http/https）"},
        },
        "required": ["url"],
    },
    handler=_handler,
    parallel_safe=True,
)
