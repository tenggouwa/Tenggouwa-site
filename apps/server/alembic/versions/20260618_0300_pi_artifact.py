"""pi daily artifact: pi_artifact

Revision ID: 20260618_0300
Revises: 20260618_0200
Create Date: 2026-06-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260618_0300"
down_revision: str | None = "20260618_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pi_artifact",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )
    op.create_index("ix_pi_artifact_ts", "pi_artifact", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_pi_artifact_ts", table_name="pi_artifact")
    op.drop_table("pi_artifact")
