"""agent run trace summary

Revision ID: 20260728_0100
Revises: 20260726_0100
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260728_0100"
down_revision: str | None = "20260726_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_run",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(length=32),
            sa.ForeignKey("agent_session.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner", sa.String(length=64), nullable=True),
        sa.Column("model", sa.String(length=32), nullable=False),
        sa.Column("deep", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reflect", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("auto_model", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="running"),
        sa.Column("tool_names", JSONB(), nullable=False, server_default="[]"),
        sa.Column("tool_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_hit_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_miss_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_run_owner_created", "agent_run", ["owner", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_run_owner_created", table_name="agent_run")
    op.drop_table("agent_run")
