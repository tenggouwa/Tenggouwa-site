"""casino: casino_wallet + casino_round

Revision ID: 20260617_0300
Revises: 20260617_0100
Create Date: 2026-06-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260617_0300"
down_revision: str | None = "20260617_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "casino_wallet",
        sa.Column("device_id", sa.String(length=64), primary_key=True),
        sa.Column("balance", sa.BigInteger(), nullable=False),
        sa.Column("reclaim_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_wagered", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_payout", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("rounds_played", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "casino_round",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("game", sa.String(length=16), nullable=False),
        sa.Column("bet_amount", sa.BigInteger(), nullable=False),
        sa.Column("bet_detail", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payout", sa.BigInteger(), nullable=False),
        sa.Column("net", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("rng_detail", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_casino_round_device_id", "casino_round", ["device_id", "id"])
    op.create_index("ix_casino_round_game", "casino_round", ["game"])


def downgrade() -> None:
    op.drop_index("ix_casino_round_game", table_name="casino_round")
    op.drop_index("ix_casino_round_device_id", table_name="casino_round")
    op.drop_table("casino_round")
    op.drop_table("casino_wallet")
