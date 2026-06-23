"""监控探针：从树莓派的视角探测你的服务可用性/延迟 + 下行吞吐。

纯 stdlib（urllib + time），跟遥测走同一条代理路。每轮返回一组测量，
直接对齐后端 PiProbeReport（name / ok / value / unit）。
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request

UA = "tenggouwa-pi-agent/probe"

# HTTP 可用性/延迟目标：(name, url)
HTTP_TARGETS = [
    ("api", "https://api.tenggouwa.com/health/check"),
    ("site", "https://tenggouwa.com/"),
]
# Cloudflare 的测速端点，下 2MB 算吞吐
SPEED_URL = "https://speed.cloudflare.com/__down?bytes=2000000"


def _check_http(name: str, url: str, timeout: float = 10.0) -> dict:
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            r.read(64)
            status = r.status
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": name, "ok": 200 <= status < 400, "value": ms, "unit": "ms"}
    except urllib.error.HTTPError:
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"name": name, "ok": False, "value": ms, "unit": "ms"}
    except (urllib.error.URLError, OSError):
        return {"name": name, "ok": False, "value": None, "unit": "ms"}


def _check_speed(timeout: float = 25.0) -> dict:
    req = urllib.request.Request(SPEED_URL, method="GET")
    req.add_header("User-Agent", UA)
    try:
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            n = len(r.read())
        dt = time.perf_counter() - t0
        mbps = round(n / dt / 1e6, 2) if dt > 0 else None
        return {"name": "speed", "ok": n > 0, "value": mbps, "unit": "MB/s"}
    except (urllib.error.URLError, OSError):
        return {"name": "speed", "ok": False, "value": None, "unit": "MB/s"}


def run() -> list[dict]:
    results = [_check_http(name, url) for name, url in HTTP_TARGETS]
    results.append(_check_speed())
    return results
