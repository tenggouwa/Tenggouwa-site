"""casino: casino_blackjack (in-progress hands)

Revision ID: 20260617_0400
Revises: 20260617_0300
Create Date: 2026-06-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260617_0400"
down_revision: str | None = "20260617_0300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "casino_blackjack",
        sa.Column("device_id", sa.String(length=64), primary_key=True),
        sa.Column("bet", sa.BigInteger(), nullable=False),
        sa.Column("doubled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("player", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dealer", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("shoe", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("casino_blackjack")
