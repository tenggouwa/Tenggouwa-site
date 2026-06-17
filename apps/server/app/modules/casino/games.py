"""反赌模拟器游戏引擎。

每个游戏一个纯函数 (bet_amount, bet_detail) -> GameOutcome，算出赔付 + RNG 细节。
RNG 一律用 secrets.SystemRandom（密码学级），保证赔率不可被前端篡改；前端只把动画
演到返回的 rng_detail。THEORETICAL_HOUSE_EDGE 给 /stats 接口对比"实测 vs 理论"。

赔付口径：payout 是"赢得返还（含本金）"。1:1 押注赢则 payout = 2×bet，输则 payout = 0。
这样 RTP = total_payout / total_wagered，与赌场标准返还率口径一致。
"""

import secrets
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass

_rng = secrets.SystemRandom()


class GameError(ValueError):
    """非法下注（未知 game / bet_detail 不合法）。service 层转 400。"""


@dataclass
class GameOutcome:
    payout: int  # 赢得返还（含本金），输为 0
    rng_detail: dict


# 各游戏理论庄家优势（数学期望），stats 接口用来对比实测是否收敛到理论值。
THEORETICAL_HOUSE_EDGE: dict[str, float] = {
    "dice": 0.0278,  # Sic Bo 大小：任意豹子通杀，赢面 105/216 vs 输面 111/216
    "roulette": 0.0270,  # 欧式单零轮盘：所有投注因那个 0 都是 1/37 ≈ 2.70%
    "slots": 0.0604,  # 三轴老虎机：赔率表 + 卷轴权重精确算出 RTP=93.96%
    "baccarat": 0.0106,  # 百家乐：以最常见的"押庄"为基准 1.06%（押闲 1.24%，押和 8:1 约 14.4%）
    "blackjack": 0.005,  # 21 点：基本策略约 0.5%——但乱玩会远高于此，正好对比"实测 vs 理论"
}

# 欧式轮盘的红色号码（其余 1-36 为黑，0 为绿）。
_ROULETTE_RED = frozenset({1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36})

# 老虎机：每根卷轴的符号权重（blank 是不赔的空档，用来压住命中率），三轴独立抽。
_SLOTS_WEIGHTS: dict[str, int] = {"cherry": 4, "bar": 4, "bell": 3, "diamond": 2, "seven": 1, "blank": 6}
_SLOTS_SYMBOLS = list(_SLOTS_WEIGHTS)
_SLOTS_WEIGHT_VALUES = list(_SLOTS_WEIGHTS.values())
# 三同符号的返还倍率（payout = bet × 倍率，含本金口径）。
_SLOTS_THREE = {"cherry": 10, "bar": 20, "bell": 45, "diamond": 120, "seven": 350}
_SLOTS_TWO_CHERRY = 4  # 恰好两个 cherry 的安慰奖


def _play_dice(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """骰子大小（Sic Bo 简化版）。

    押 'big'(三颗骰子总和 11-17) 或 'small'(4-10)，1:1 赔付；任意"豹子"（三颗同号）
    庄家通杀。赢面 105/216 ≈ 0.4861，庄家优势 ≈ 2.78%。
    """
    side = bet_detail.get("bet")
    if side not in ("big", "small"):
        raise GameError("骰子下注必须是 big 或 small")

    dice = [_rng.randint(1, 6) for _ in range(3)]
    total = sum(dice)
    is_triple = dice[0] == dice[1] == dice[2]

    if is_triple:
        result = "triple"
    elif total >= 11:
        result = "big"
    else:
        result = "small"

    won = (not is_triple) and result == side
    payout = bet_amount * 2 if won else 0
    return GameOutcome(
        payout=payout,
        rng_detail={"dice": dice, "total": total, "triple": is_triple, "result": result},
    )


def _play_roulette(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """欧式单零轮盘（0-36）。

    支持的投注（赢面都含那个 0 的拖累，庄家优势恒为 1/37 ≈ 2.70%）：
    - number：押单个号码 0-36，35:1
    - color：red / black，1:1（0 不算红黑）
    - parity：odd / even，1:1（0 不算单双）
    - range：low(1-18) / high(19-36)，1:1（0 通杀）
    """
    bet_type = bet_detail.get("type")
    spin = _rng.randint(0, 36)
    color = "green" if spin == 0 else ("red" if spin in _ROULETTE_RED else "black")

    won = False
    mult = 0
    if bet_type == "number":
        value = bet_detail.get("value")
        if not isinstance(value, int) or not 0 <= value <= 36:
            raise GameError("号码必须是 0-36 的整数")
        won, mult = spin == value, 35
    elif bet_type == "color":
        value = bet_detail.get("value")
        if value not in ("red", "black"):
            raise GameError("颜色必须是 red 或 black")
        won, mult = color == value, 1
    elif bet_type == "parity":
        value = bet_detail.get("value")
        if value not in ("odd", "even"):
            raise GameError("单双必须是 odd 或 even")
        won, mult = spin != 0 and (spin % 2 == 1) == (value == "odd"), 1
    elif bet_type == "range":
        value = bet_detail.get("value")
        if value not in ("low", "high"):
            raise GameError("大小必须是 low 或 high")
        won, mult = (1 <= spin <= 18) if value == "low" else (19 <= spin <= 36), 1
    else:
        raise GameError(f"未知轮盘玩法: {bet_type}")

    payout = bet_amount * (mult + 1) if won else 0
    return GameOutcome(payout=payout, rng_detail={"number": spin, "color": color, "win": won})


def _play_slots(bet_amount: int, _bet_detail: dict) -> GameOutcome:
    """三轴老虎机。三根卷轴按权重独立抽符号，看似随机，赔率早写死。

    三同符号按 _SLOTS_THREE 赔；恰好两个 cherry 给安慰奖。精确 RTP=93.96%
    （庄家优势 6.04%），命中率约 11.6%——大多数时候就是输。
    """
    reels = _rng.choices(_SLOTS_SYMBOLS, weights=_SLOTS_WEIGHT_VALUES, k=3)
    counts = Counter(reels)

    mult = 0
    for symbol, m in _SLOTS_THREE.items():
        if counts[symbol] == 3:
            mult = m
            break
    else:
        if counts["cherry"] == 2:
            mult = _SLOTS_TWO_CHERRY

    payout = bet_amount * mult
    return GameOutcome(payout=payout, rng_detail={"reels": reels, "win": payout > 0})


_BACCARAT_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
_BACCARAT_SUITS = ["s", "h", "d", "c"]


def _baccarat_card_value(rank: str) -> int:
    if rank in ("10", "J", "Q", "K"):
        return 0
    if rank == "A":
        return 1
    return int(rank)


def _baccarat_draw() -> dict:
    return {"r": _rng.choice(_BACCARAT_RANKS), "s": _rng.choice(_BACCARAT_SUITS)}


def _baccarat_total(cards: list[dict]) -> int:
    return sum(_baccarat_card_value(c["r"]) for c in cards) % 10


def _play_baccarat(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """百家乐（punto banco）。押庄/闲/和，按标准补牌规则发牌。

    赔付：闲赢 1:1；庄赢 1:1 抽 5% 水（0.95:1）；和局时押庄/闲退本金（平局），押和 8:1。
    理论庄家优势：押庄 1.06%，押闲 1.24%，押和约 14.4%。
    """
    side = bet_detail.get("type")
    if side not in ("player", "banker", "tie"):
        raise GameError("百家乐下注必须是 player / banker / tie")

    player = [_baccarat_draw(), _baccarat_draw()]
    banker = [_baccarat_draw(), _baccarat_draw()]
    p_total = _baccarat_total(player)
    b_total = _baccarat_total(banker)

    # 任一方两张牌 8 或 9 为"天牌"，双方都不再补。
    if p_total < 8 and b_total < 8:
        p_third: int | None = None
        if p_total <= 5:
            card = _baccarat_draw()
            player.append(card)
            p_third = _baccarat_card_value(card["r"])

        # 庄家补牌：闲未补则庄 0-5 补；闲补了则按 p_third 查表。
        if p_third is None:
            banker_draws = b_total <= 5
        elif b_total <= 2:
            banker_draws = True
        elif b_total == 3:
            banker_draws = p_third != 8
        elif b_total == 4:
            banker_draws = p_third in (2, 3, 4, 5, 6, 7)
        elif b_total == 5:
            banker_draws = p_third in (4, 5, 6, 7)
        elif b_total == 6:
            banker_draws = p_third in (6, 7)
        else:
            banker_draws = False
        if banker_draws:
            banker.append(_baccarat_draw())

        p_total = _baccarat_total(player)
        b_total = _baccarat_total(banker)

    if p_total > b_total:
        result = "player"
    elif b_total > p_total:
        result = "banker"
    else:
        result = "tie"

    if side == "tie":
        payout = bet_amount * 9 if result == "tie" else 0
    elif result == "tie":
        payout = bet_amount  # 押庄/闲遇和局：退本金
    elif side == result:
        payout = bet_amount + (bet_amount * 95) // 100 if side == "banker" else bet_amount * 2
    else:
        payout = 0

    return GameOutcome(
        payout=payout,
        rng_detail={
            "player": player,
            "banker": banker,
            "player_total": p_total,
            "banker_total": b_total,
            "result": result,
        },
    )


_ENGINES: dict[str, Callable[[int, dict], GameOutcome]] = {
    "dice": _play_dice,
    "roulette": _play_roulette,
    "slots": _play_slots,
    "baccarat": _play_baccarat,
}


def play(game: str, bet_amount: int, bet_detail: dict) -> GameOutcome:
    engine = _ENGINES.get(game)
    if engine is None:
        raise GameError(f"未知游戏: {game}")
    return engine(bet_amount, bet_detail)
