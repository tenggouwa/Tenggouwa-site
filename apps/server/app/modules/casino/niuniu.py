"""牛牛（斗牛）牌型判定。纯函数。

5 张牌，找任意 3 张点数和为 10 的倍数；余 2 张点数和 mod 10 即"牛几"（1-9），
mod 10 为 0 则是"牛牛"（最大）；凑不出任何 3 张为 10 的倍数则"无牛"（最小）。
点数：A=1，2-10 按面值，J/Q/K=10。

要点：5 张总点数为 T，若某 3 张和 ≡0(mod 10)，则余 2 张 ≡T(mod 10)，与选哪 3 张无关——
所以牛值只取决于"存在性"与 T mod 10。
"""

import secrets
from itertools import combinations

_rng = secrets.SystemRandom()

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["s", "h", "d", "c"]


def _point(rank: str) -> int:
    if rank in ("10", "J", "Q", "K"):
        return 10
    if rank == "A":
        return 1
    return int(rank)


def deal_two_hands() -> tuple[list[dict], list[dict]]:
    """一副 52 张发 10 张不重复，前 5 给闲、后 5 给庄。"""
    deck = [{"r": r, "s": s} for r in RANKS for s in SUITS]
    ten = _rng.sample(deck, 10)
    return ten[:5], ten[5:]


def niu_value(cards: list[dict]) -> int:
    """返回牛值：0=无牛，1-9=牛一..牛九，10=牛牛。"""
    pts = [_point(c["r"]) for c in cards]
    if any(sum(pts[i] for i in combo) % 10 == 0 for combo in combinations(range(5), 3)):
        rest = sum(pts) % 10
        return 10 if rest == 0 else rest
    return 0


def evaluate(cards: list[dict]) -> tuple:
    """可比较元组：先比牛值，再比点数多重集（降序）。元组大者牌大。"""
    pts = sorted((_point(c["r"]) for c in cards), reverse=True)
    return (niu_value(cards), *pts)


def niu_multiplier(niu: int) -> int:
    """牛型倍数（仅展示/教学；赔付为均注 1:1）。"""
    if niu == 10:
        return 4
    if niu == 9:
        return 3
    if niu >= 7:
        return 2
    return 1


def niu_name(niu: int) -> str:
    if niu == 0:
        return "无牛"
    if niu == 10:
        return "牛牛"
    return f"牛{niu}"
