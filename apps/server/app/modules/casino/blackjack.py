"""21 点（Blackjack）牌局逻辑。纯函数 + 牌靴生成，状态由 service/repository 持久化。

RNG 在发牌时一次性把牌靴定好（make_shoe），后续要牌从牌靴顺序抽，客户端无法影响后续牌。
庄家规则：要到 17 点（含软 17）站住（S17）。21 点理论庄家优势（基本策略）约 0.5%。
"""

import secrets

_rng = secrets.SystemRandom()

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["s", "h", "d", "c"]

# 一局最多用不了这么多张，预生成足够长的牌靴即可。
SHOE_SIZE = 24


def make_shoe() -> list[dict]:
    return [{"r": _rng.choice(RANKS), "s": _rng.choice(SUITS)} for _ in range(SHOE_SIZE)]


def card_value(rank: str) -> int:
    if rank in ("10", "J", "Q", "K"):
        return 10
    if rank == "A":
        return 11
    return int(rank)


def hand_total(cards: list[dict]) -> int:
    """返回最优点数：A 先按 11 算，爆了再把 A 当 1。"""
    total = sum(card_value(c["r"]) for c in cards)
    aces = sum(1 for c in cards if c["r"] == "A")
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def is_blackjack(cards: list[dict]) -> bool:
    return len(cards) == 2 and hand_total(cards) == 21


def dealer_play(dealer: list[dict], shoe: list[dict]) -> None:
    """庄家补牌到 17 点（含软 17）站住。原地修改 dealer / shoe。"""
    while hand_total(dealer) < 17:
        dealer.append(shoe.pop(0))
