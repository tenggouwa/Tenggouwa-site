"""pi monitoring probe: pi_probe

Revision ID: 20260623_0100
Revises: 20260618_0300
Create Date: 2026-06-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260623_0100"
down_revision: str | None = "20260618_0300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pi_probe",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=16), nullable=False, server_default=""),
    )
    op.create_index("ix_pi_probe_name_ts", "pi_probe", ["name", "ts"])


def downgrade() -> None:
    op.drop_index("ix_pi_probe_name_ts", table_name="pi_probe")
    op.drop_table("pi_probe")
