"""每日产物：树莓派自己算一张 ASCII 曼德博集合。

纯 stdlib。参数（看哪个区域）随日期变，每天不一样；附带本机真实渲染耗时，
就是"这图是我房间的 Pi 算的"那块徽章的底气。
"""

from __future__ import annotations

import socket
import time

# 曼德博集合里几个好看的区域：(名字, 中心实部, 中心虚部, 视野宽度=复平面单位)
REGIONS = [
    ("全景", -0.6, 0.0, 3.2),
    ("海马谷", -0.745, 0.113, 0.05),
    ("象鼻谷", 0.282, 0.012, 0.05),
    ("触角末梢", -1.2549, 0.0202, 0.06),
    ("迷你曼德博", -1.7687, 0.0017, 0.012),
    ("螺旋", -0.7269, 0.1889, 0.012),
    ("闪电", -0.235, 0.827, 0.10),
]

GRADIENT = " .,:;irsXA253hMHGS#9B&@"

# 每日一句（Phase 5 味道，当 caption）
APHORISMS = [
    "复杂，是简单规则迭代出来的。",
    "z = z² + c —— 一行公式，无穷细节。",
    "放大一万倍，还是同一个自己。",
    "美不用解释，跑一遍就懂。",
    "边界处最热闹，安稳的地方一片空白。",
    "同样的规则，换个起点就是另一个世界。",
    "无限的细节，有限的耐心。",
]


def _mandelbrot(cx: float, cy: float, view_w: float, width: int, height: int, max_iter: int) -> str:
    # 字符高宽比约 2:1，纵向每格取横向两倍，避免图被压扁
    dx = view_w / width
    dy = dx * 2.0
    x_start = cx - view_w / 2
    y_start = cy - dy * height / 2
    n = len(GRADIENT) - 1
    rows = []
    for r in range(height):
        y0 = y_start + r * dy
        line = []
        for c in range(width):
            x0 = x_start + c * dx
            x = y = 0.0
            i = 0
            while x * x + y * y <= 4.0 and i < max_iter:
                x, y = x * x - y * y + x0, 2.0 * x * y + y0
                i += 1
            line.append(" " if i >= max_iter else GRADIENT[i * n // max_iter])
        rows.append("".join(line))
    return "\n".join(rows)


def generate(width: int = 78, height: int = 30, max_iter: int = 90) -> dict:
    gm = time.gmtime()
    doy = gm.tm_yday
    date_str = time.strftime("%Y-%m-%d", gm)
    name, cx, cy, view_w = REGIONS[doy % len(REGIONS)]
    aphorism = APHORISMS[doy % len(APHORISMS)]

    t0 = time.perf_counter()
    art = _mandelbrot(cx, cy, view_w, width, height, max_iter)
    render_ms = round((time.perf_counter() - t0) * 1000, 1)

    return {
        "kind": "fractal",
        "title": f"{date_str} · 曼德博集合「{name}」",
        "content": art,
        "meta": {
            "aphorism": aphorism,
            "render_ms": render_ms,
            "host": socket.gethostname(),
            "region": name,
            "center": [cx, cy],
            "view_w": view_w,
            "size": [width, height],
            "max_iter": max_iter,
        },
    }
