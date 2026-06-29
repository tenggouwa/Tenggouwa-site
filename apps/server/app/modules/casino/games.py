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

from . import niuniu

_rng = secrets.SystemRandom()

_NIUNIU_RAKE = 0.05  # 牛牛闲赢抽水比例（庄家优势来源，约 2.46%）


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
    "dragon_tiger": 0.0385,  # 龙虎：押龙/虎和局退一半，约 3.85%（押和 8:1 约 30%）
    "keno": 0.28,  # 基诺：随选号数浮动，各档 RTP≈0.72，约 28%，全场最坑之一
    "crash": 0.04,  # 崩盘：P(crash≥T)=(1-e)/T 使任意目标 RTP 恒为 1-e=96%，庄家优势 4%
    "money_wheel": 0.111,  # 幸运大转盘：以最好的"押 1"为基准 11.1%（押越大的格优势越高，至 22%）
    "plinko": 0.04,  # Plinko：倍率表调成 RTP≈96%，庄家优势约 4%
    "sicbo": 0.0278,  # 完整骰宝：以最好的"大/小"为基准 2.78%（押单点/对/总和/豹子优势高得多）
    "zhajinhua": 0.05,  # 炸金花：多步对庄博弈，闲赢时池子抽 5% 水（约等于庄家优势）
    "niuniu": 0.0246,  # 牛牛：闲庄各 5 张比牛，均注 1:1 闲赢抽 5% 水，实测庄家优势约 2.46%
    "scratch": 0.435,  # 刮刮乐：即开彩票，奖表 RTP≈56.5%，庄家优势约 43.5%——回报率最低一类
    "videopoker": 0.0046,  # 视频扑克：9/6 Jacks or Better，最优留牌 RTP≈99.54%；乱留远不止
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


def _dragon_tiger_value(rank: str) -> int:
    return _BACCARAT_RANKS.index(rank) + 1  # A=1 … K=13


def _play_dragon_tiger(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """龙虎斗：龙、虎各发一张比单牌大小（A 最小、K 最大）。

    押龙/虎赢 1:1、遇和退一半；押和 8:1。押龙/虎庄家优势约 3.85%，押和约 30%（陷阱）。
    """
    side = bet_detail.get("type")
    if side not in ("dragon", "tiger", "tie"):
        raise GameError("龙虎下注必须是 dragon / tiger / tie")

    dragon = _baccarat_draw()
    tiger = _baccarat_draw()
    dv = _dragon_tiger_value(dragon["r"])
    tv = _dragon_tiger_value(tiger["r"])
    result = "dragon" if dv > tv else ("tiger" if tv > dv else "tie")

    if side == "tie":
        payout = bet_amount * 9 if result == "tie" else 0
    elif result == "tie":
        payout = bet_amount // 2  # 押龙/虎遇和退一半
    elif side == result:
        payout = bet_amount * 2
    else:
        payout = 0

    return GameOutcome(
        payout=payout,
        rng_detail={"dragon": dragon, "tiger": tiger, "result": result},
    )


# 基诺赔付表：spots(选号数) -> {hits(命中数): 返还倍率}。未列出的命中数 = 0。
# 经超几何分布调成各选号数 RTP≈0.72（庄家优势约 28%）。
_KENO_PAYTABLE: dict[int, dict[int, int]] = {
    1: {1: 3},
    2: {2: 12},
    3: {2: 1, 3: 42},
    4: {2: 1, 3: 4, 4: 98},
    5: {3: 2, 4: 14, 5: 560},
    6: {3: 1, 4: 5, 5: 84, 6: 1300},
    7: {4: 3, 5: 28, 6: 145, 7: 8000},
    8: {5: 15, 6: 77, 7: 1200, 8: 13000},
    9: {5: 6, 6: 34, 7: 250, 8: 4600, 9: 31000},
    10: {5: 3, 6: 25, 7: 100, 8: 560, 9: 5600, 10: 111000},
}


def _play_keno(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """基诺：从 1-80 选 1-10 个号，机开 20 个，按命中数查赔付表。庄家优势普遍 25-30%。"""
    picks = bet_detail.get("picks")
    if not isinstance(picks, list) or not 1 <= len(picks) <= 10:
        raise GameError("基诺需选 1-10 个号码")
    picks_set = {p for p in picks if isinstance(p, int) and 1 <= p <= 80}
    if len(picks_set) != len(picks):
        raise GameError("号码须为 1-80 且不重复")

    draw = _rng.sample(range(1, 81), 20)
    hits = len(picks_set & set(draw))
    mult = _KENO_PAYTABLE[len(picks_set)].get(hits, 0)
    payout = bet_amount * mult
    return GameOutcome(
        payout=payout,
        rng_detail={"draw": sorted(draw), "picks": sorted(picks_set), "hits": hits},
    )


_CRASH_EDGE = 0.04


def _play_crash(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """崩盘（自动兑现）：预设目标倍率 target，后端出崩盘点 crash。crash≥target 则赢 bet×target。

    崩盘点满足 P(crash≥m) = (1-e)/m，于是任意 target 的 RTP 恒为 1-e（庄家优势 e=4%）。
    目标越贪心，越容易在到点前崩盘归零——这就是崩盘类游戏的成瘾陷阱。
    """
    target = bet_detail.get("target")
    if not isinstance(target, int | float) or not 1.01 <= target <= 1000:
        raise GameError("目标倍率须在 1.01 - 1000 之间")

    # e 的概率直接崩在 1.00（庄家优势）；否则 crash = 1/(1-U)，使 P(crash≥m)=1/m。
    raw = 1.0 if _rng.random() < _CRASH_EDGE else min(1000.0, 1.0 / (1.0 - _rng.random()))
    crash = max(1.0, int(raw * 100) / 100)  # 截到两位小数

    won = crash >= target
    payout = int(bet_amount * target) if won else 0
    return GameOutcome(
        payout=payout,
        rng_detail={"crash": crash, "target": round(float(target), 2), "cashed": won},
    )


# 幸运大转盘（Big Six）：54 格，符号均匀打散排列（真钱轮的样子，概率只看每种数量）。
# 顺序与前端 MoneyWheelScene 的 SEGMENTS 必须完全一致（按 index 落点）。
_WHEEL_SEGMENTS = [
    "1", "2", "1", "5", "2", "1", "10", "1", "2", "1", "5", "1", "2", "20", "1", "2", "1", "1",
    "5", "2", "10", "1", "2", "1", "1", "2", "5", "40", "joker", "1", "1", "2", "1", "10", "2", "5",
    "1", "1", "2", "1", "20", "2", "1", "5", "1", "2", "1", "10", "1", "2", "5", "1", "2", "1",
]  # fmt: skip
_WHEEL_PAYOUT = {"1": 2, "2": 3, "5": 6, "10": 11, "20": 21, "40": 41, "joker": 46}


def _play_money_wheel(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """幸运大转盘：押某个符号，转盘停在哪格定输赢。庄家优势按格 11.1%–22.2% 不等。"""
    pick = bet_detail.get("bet")
    if pick not in _WHEEL_PAYOUT:
        raise GameError("大转盘下注须是 1/2/5/10/20/40/joker 之一")
    idx = _rng.randrange(len(_WHEEL_SEGMENTS))
    seg = _WHEEL_SEGMENTS[idx]
    payout = bet_amount * _WHEEL_PAYOUT[pick] if seg == pick else 0
    return GameOutcome(payout=payout, rng_detail={"segment": seg, "index": idx, "win": seg == pick})


# Plinko：12 排钉，13 个落袋的倍率（对称，边缘高、中间 <1）。已调成 RTP≈96%。
_PLINKO_ROWS = 12
_PLINKO_MULT = [50.0, 12.0, 5.0, 2.0, 1.0, 0.5, 0.25, 0.5, 1.0, 2.0, 5.0, 12.0, 50.0]


def _play_plinko(bet_amount: int, _bet_detail: dict) -> GameOutcome:
    """Plinko：小球穿过 12 排钉，每排 50/50 左右弹，落入底部 13 格之一按倍率赔。"""
    path = ["R" if _rng.random() < 0.5 else "L" for _ in range(_PLINKO_ROWS)]
    slot = sum(1 for d in path if d == "R")  # 0..12
    mult = _PLINKO_MULT[slot]
    payout = int(bet_amount * mult)
    return GameOutcome(payout=payout, rng_detail={"path": path, "slot": slot, "mult": mult})


# 完整骰宝总和投注的赔率表（总和 -> 含本金返还倍率，X:1 即 X+1）。
_SICBO_TOTAL_PAYOUT = {
    4: 51, 5: 19, 6: 15, 7: 13, 8: 9, 9: 7, 10: 7,
    11: 7, 12: 7, 13: 9, 14: 13, 15: 15, 16: 19, 17: 51,
}  # fmt: skip


def _play_sicbo(bet_amount: int, bet_detail: dict) -> GameOutcome:
    """完整骰宝：三颗骰子，多种投注。

    big/small 大小 1:1（豹子通杀）；number 押单点按出现次数 1:1 每颗；total 押总和查表；
    any_triple 任意豹子 30:1；triple 指定豹子 150:1；double 指定对子（≥2 颗）10:1。
    """
    dice = [_rng.randint(1, 6) for _ in range(3)]
    total = sum(dice)
    counts = Counter(dice)
    is_triple = len(counts) == 1
    bet_type = bet_detail.get("type")
    value = bet_detail.get("value")

    payout = 0
    if bet_type == "big":
        payout = bet_amount * 2 if (not is_triple and 11 <= total <= 17) else 0
    elif bet_type == "small":
        payout = bet_amount * 2 if (not is_triple and 4 <= total <= 10) else 0
    elif bet_type == "number":
        if value not in (1, 2, 3, 4, 5, 6):
            raise GameError("单点投注须是 1-6")
        n = counts.get(value, 0)
        payout = bet_amount * (1 + n) if n > 0 else 0  # 出现 n 颗 → n:1
    elif bet_type == "total":
        if value not in _SICBO_TOTAL_PAYOUT:
            raise GameError("总和投注须是 4-17")
        payout = bet_amount * _SICBO_TOTAL_PAYOUT[value] if total == value else 0
    elif bet_type == "any_triple":
        payout = bet_amount * 31 if is_triple else 0
    elif bet_type == "triple":
        if value not in (1, 2, 3, 4, 5, 6):
            raise GameError("指定豹子须是 1-6")
        payout = bet_amount * 151 if (is_triple and dice[0] == value) else 0
    elif bet_type == "double":
        if value not in (1, 2, 3, 4, 5, 6):
            raise GameError("指定对子须是 1-6")
        payout = bet_amount * 11 if counts.get(value, 0) >= 2 else 0
    else:
        raise GameError(f"未知骰宝玩法: {bet_type}")

    return GameOutcome(
        payout=payout,
        rng_detail={"dice": dice, "total": total, "triple": is_triple},
    )


# 刮刮乐（即开彩票）：9 格刮开，三个相同符号中对应奖。每个奖级对应一个符号，
# 中奖即在 9 格里正好放 3 个该符号。奖表按 概率×倍率 定出 RTP≈56.5%（庄家优势约 43.5%）。
_SCRATCH_PRIZES = [
    # (符号, 含本金返还倍率, 中奖概率)
    ("clover", 2, 0.12),
    ("bell", 3, 0.05),
    ("bar", 5, 0.015),
    ("seven", 10, 0.005),
    ("star", 50, 0.0006),
    ("gem", 500, 0.00004),
]
_SCRATCH_SYMBOLS = [s for s, _, _ in _SCRATCH_PRIZES]


def _scratch_build_grid(win_symbol: str | None) -> list[str]:
    """造 9 格符号：中奖则正好 3 个 win_symbol、其余符号各 ≤2（不产生第二个三连）；
    未中则所有符号各 ≤2（没有任何三连）。这样刮开的画面与后端判定的输赢严格一致。"""
    counts = dict.fromkeys(_SCRATCH_SYMBOLS, 0)
    cells: list[str] = []
    if win_symbol is not None:
        cells = [win_symbol] * 3
        counts[win_symbol] = 3
    while len(cells) < 9:
        pick = _rng.choice([s for s in _SCRATCH_SYMBOLS if counts[s] < 2])
        cells.append(pick)
        counts[pick] += 1
    _rng.shuffle(cells)
    return cells


def _play_scratch(bet_amount: int, _bet_detail: dict) -> GameOutcome:
    """刮刮乐：买一张票刮开 9 格，三个相同符号中奖。奖表 RTP≈56.5%、庄家优势约 43.5%——
    用偶尔的大奖掩盖极差期望，是回报率最低的一类博彩。"""
    roll = _rng.random()
    cum = 0.0
    win_symbol: str | None = None
    mult = 0
    for symbol, m, p in _SCRATCH_PRIZES:
        cum += p
        if roll < cum:
            win_symbol, mult = symbol, m
            break

    grid = _scratch_build_grid(win_symbol)
    payout = bet_amount * mult
    return GameOutcome(
        payout=payout,
        rng_detail={"grid": grid, "symbol": win_symbol, "mult": mult, "win": mult > 0},
    )


def _play_niuniu(bet_amount: int, _bet_detail: dict) -> GameOutcome:
    """牛牛（斗牛）：闲庄各 5 张比牛，牛大者赢（牛值同则比点数）。

    均注 1:1，闲赢抽 5% 水（payout = 本金 + 0.95×本金）；平牌退本金。牛型倍数仅作展示，
    不改赔付。抽水使庄家优势约 2.46%——看着对半开，赢了照样被刮一刀。
    """
    player, banker = niuniu.deal_two_hands()
    pe = niuniu.evaluate(player)
    be = niuniu.evaluate(banker)

    if pe > be:
        result = "player"
        win = bet_amount - int(bet_amount * _NIUNIU_RAKE)  # 1:1 赢额抽 5% 水
        payout = bet_amount + win
    elif pe < be:
        result = "banker"
        payout = 0
    else:
        result = "tie"
        payout = bet_amount  # 平牌退本金

    return GameOutcome(
        payout=payout,
        rng_detail={
            "player": player,
            "banker": banker,
            "player_niu": pe[0],
            "banker_niu": be[0],
            "player_mult": niuniu.niu_multiplier(pe[0]),
            "banker_mult": niuniu.niu_multiplier(be[0]),
            "result": result,
        },
    )


_ENGINES: dict[str, Callable[[int, dict], GameOutcome]] = {
    "dice": _play_dice,
    "roulette": _play_roulette,
    "slots": _play_slots,
    "baccarat": _play_baccarat,
    "dragon_tiger": _play_dragon_tiger,
    "keno": _play_keno,
    "crash": _play_crash,
    "money_wheel": _play_money_wheel,
    "plinko": _play_plinko,
    "sicbo": _play_sicbo,
    "niuniu": _play_niuniu,
    "scratch": _play_scratch,
}


def play(game: str, bet_amount: int, bet_detail: dict) -> GameOutcome:
    engine = _ENGINES.get(game)
    if engine is None:
        raise GameError(f"未知游戏: {game}")
    return engine(bet_amount, bet_detail)
