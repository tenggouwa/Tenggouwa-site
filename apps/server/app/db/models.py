"""ORM 模型集中定义。

所有业务表都集中在 `db/models.py`，避免每个业务模块各自定义 Base 导致
Alembic autogenerate 看不到。Pydantic schema 仍然放在各业务模块的 `schema.py`。
"""

from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, func
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
