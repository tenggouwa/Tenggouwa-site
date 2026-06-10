"""seo/service.py 的纯辅助函数测试：天数 clamp 与访客哈希。"""

import pytest
from modules.seo.service import _clamp_days, _visitor_hash


@pytest.mark.parametrize(
    "days,expected",
    [(-5, 1), (0, 1), (1, 1), (30, 30), (365, 365), (366, 365), (10000, 365)],
)
def test_clamp_days(days, expected):
    assert _clamp_days(days) == expected


def test_visitor_hash_shape():
    h = _visitor_hash("1.2.3.4", "Mozilla/5.0")
    assert len(h) == 32
    assert all(c in "0123456789abcdef" for c in h)


def test_visitor_hash_stable_for_same_input():
    a = _visitor_hash("1.2.3.4", "Mozilla/5.0")
    b = _visitor_hash("1.2.3.4", "Mozilla/5.0")
    assert a == b


def test_visitor_hash_differs_by_ip_and_ua():
    base = _visitor_hash("1.2.3.4", "UA-A")
    assert base != _visitor_hash("5.6.7.8", "UA-A")
    assert base != _visitor_hash("1.2.3.4", "UA-B")


@pytest.mark.parametrize("ip,ua", [(None, None), ("1.2.3.4", None), (None, "UA")])
def test_visitor_hash_handles_none(ip, ua):
    h = _visitor_hash(ip, ua)
    assert len(h) == 32
