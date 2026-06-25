"""视频扑克（Jacks or Better）牌型判定 + 牌堆。纯函数。

发 5 张后玩家选留牌，其余从预定序牌堆顺序补；按最终 5 张牌型查赔付表。
9/6 全赔表，最优打法 RTP≈99.5%——是赌场返还率最高的机器之一，但仍是负期望。
PAYTABLE 是"含本金口径"的返还倍率：payout = bet × 倍率；一对 J 以上赔 1 倍即退本金。
"""

import secrets
from collections import Counter

_rng = secrets.SystemRandom()

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["s", "h", "d", "c"]
_VAL = {r: i + 2 for i, r in enumerate(RANKS)}  # 2..14（A=14）

# 牌型 -> 含本金返还倍率（9/6 Jacks or Better 全赔表）。
PAYTABLE: dict[str, int] = {
    "royal_flush": 250,
    "straight_flush": 50,
    "four_kind": 25,
    "full_house": 9,
    "flush": 6,
    "straight": 4,
    "three_kind": 3,
    "two_pair": 2,
    "jacks_or_better": 1,
    "high_card": 0,
}

CATEGORY_NAME: dict[str, str] = {
    "royal_flush": "皇家同花顺",
    "straight_flush": "同花顺",
    "four_kind": "四条",
    "full_house": "葫芦",
    "flush": "同花",
    "straight": "顺子",
    "three_kind": "三条",
    "two_pair": "两对",
    "jacks_or_better": "一对 J 以上",
    "high_card": "未成牌",
}


def make_deck() -> list[dict]:
    deck = [{"r": r, "s": s} for r in RANKS for s in SUITS]
    _rng.shuffle(deck)
    return deck


def _is_straight(vals: list[int]) -> bool:
    s = sorted(set(vals))
    if len(s) != 5:
        return False
    if s[4] - s[0] == 4:
        return True
    return s == [2, 3, 4, 5, 14]  # A-2-3-4-5 最小顺子


def evaluate(cards: list[dict]) -> str:
    """返回 5 张牌型的 key（PAYTABLE 的键）。按从大到小逐项命中。"""
    vals = [_VAL[c["r"]] for c in cards]
    counts = Counter(vals)
    flush = len({c["s"] for c in cards}) == 1
    straight = _is_straight(vals)
    shape = sorted(counts.values(), reverse=True)
    high_pair = shape[0] == 2 and max(v for v, c in counts.items() if c == 2) >= 11  # 对 J/Q/K/A 才赔

    checks = [
        (straight and flush and set(vals) == {10, 11, 12, 13, 14}, "royal_flush"),
        (straight and flush, "straight_flush"),
        (shape[0] == 4, "four_kind"),
        (shape == [3, 2], "full_house"),
        (flush, "flush"),
        (straight, "straight"),
        (shape[0] == 3, "three_kind"),
        (shape[:2] == [2, 2], "two_pair"),
        (high_pair, "jacks_or_better"),
    ]
    return next((key for ok, key in checks if ok), "high_card")
