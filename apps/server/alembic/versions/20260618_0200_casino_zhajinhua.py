"""casino: casino_zhajinhua (in-progress multi-round games)

Revision ID: 20260618_0200
Revises: 20260618_0100
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260618_0200"
down_revision: str | None = "20260618_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "casino_zhajinhua",
        sa.Column("device_id", sa.String(length=64), primary_key=True),
        sa.Column("ante", sa.BigInteger(), nullable=False),
        sa.Column("pot", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("player_paid", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("dealer_paid", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cur_stake", sa.BigInteger(), nullable=False),
        sa.Column("looked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("round", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("player", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dealer", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("casino_zhajinhua")
