"""炸金花（赢三张）牌型判定。纯函数。

牌型高→低：豹子(6) > 顺金(5) > 金花(4) > 顺子(3) > 对子(2) > 散牌(1)。
evaluate 返回一个可比较元组：先比类别，再比类别内的关键点数；元组大者牌大。
A 可作最大(Q-K-A)或最小(A-2-3 为最小顺子)。
"""

import secrets

_rng = secrets.SystemRandom()

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["s", "h", "d", "c"]
_VAL = {r: i + 2 for i, r in enumerate(RANKS)}  # 2..14（A=14）


def deal_two_hands() -> tuple[list[dict], list[dict]]:
    """从一副 52 张里发 6 张不重复，前 3 给闲、后 3 给庄。"""
    deck = [{"r": r, "s": s} for r in RANKS for s in SUITS]
    six = _rng.sample(deck, 6)
    return six[:3], six[3:]


def _straight_high(vals: list[int]) -> int | None:
    """三张是否顺子；是则返回顺子的"高牌"（A-2-3 记为 3，最小），否则 None。"""
    s = sorted(set(vals))
    if len(s) != 3:
        return None
    if set(vals) == {14, 2, 3}:
        return 3  # 最小顺子
    if s[2] - s[0] == 2:
        return s[2]
    return None


def evaluate(cards: list[dict]) -> tuple:
    """返回可比较元组，越大牌越大。"""
    vals = sorted((_VAL[c["r"]] for c in cards), reverse=True)
    flush = len({c["s"] for c in cards}) == 1
    sh = _straight_high(vals)
    counts: dict[int, int] = {}
    for v in vals:
        counts[v] = counts.get(v, 0) + 1

    if 3 in counts.values():  # 豹子
        return (6, vals[0])
    if sh is not None and flush:  # 顺金
        return (5, sh)
    if flush:  # 金花
        return (4, *vals)
    if sh is not None:  # 顺子
        return (3, sh)
    if 2 in counts.values():  # 对子：对子点数 + 单张
        pair = next(v for v, c in counts.items() if c == 2)
        kicker = next(v for v, c in counts.items() if c == 1)
        return (2, pair, kicker)
    return (1, *vals)  # 散牌


CATEGORY_NAME = {6: "豹子", 5: "顺金", 4: "金花", 3: "顺子", 2: "对子", 1: "散牌"}
