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
