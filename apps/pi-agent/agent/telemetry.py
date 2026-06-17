"""采集树莓派系统遥测。

纯 stdlib（读 /proc、/sys、os.statvfs），跑在 Pi 的系统 python3 即可，零三方依赖。
返回的 dict 直接对齐后端 PiReport（hostname / model / metrics）。
"""

from __future__ import annotations

import os
import socket


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def model() -> str | None:
    raw = _read("/proc/device-tree/model") or _read("/sys/firmware/devicetree/base/model")
    return raw.replace("\x00", "").strip() if raw else None


def cpu_temp_c() -> float | None:
    raw = _read("/sys/class/thermal/thermal_zone0/temp")
    if raw and raw.strip().lstrip("-").isdigit():
        return round(int(raw.strip()) / 1000.0, 1)
    return None


def uptime_s() -> float | None:
    raw = _read("/proc/uptime")
    if not raw:
        return None
    try:
        return round(float(raw.split()[0]))
    except (ValueError, IndexError):
        return None


def mem_mb() -> tuple[int | None, int | None]:
    raw = _read("/proc/meminfo")
    if not raw:
        return None, None
    info: dict[str, int] = {}
    for line in raw.splitlines():
        key, _, rest = line.partition(":")
        kb = rest.strip().split()
        if kb and kb[0].isdigit():
            info[key] = int(kb[0])
    total = info.get("MemTotal")
    if total is None:
        return None, None
    avail = info.get("MemAvailable")
    used = total - avail if avail is not None else None
    return round(total / 1024), (round(used / 1024) if used is not None else None)


def disk_gb() -> tuple[float | None, float | None]:
    try:
        st = os.statvfs("/")
    except OSError:
        return None, None
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    return round(total / 1e9, 1), round((total - free) / 1e9, 1)


def collect() -> dict:
    metrics: dict[str, float] = {}

    def put(key: str, value: float | int | None) -> None:
        if value is not None:
            metrics[key] = value

    put("uptime_s", uptime_s())
    put("cpu_temp_c", cpu_temp_c())
    try:
        load1, load5, load15 = os.getloadavg()
        put("load1", round(load1, 2))
        put("load5", round(load5, 2))
        put("load15", round(load15, 2))
    except OSError:
        pass
    put("cpu_count", os.cpu_count())
    mem_total, mem_used = mem_mb()
    put("mem_total_mb", mem_total)
    put("mem_used_mb", mem_used)
    disk_total, disk_used = disk_gb()
    put("disk_total_gb", disk_total)
    put("disk_used_gb", disk_used)

    return {"hostname": socket.gethostname(), "model": model(), "metrics": metrics}
