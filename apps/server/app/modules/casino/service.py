"""反赌模拟器业务逻辑。

立意：用纯计数积分跑真实赔率的赌场游戏，记录每个人的输赢轨迹，并把全站聚合的
"实测概率 vs 理论庄家优势"摆出来，用数据展示长期必输。RNG 全在后端（games.py），
前端只演动画。
"""

import logging

from dependencies import DetailedHTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from . import blackjack, games
from .repository import CasinoRepository
from .schema import (
    BlackjackState,
    CurvePoint,
    CurveResponse,
    GameStat,
    PlayRequest,
    PlayResult,
    StatsSummary,
    Wallet,
)

logger = logging.getLogger(__name__)

# 每个 device_id 首次进来 / 输光重领时发的固定积分。纯计数，无任何充提含义。
INITIAL_BALANCE = 1000
# 曲线最多画多少局（只画最近窗口，避免一次拉全历史）。
CURVE_MAX_POINTS = 500


def _to_wallet(row) -> Wallet:
    return Wallet(
        device_id=row.device_id,
        balance=row.balance,
        reclaim_count=row.reclaim_count,
        total_wagered=row.total_wagered,
        total_payout=row.total_payout,
        net=row.total_payout - row.total_wagered,
        rounds_played=row.rounds_played,
    )


class CasinoService:
    async def get_wallet(self, session: AsyncSession, device_id: str) -> Wallet:
        repo = CasinoRepository(session)
        row = await repo.get_or_create_wallet(device_id, initial_balance=INITIAL_BALANCE)
        return _to_wallet(row)

    async def claim(self, session: AsyncSession, device_id: str) -> Wallet:
        """重置积分到固定初始值，随时可点。reclaim_count 累计重置次数——这本身就是教育数据：
        你按了多少次"再来一局"。"""
        repo = CasinoRepository(session)
        row = await repo.get_or_create_wallet(device_id, initial_balance=INITIAL_BALANCE)
        row.balance = INITIAL_BALANCE
        row.reclaim_count += 1
        return _to_wallet(row)

    async def play(self, session: AsyncSession, payload: PlayRequest) -> PlayResult:
        repo = CasinoRepository(session)
        wallet = await repo.get_or_create_wallet(payload.device_id, initial_balance=INITIAL_BALANCE)

        if payload.bet_amount > wallet.balance:
            raise DetailedHTTPException(
                status_code=400,
                detail="积分不足",
                full_detail=f"bet={payload.bet_amount} balance={wallet.balance}",
            )

        try:
            outcome = games.play(payload.game, payload.bet_amount, payload.bet_detail)
        except games.GameError as e:
            raise DetailedHTTPException(status_code=400, detail=str(e), full_detail=str(e)) from e

        net = outcome.payout - payload.bet_amount
        wallet.balance = wallet.balance - payload.bet_amount + outcome.payout
        wallet.total_wagered += payload.bet_amount
        wallet.total_payout += outcome.payout
        wallet.rounds_played += 1

        await repo.add_round(
            device_id=payload.device_id,
            game=payload.game,
            bet_amount=payload.bet_amount,
            bet_detail=payload.bet_detail,
            payout=outcome.payout,
            net=net,
            balance_after=wallet.balance,
            rng_detail=outcome.rng_detail,
        )

        return PlayResult(
            game=payload.game,
            bet_amount=payload.bet_amount,
            payout=outcome.payout,
            net=net,
            outcome="win" if net > 0 else "lose",
            rng_detail=outcome.rng_detail,
            balance_after=wallet.balance,
        )

    async def curve(self, session: AsyncSession, device_id: str) -> CurveResponse:
        repo = CasinoRepository(session)
        wallet = await repo.get_or_create_wallet(device_id, initial_balance=INITIAL_BALANCE)
        rows = await repo.list_rounds(device_id, limit=CURVE_MAX_POINTS)
        offset = await repo.rounds_before(device_id, rows[0].id) if rows else 0
        points = [
            CurvePoint(
                round_index=offset + i + 1,
                balance_after=r.balance_after,
                net=r.net,
                game=r.game,
                created_at=r.created_at,
            )
            for i, r in enumerate(rows)
        ]
        return CurveResponse(device_id=device_id, wallet=_to_wallet(wallet), points=points)

    async def stats(self, session: AsyncSession) -> StatsSummary:
        repo = CasinoRepository(session)
        aggregates = await repo.aggregate_by_game()
        players = await repo.count_players()

        game_stats: list[GameStat] = []
        total_rounds = 0
        total_wagered = 0
        total_payout = 0
        for agg in aggregates:
            rtp = agg.total_payout / agg.total_wagered if agg.total_wagered else None
            game_stats.append(
                GameStat(
                    game=agg.game,
                    rounds=agg.rounds,
                    total_wagered=agg.total_wagered,
                    total_payout=agg.total_payout,
                    observed_rtp=rtp,
                    observed_house_edge=(1 - rtp) if rtp is not None else None,
                    theoretical_house_edge=games.THEORETICAL_HOUSE_EDGE.get(agg.game, 0.0),
                )
            )
            total_rounds += agg.rounds
            total_wagered += agg.total_wagered
            total_payout += agg.total_payout

        return StatsSummary(
            games=game_stats,
            total_rounds=total_rounds,
            total_players=players,
            total_wagered=total_wagered,
            total_payout=total_payout,
        )

    # —— 21 点（多步） ——

    async def bj_deal(self, session: AsyncSession, device_id: str, bet_amount: int) -> BlackjackState:
        repo = CasinoRepository(session)
        wallet = await repo.get_or_create_wallet(device_id, initial_balance=INITIAL_BALANCE)

        # 有未打完的旧局：退回其押注，重新开局。
        existing = await repo.get_blackjack(device_id)
        if existing is not None and existing.status == "player_turn":
            wallet.balance += existing.bet * (2 if existing.doubled else 1)

        if bet_amount > wallet.balance:
            raise DetailedHTTPException(status_code=400, detail="积分不足", full_detail=f"bet={bet_amount}")
        wallet.balance -= bet_amount  # 押注托管

        shoe = blackjack.make_shoe()
        player = [shoe.pop(0), shoe.pop(0)]
        dealer = [shoe.pop(0), shoe.pop(0)]

        if blackjack.is_blackjack(player) or blackjack.is_blackjack(dealer):
            p, d = blackjack.is_blackjack(player), blackjack.is_blackjack(dealer)
            result = "push" if p and d else ("player_blackjack" if p else "dealer")
            return await self._bj_finish(repo, wallet, device_id, bet_amount, False, player, dealer, result)

        row = await repo.upsert_blackjack(
            device_id=device_id,
            bet=bet_amount,
            doubled=False,
            player=player,
            dealer=dealer,
            shoe=shoe,
            status="player_turn",
        )
        return self._bj_state(row, wallet.balance)

    async def bj_action(self, session: AsyncSession, device_id: str, action: str) -> BlackjackState:
        repo = CasinoRepository(session)
        wallet = await repo.get_or_create_wallet(device_id, initial_balance=INITIAL_BALANCE)
        row = await repo.get_blackjack(device_id)
        if row is None or row.status != "player_turn":
            raise DetailedHTTPException(
                status_code=400, detail="没有进行中的牌局", full_detail=f"device_id={device_id}"
            )

        player = list(row.player)
        dealer = list(row.dealer)
        shoe = list(row.shoe)
        bet = row.bet
        doubled = row.doubled

        if action == "double":
            if len(player) != 2:
                raise DetailedHTTPException(status_code=400, detail="只能在前两张牌时双倍", full_detail="")
            if wallet.balance < bet:
                raise DetailedHTTPException(status_code=400, detail="积分不足以双倍", full_detail="")
            wallet.balance -= bet
            doubled = True
            player.append(shoe.pop(0))
            return await self._bj_resolve(repo, wallet, device_id, bet, doubled, player, dealer, shoe)

        if action == "hit":
            player.append(shoe.pop(0))
            if blackjack.hand_total(player) >= 21:  # 21 或爆牌：自动收手 / 结算
                return await self._bj_resolve(repo, wallet, device_id, bet, doubled, player, dealer, shoe)
            row = await repo.upsert_blackjack(
                device_id=device_id,
                bet=bet,
                doubled=doubled,
                player=player,
                dealer=dealer,
                shoe=shoe,
                status="player_turn",
            )
            return self._bj_state(row, wallet.balance)

        # stand
        return await self._bj_resolve(repo, wallet, device_id, bet, doubled, player, dealer, shoe)

    async def _bj_resolve(self, repo, wallet, device_id, bet, doubled, player, dealer, shoe) -> BlackjackState:
        if blackjack.hand_total(player) > 21:
            result = "dealer"  # 爆牌，庄家不用补
        else:
            blackjack.dealer_play(dealer, shoe)
            pt, dt = blackjack.hand_total(player), blackjack.hand_total(dealer)
            result = "player" if dt > 21 or pt > dt else ("dealer" if dt > pt else "push")
        return await self._bj_finish(repo, wallet, device_id, bet, doubled, player, dealer, result)

    async def _bj_finish(self, repo, wallet, device_id, bet, doubled, player, dealer, result) -> BlackjackState:
        stake = bet * (2 if doubled else 1)
        if result == "player_blackjack":
            payout = bet + (bet * 3) // 2  # 3:2
        elif result == "player":
            payout = stake * 2
        elif result == "push":
            payout = stake
        else:
            payout = 0

        wallet.balance += payout
        wallet.total_wagered += stake
        wallet.total_payout += payout
        wallet.rounds_played += 1
        pt, dt = blackjack.hand_total(player), blackjack.hand_total(dealer)
        net = payout - stake
        await repo.add_round(
            device_id=device_id,
            game="blackjack",
            bet_amount=stake,
            bet_detail={"doubled": doubled},
            payout=payout,
            net=net,
            balance_after=wallet.balance,
            rng_detail={"player": player, "dealer": dealer, "player_total": pt, "dealer_total": dt, "result": result},
        )
        await repo.upsert_blackjack(
            device_id=device_id, bet=bet, doubled=doubled, player=player, dealer=dealer, shoe=[], status="done"
        )
        outcome = "win" if net > 0 else ("push" if net == 0 else "lose")
        return BlackjackState(
            status="done",
            player=player,
            dealer=dealer,
            player_total=pt,
            dealer_total=dt,
            can_double=False,
            bet=bet,
            doubled=doubled,
            result=result,
            outcome=outcome,
            payout=payout,
            net=net,
            balance=wallet.balance,
        )

    @staticmethod
    def _bj_state(row, balance: int) -> BlackjackState:
        up = row.dealer[0]
        return BlackjackState(
            status="player_turn",
            player=list(row.player),
            dealer=[up],  # 庄家暗牌不揭
            player_total=blackjack.hand_total(row.player),
            dealer_total=blackjack.hand_total([up]),
            can_double=len(row.player) == 2 and balance >= row.bet,
            bet=row.bet,
            doubled=row.doubled,
            balance=balance,
        )


casino_service = CasinoService()
