"""Analytics conversion events.

Revision ID: 20260813_0100
Revises: 20260803_0100
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260813_0100"
down_revision: str | None = "20260803_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversion_event",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("visitor_hash", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_conversion_event_name_ts", "conversion_event", ["name", "ts"])


def downgrade() -> None:
    op.drop_index("ix_conversion_event_name_ts", table_name="conversion_event")
    op.drop_table("conversion_event")
