"""casino: casino_mines (in-progress mines games)

Revision ID: 20260618_0100
Revises: 20260617_0400
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260618_0100"
down_revision: str | None = "20260617_0400"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "casino_mines",
        sa.Column("device_id", sa.String(length=64), primary_key=True),
        sa.Column("bet", sa.BigInteger(), nullable=False),
        sa.Column("mines", sa.Integer(), nullable=False),
        sa.Column("mine_positions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("revealed", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("casino_mines")
