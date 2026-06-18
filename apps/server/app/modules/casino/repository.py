"""反赌模拟器持久化层。PostgreSQL + SQLAlchemy 2.0 async。"""

from dataclasses import dataclass

from db.models import (
    CasinoBlackjackRow,
    CasinoMinesRow,
    CasinoRoundRow,
    CasinoWalletRow,
    CasinoZhajinhuaRow,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class GameAggregate:
    game: str
    rounds: int
    total_wagered: int
    total_payout: int


class CasinoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_wallet(self, device_id: str, *, for_update: bool = False) -> CasinoWalletRow | None:
        stmt = select(CasinoWalletRow).where(CasinoWalletRow.device_id == device_id)
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_or_create_wallet(self, device_id: str, *, initial_balance: int) -> CasinoWalletRow:
        """取钱包，没有则按初始积分建一个。并发首次请求撞 PK 时回查已存在的那行。"""
        row = await self.get_wallet(device_id, for_update=True)
        if row is not None:
            return row
        row = CasinoWalletRow(device_id=device_id, balance=initial_balance)
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            existing = await self.get_wallet(device_id, for_update=True)
            assert existing is not None
            return existing
        return row

    async def add_round(
        self,
        *,
        device_id: str,
        game: str,
        bet_amount: int,
        bet_detail: dict,
        payout: int,
        net: int,
        balance_after: int,
        rng_detail: dict,
    ) -> CasinoRoundRow:
        row = CasinoRoundRow(
            device_id=device_id,
            game=game,
            bet_amount=bet_amount,
            bet_detail=bet_detail,
            payout=payout,
            net=net,
            balance_after=balance_after,
            rng_detail=rng_detail,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def list_rounds(self, device_id: str, *, limit: int) -> list[CasinoRoundRow]:
        """按时间正序取该玩家最近 limit 局（画曲线用）。

        取最新 limit 条后翻转为正序：玩了很多局时只画最近窗口，避免一次拉全历史。
        """
        stmt = (
            select(CasinoRoundRow)
            .where(CasinoRoundRow.device_id == device_id)
            .order_by(CasinoRoundRow.id.desc())
            .limit(limit)
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return list(reversed(rows))

    async def rounds_before(self, device_id: str, first_id: int) -> int:
        """first_id 这条之前该玩家已玩了多少局（给曲线点编号当偏移量）。"""
        stmt = (
            select(func.count())
            .select_from(CasinoRoundRow)
            .where(CasinoRoundRow.device_id == device_id, CasinoRoundRow.id < first_id)
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def aggregate_by_game(self) -> list[GameAggregate]:
        stmt = (
            select(
                CasinoRoundRow.game,
                func.count().label("rounds"),
                func.coalesce(func.sum(CasinoRoundRow.bet_amount), 0).label("wagered"),
                func.coalesce(func.sum(CasinoRoundRow.payout), 0).label("payout"),
            )
            .group_by(CasinoRoundRow.game)
            .order_by(CasinoRoundRow.game)
        )
        rows = (await self.session.execute(stmt)).all()
        return [
            GameAggregate(game=r.game, rounds=r.rounds, total_wagered=r.wagered, total_payout=r.payout) for r in rows
        ]

    async def count_players(self) -> int:
        return (await self.session.execute(select(func.count()).select_from(CasinoWalletRow))).scalar_one()

    # —— 21 点进行中牌局 ——

    async def get_blackjack(self, device_id: str) -> CasinoBlackjackRow | None:
        return await self.session.get(CasinoBlackjackRow, device_id)

    async def upsert_blackjack(
        self,
        *,
        device_id: str,
        bet: int,
        doubled: bool,
        player: list[dict],
        dealer: list[dict],
        shoe: list[dict],
        status: str,
    ) -> CasinoBlackjackRow:
        row = await self.session.get(CasinoBlackjackRow, device_id)
        if row is None:
            row = CasinoBlackjackRow(device_id=device_id)
            self.session.add(row)
        row.bet = bet
        row.doubled = doubled
        row.player = player
        row.dealer = dealer
        row.shoe = shoe
        row.status = status
        await self.session.flush()
        return row

    # —— Mines 进行中牌局 ——

    async def get_mines(self, device_id: str) -> CasinoMinesRow | None:
        return await self.session.get(CasinoMinesRow, device_id)

    async def upsert_mines(
        self,
        *,
        device_id: str,
        bet: int,
        mines: int,
        mine_positions: list[int],
        revealed: list[int],
        status: str,
    ) -> CasinoMinesRow:
        row = await self.session.get(CasinoMinesRow, device_id)
        if row is None:
            row = CasinoMinesRow(device_id=device_id)
            self.session.add(row)
        row.bet = bet
        row.mines = mines
        row.mine_positions = mine_positions
        row.revealed = revealed
        row.status = status
        await self.session.flush()
        return row

    # —— 炸金花进行中牌局 ——

    async def get_zhajinhua(self, device_id: str) -> CasinoZhajinhuaRow | None:
        return await self.session.get(CasinoZhajinhuaRow, device_id)

    async def save_zhajinhua(self, row: CasinoZhajinhuaRow) -> None:
        self.session.add(row)
        await self.session.flush()

    def new_zhajinhua(self, **kwargs) -> CasinoZhajinhuaRow:
        return CasinoZhajinhuaRow(**kwargs)
