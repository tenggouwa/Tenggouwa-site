"""进程内尝试限流：挡 TOTP 解锁端点（/public/agent/unlock、/console/unlock）的暴破。

单容器部署，用内存 deque 即可（无 Redis）。两道闸：
- 每 IP 窗口内尝试数上限（挡单一来源狂试）；
- 全局窗口内尝试数上限（backstop：攻击者伪造 XFF 轮换 IP 时也拦得住）。
计数在校验前 hit（成功/失败都算），超限抛 429。IP 取 cloudflared 的 CF-Connecting-IP 为准。
"""

import time
from collections import defaultdict, deque

from dependencies import DetailedHTTPException
from fastapi import Request


def client_ip(request: Request) -> str:
    """真实客户端 IP：优先 cloudflared 注入的 CF-Connecting-IP（不可被客户端伪造），
    退回 X-Forwarded-For 首个，再退回 socket。"""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


class AttemptLimiter:
    def __init__(self, *, per_ip: int, ip_window: float, total: int, total_window: float) -> None:
        self._per_ip = per_ip
        self._ip_window = ip_window
        self._total = total
        self._total_window = total_window
        self._by_ip: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()

    def hit(self, key: str, *, now: float | None = None) -> None:
        """记一次尝试；超每 IP 或全局上限则抛 429。now 可注入便于测试。"""
        t = time.monotonic() if now is None else now
        ipq = self._by_ip[key]
        self._prune(ipq, t, self._ip_window)
        self._prune(self._all, t, self._total_window)
        if len(ipq) >= self._per_ip or len(self._all) >= self._total:
            raise DetailedHTTPException(429, "尝试过于频繁，请稍后再试", f"unlock rate limited: {key}")
        ipq.append(t)
        self._all.append(t)

    @staticmethod
    def _prune(q: deque[float], now: float, window: float) -> None:
        while q and now - q[0] > window:
            q.popleft()


# TOTP 解锁共用一把闸：每 IP 6 次/分钟；全局 20 次/分钟。合法用户偶尔手滑够用，暴破无门。
unlock_limiter = AttemptLimiter(per_ip=6, ip_window=60, total=20, total_window=60)
