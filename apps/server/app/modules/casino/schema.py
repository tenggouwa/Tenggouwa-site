"""反赌模拟器的 Pydantic 模型。

device_id 是前端 localStorage 里的匿名 uuid（crypto.randomUUID），无任何账号体系。
所有钱包/局信息纯计数，不涉及任何真实货币、充值或提现。
"""

from datetime import datetime

from pydantic import BaseModel, Field

# 匿名 uuid：宽松校验为 8~64 位十六进制 + 连字符，足够拦掉明显垃圾输入。
DEVICE_ID_PATTERN = r"^[0-9a-fA-F-]{8,64}$"


class PlayRequest(BaseModel):
    device_id: str = Field(..., pattern=DEVICE_ID_PATTERN)
    game: str = Field(..., min_length=1, max_length=16)
    bet_amount: int = Field(..., gt=0, le=1_000_000)
    bet_detail: dict = Field(default_factory=dict)


class PlayResult(BaseModel):
    game: str
    bet_amount: int
    payout: int  # 赢得返还（含本金口径：1:1 押注赢返 2×bet），输为 0
    net: int  # payout - bet_amount，正为赢、负为输
    outcome: str  # 'win' | 'lose'
    rng_detail: dict  # 后端权威 RNG 的结果（前端动画演到这个结果）
    balance_after: int


class WalletRequest(BaseModel):
    device_id: str = Field(..., pattern=DEVICE_ID_PATTERN)


class Wallet(BaseModel):
    device_id: str
    balance: int
    reclaim_count: int
    total_wagered: int
    total_payout: int
    net: int  # total_payout - total_wagered，玩家全历史净值
    rounds_played: int


class CurvePoint(BaseModel):
    round_index: int  # 第几局（从 1 起）
    balance_after: int
    net: int  # 当局 net
    game: str
    created_at: datetime


class CurveResponse(BaseModel):
    device_id: str
    wallet: Wallet
    points: list[CurvePoint]


class GameStat(BaseModel):
    game: str
    rounds: int
    total_wagered: int
    total_payout: int
    observed_rtp: float | None  # 实测返还率 = total_payout / total_wagered
    observed_house_edge: float | None  # 实测庄家优势 = 1 - RTP
    theoretical_house_edge: float  # 理论庄家优势（各游戏数学期望）


class BlackjackDealRequest(BaseModel):
    device_id: str = Field(..., pattern=DEVICE_ID_PATTERN)
    bet_amount: int = Field(..., gt=0, le=1_000_000)


class BlackjackActionRequest(BaseModel):
    device_id: str = Field(..., pattern=DEVICE_ID_PATTERN)
    action: str = Field(..., pattern=r"^(hit|stand|double)$")


class BlackjackState(BaseModel):
    status: str  # 'player_turn' | 'done'
    player: list[dict]
    dealer: list[dict]  # 进行中只含庄家明牌；结算后是全部
    player_total: int
    dealer_total: int  # 进行中是明牌点数；结算后是庄家总点
    can_double: bool
    bet: int
    doubled: bool
    # 仅结算后有意义：
    result: str | None = None  # 'player' | 'dealer' | 'push' | 'player_blackjack'
    outcome: str | None = None  # 'win' | 'lose' | 'push'
    payout: int = 0
    net: int = 0
    balance: int


class StatsSummary(BaseModel):
    games: list[GameStat]
    total_rounds: int
    total_players: int
    total_wagered: int
    total_payout: int
