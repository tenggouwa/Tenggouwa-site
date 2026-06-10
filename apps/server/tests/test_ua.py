"""analytics/ua.py 的 UA 解析与 bot 检测测试（纯正则逻辑）。"""

import pytest
from modules.analytics.ua import is_bot, parse_ua

CHROME_WIN = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
EDGE_WIN = CHROME_WIN + " Edg/120.0.0.0"
FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
SAFARI_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
CHROME_ANDROID = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
)
OPERA_WIN = CHROME_WIN + " OPR/106.0.0.0"


@pytest.mark.parametrize(
    "ua,expected",
    [
        (CHROME_WIN, ("Chrome", "Windows", False)),
        (EDGE_WIN, ("Edge", "Windows", False)),  # Edg/ 含 Chrome，必须先判
        (FIREFOX_LINUX, ("Firefox", "Linux", False)),
        (SAFARI_MAC, ("Safari", "macOS", False)),
        (SAFARI_IPHONE, ("Safari", "iOS", True)),
        (CHROME_ANDROID, ("Chrome", "Android", True)),
        (OPERA_WIN, ("Opera", "Windows", False)),
    ],
)
def test_parse_ua(ua, expected):
    assert parse_ua(ua) == expected


@pytest.mark.parametrize("ua", [None, ""])
def test_parse_ua_empty(ua):
    assert parse_ua(ua) == ("Other", "Other", False)


def test_parse_ua_unknown():
    assert parse_ua("SomeRandomClient/1.0") == ("Other", "Other", False)


@pytest.mark.parametrize(
    "ua",
    [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "facebookexternalhit/1.1",
        "curl/8.4.0",
        "python-requests/2.31.0",
        "Mozilla/5.0 ... bingbot/2.0",
    ],
)
def test_is_bot_true(ua):
    assert is_bot(ua) is True


@pytest.mark.parametrize("ua", [None, "", CHROME_WIN, SAFARI_IPHONE])
def test_is_bot_false(ua):
    assert is_bot(ua) is False
