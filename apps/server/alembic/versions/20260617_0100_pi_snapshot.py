"""pi telemetry: pi_snapshot

Revision ID: 20260617_0100
Revises: 20260525_0100
Create Date: 2026-06-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260617_0100"
down_revision: str | None = "20260525_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pi_snapshot",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("hostname", sa.String(length=64), nullable=False),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )
    op.create_index("ix_pi_snapshot_ts", "pi_snapshot", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_pi_snapshot_ts", table_name="pi_snapshot")
    op.drop_table("pi_snapshot")
