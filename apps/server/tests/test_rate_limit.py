"""TOTP 解锁限流：每 IP + 全局两道闸，窗口滑动。"""

import pytest
from common.rate_limit import AttemptLimiter
from dependencies import DetailedHTTPException


def test_per_ip_limit_blocks_after_max():
    lim = AttemptLimiter(per_ip=3, ip_window=60, total=100, total_window=60)
    for i in range(3):
        lim.hit("1.2.3.4", now=i)  # 前 3 次放行
    with pytest.raises(DetailedHTTPException) as e:
        lim.hit("1.2.3.4", now=3)
    assert e.value.status_code == 429


def test_window_slides_and_recovers():
    lim = AttemptLimiter(per_ip=2, ip_window=10, total=100, total_window=10)
    lim.hit("k", now=0)
    lim.hit("k", now=1)
    with pytest.raises(DetailedHTTPException):
        lim.hit("k", now=2)
    lim.hit("k", now=12)  # 旧的两次已滑出 10s 窗口 → 放行


def test_separate_ips_independent():
    lim = AttemptLimiter(per_ip=1, ip_window=60, total=100, total_window=60)
    lim.hit("a", now=0)
    lim.hit("b", now=0)  # 不同 IP 各自计数，互不影响
    with pytest.raises(DetailedHTTPException):
        lim.hit("a", now=0)


def test_global_backstop_across_ips():
    # 全局闸：即便攻击者轮换 IP（伪造 XFF），总量也被拦
    lim = AttemptLimiter(per_ip=100, ip_window=60, total=3, total_window=60)
    for i, ip in enumerate(["a", "b", "c"]):
        lim.hit(ip, now=i)
    with pytest.raises(DetailedHTTPException) as e:
        lim.hit("d", now=3)
    assert e.value.status_code == 429
