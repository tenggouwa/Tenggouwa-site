"""ORM 模型集中定义。

所有业务表都集中在 `db/models.py`，避免每个业务模块各自定义 Base 导致
Alembic autogenerate 看不到。Pydantic schema 仍然放在各业务模块的 `schema.py`。
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .pg import Base


class PostRow(Base):
    __tablename__ = "post"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (Index("ix_post_published_at", "published_at"),)


class InspirationRow(Base):
    __tablename__ = "inspiration"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mood: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (Index("ix_inspiration_created_at", "created_at"),)


class AdminTotpRow(Base):
    """每个管理员一行；secret 已存就是已生成，enrolled_at 不为 NULL 才算正式启用。"""

    __tablename__ = "admin_totp"

    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    secret_b32: Mapped[str] = mapped_column(String(64), nullable=False)
    enrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    disabled: Mapped[bool] = mapped_column(nullable=False, default=False)


class AgentRow(Base):
    """终端 agent（一台 Mac 一个）。token 只存哈希。"""

    __tablename__ = "agent"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    token_sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    owner: Mapped[str] = mapped_column(String(64), nullable=False)  # admin 用户名
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class TerminalSessionRow(Base):
    """每次终端开启一行，便于审计。"""

    __tablename__ = "terminal_session"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_id: Mapped[int] = mapped_column(nullable=False)
    owner: Mapped[str] = mapped_column(String(64), nullable=False)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    bytes_in: Mapped[int] = mapped_column(nullable=False, default=0)
    bytes_out: Mapped[int] = mapped_column(nullable=False, default=0)
    unlock_method: Mapped[str] = mapped_column(String(16), nullable=False)  # 'voice' | 'totp'
    voice_transcript: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_ua: Mapped[str | None] = mapped_column(String(500), nullable=True)


class PageViewRow(Base):
    """埋点 PV 表。每个页面浏览写一行；UV 通过 (visitor_hash, ts::date) 去重得出。"""

    __tablename__ = "page_view"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)  # CF-IPCountry 两位国家码
    browser: Mapped[str | None] = mapped_column(String(32), nullable=True)
    os: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_mobile: Mapped[bool] = mapped_column(nullable=False, default=False)
    # sha256(ip + ua + YYYYMMDD)[:32]：当日 UV 去重用，不存 IP / UA
    visitor_hash: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        Index("ix_page_view_ts", "ts"),
        Index("ix_page_view_path_ts", "path", "ts"),
        Index("ix_page_view_visitor_hash", "visitor_hash"),
    )


class WebVitalsRow(Base):
    """真实用户上报的 Core Web Vitals。每条指标一行，按 p75 在查询时聚合。"""

    __tablename__ = "web_vitals"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    metric: Mapped[str] = mapped_column(String(16), nullable=False)  # LCP | CLS | INP | FCP | TTFB
    value: Mapped[float] = mapped_column(nullable=False)
    rating: Mapped[str] = mapped_column(String(32), nullable=False)  # good | needs-improvement | poor
    nav_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_mobile: Mapped[bool] = mapped_column(nullable=False, default=False)
    visitor_hash: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        Index("ix_web_vitals_ts", "ts"),
        Index("ix_web_vitals_metric_ts", "metric", "ts"),
        Index("ix_web_vitals_path_ts", "path", "ts"),
    )


class PiSnapshotRow(Base):
    """树莓派 pi-agent 上报的一条遥测快照。

    每次上报写一行；最新一行 = 当前状态，online/offline 在查询时按 ts 与
    now 的差值判定。指标体本身放 JSONB，方便后续模块往里加字段不用迁移。
    """

    __tablename__ = "pi_snapshot"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    hostname: Mapped[str] = mapped_column(String(64), nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (Index("ix_pi_snapshot_ts", "ts"),)


class CasinoWalletRow(Base):
    """反赌模拟器：一个匿名 device_id 一行钱包。

    积分纯计数、无任何充提功能。初始固定 INITIAL_BALANCE；输光后可 /claim 重领，
    reclaim_count 累计重领次数。total_wagered / total_payout 累计所有局，用于个人
    净值与全站真实赔率统计。
    """

    __tablename__ = "casino_wallet"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reclaim_count: Mapped[int] = mapped_column(nullable=False, default=0)
    total_wagered: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_payout: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    rounds_played: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CasinoRoundRow(Base):
    """反赌模拟器：每下一注落一行。

    bet_detail / rng_detail 放 JSONB（不同游戏字段不同，加游戏不用迁移）。RNG 一律
    后端权威生成，前端只负责把动画演到 rng_detail 描述的结果。net = payout - bet_amount。
    """

    __tablename__ = "casino_round"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    game: Mapped[str] = mapped_column(String(16), nullable=False)  # dice | roulette | slots | baccarat | blackjack
    bet_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bet_detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    payout: Mapped[int] = mapped_column(BigInteger, nullable=False)  # 赢得返还（含本金口径见 service），输为 0
    net: Mapped[int] = mapped_column(BigInteger, nullable=False)  # payout - bet_amount
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rng_detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_casino_round_device_id", "device_id", "id"),
        Index("ix_casino_round_game", "game"),
    )


class CasinoBlackjackRow(Base):
    """反赌模拟器：每个 device_id 一局进行中的 21 点牌局（多步交互）。

    发牌时一次性把牌靴(shoe)定好存下，后续 hit/stand 从 shoe 顺序抽——RNG 在发牌那刻
    就固定，客户端无法影响后续牌。一局结束(status=done)后下次 deal 覆盖本行。
    """

    __tablename__ = "casino_blackjack"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    bet: Mapped[int] = mapped_column(BigInteger, nullable=False)
    doubled: Mapped[bool] = mapped_column(nullable=False, default=False)
    player: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    dealer: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    shoe: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # player_turn | done
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CasinoMinesRow(Base):
    """反赌模拟器：每个 device_id 一局进行中的 Mines 扫雷（多步交互）。

    开局一次性把地雷位置定好存下，翻格时只对比已存的雷位（后端权威，客户端不能改）。
    一局结束(status=done)后下次 start 覆盖本行。
    """

    __tablename__ = "casino_mines"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    bet: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mines: Mapped[int] = mapped_column(nullable=False)  # 雷数
    mine_positions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    revealed: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # 已翻开的安全格
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # active | done
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class CasinoZhajinhuaRow(Base):
    """反赌模拟器：每个 device_id 一局进行中的炸金花（多轮对庄博弈）。

    开局发牌即定（闲庄各 3 张，存下），后续闷/看/跟/加/比都不改牌。一局结束(status=done)
    后下次 start 覆盖本行。
    """

    __tablename__ = "casino_zhajinhua"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ante: Mapped[int] = mapped_column(BigInteger, nullable=False)
    pot: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    player_paid: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    dealer_paid: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    cur_stake: Mapped[int] = mapped_column(BigInteger, nullable=False)
    looked: Mapped[bool] = mapped_column(nullable=False, default=False)
    round: Mapped[int] = mapped_column(nullable=False, default=1)
    player: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    dealer: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # active | done
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SeoSearchSnapshotRow(Base):
    """每日搜索引擎收录 / 流量快照。GSC / 百度 / Bing 定时任务每天写一批。"""

    __tablename__ = "seo_search_snapshot"

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # google | bing | baidu
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    impressions: Mapped[int] = mapped_column(nullable=False, default=0)
    clicks: Mapped[int] = mapped_column(nullable=False, default=0)
    ctr: Mapped[float] = mapped_column(nullable=False, default=0.0)
    position: Mapped[float] = mapped_column(nullable=False, default=0.0)
    top_queries: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    indexed: Mapped[bool] = mapped_column(nullable=False, default=False)

    __table_args__ = (
        Index("ix_seo_snapshot_date_channel", "snapshot_date", "channel"),
        Index("ix_seo_snapshot_url", "url"),
    )
