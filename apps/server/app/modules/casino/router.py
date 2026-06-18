import logging

from db import get_session
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..common_schema import ResponseModel
from .schema import (
    BlackjackActionRequest,
    BlackjackDealRequest,
    BlackjackState,
    CurveResponse,
    MinesRevealRequest,
    MinesStartRequest,
    MinesState,
    PlayRequest,
    PlayResult,
    StatsSummary,
    Wallet,
    WalletRequest,
    ZhajinhuaActionRequest,
    ZhajinhuaStartRequest,
    ZhajinhuaState,
)
from .service import casino_service

logger = logging.getLogger(__name__)

# 公开接口（前台 casino app 用，免鉴权；身份是匿名 device_id）。
public_router = APIRouter(prefix="/public/casino", tags=["public.casino"])


@public_router.post("/wallet", response_model=ResponseModel[Wallet])
async def get_wallet(
    payload: WalletRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Wallet]:
    """取/建钱包：首次进来按固定初始积分发一个。"""
    return ResponseModel(data=await casino_service.get_wallet(session, payload.device_id))


@public_router.post("/claim", response_model=ResponseModel[Wallet])
async def claim(
    payload: WalletRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[Wallet]:
    """输光重领固定积分（仅余额为 0 时）。重领次数累计落库。"""
    return ResponseModel(data=await casino_service.claim(session, payload.device_id))


@public_router.post("/play", response_model=ResponseModel[PlayResult])
async def play(
    payload: PlayRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[PlayResult]:
    """下一注：后端权威 RNG 算结果 + 落库，返回结果与新余额。"""
    return ResponseModel(data=await casino_service.play(session, payload))


@public_router.get("/curve", response_model=ResponseModel[CurveResponse])
async def curve(
    device_id: str = Query(..., min_length=8, max_length=64),
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[CurveResponse]:
    """该玩家的输赢曲线：balance 随局数变化（最近窗口）。"""
    return ResponseModel(data=await casino_service.curve(session, device_id))


@public_router.get("/stats", response_model=ResponseModel[StatsSummary])
async def stats(session: AsyncSession = Depends(get_session)) -> ResponseModel[StatsSummary]:
    """全站聚合：每个游戏的实测 RTP / 庄家优势 vs 理论值。反赌教育落点。"""
    return ResponseModel(data=await casino_service.stats(session))


@public_router.post("/blackjack/deal", response_model=ResponseModel[BlackjackState])
async def blackjack_deal(
    payload: BlackjackDealRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[BlackjackState]:
    """21 点开局：发牌、托管押注，返回玩家手牌 + 庄家明牌。天牌则立即结算。"""
    return ResponseModel(data=await casino_service.bj_deal(session, payload.device_id, payload.bet_amount))


@public_router.post("/blackjack/action", response_model=ResponseModel[BlackjackState])
async def blackjack_action(
    payload: BlackjackActionRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[BlackjackState]:
    """21 点动作：hit 要牌 / stand 停牌 / double 双倍。结算时揭庄家暗牌。"""
    return ResponseModel(data=await casino_service.bj_action(session, payload.device_id, payload.action))


@public_router.post("/mines/start", response_model=ResponseModel[MinesState])
async def mines_start(
    payload: MinesStartRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[MinesState]:
    """Mines 开局：托管押注、随机布雷，返回 5×5 空盘。"""
    state = await casino_service.mines_start(session, payload.device_id, payload.bet_amount, payload.mines)
    return ResponseModel(data=state)


@public_router.post("/mines/reveal", response_model=ResponseModel[MinesState])
async def mines_reveal(
    payload: MinesRevealRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[MinesState]:
    """Mines 翻格：踩雷归零；安全则倍率上涨；翻完所有安全格自动兑现。"""
    return ResponseModel(data=await casino_service.mines_reveal(session, payload.device_id, payload.tile))


@public_router.post("/mines/cashout", response_model=ResponseModel[MinesState])
async def mines_cashout(
    payload: WalletRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[MinesState]:
    """Mines 兑现：按当前倍率结算落袋。"""
    return ResponseModel(data=await casino_service.mines_cashout(session, payload.device_id))


@public_router.post("/zhajinhua/start", response_model=ResponseModel[ZhajinhuaState])
async def zhajinhua_start(
    payload: ZhajinhuaStartRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[ZhajinhuaState]:
    """炸金花开局：闲庄各下底注、发牌（闲默认闷牌）。"""
    return ResponseModel(data=await casino_service.zjh_start(session, payload.device_id, payload.ante))


@public_router.post("/zhajinhua/action", response_model=ResponseModel[ZhajinhuaState])
async def zhajinhua_action(
    payload: ZhajinhuaActionRequest,
    session: AsyncSession = Depends(get_session),
) -> ResponseModel[ZhajinhuaState]:
    """炸金花动作：look 看牌 / call 跟注 / raise 加注 / fold 弃牌 / compare 比牌；庄家 bot 自动响应。"""
    return ResponseModel(data=await casino_service.zjh_action(session, payload.device_id, payload.action))
