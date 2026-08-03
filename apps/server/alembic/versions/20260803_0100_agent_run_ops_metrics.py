"""Persist bounded external-research metadata for safe Agent operations metrics.

Revision ID: 20260803_0100
Revises: 20260730_0100
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260803_0100"
down_revision: str | None = "20260730_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_run", sa.Column("external_research_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "agent_run", sa.Column("external_research_capped", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.create_index("ix_agent_run_created", "agent_run", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_run_created", table_name="agent_run")
    op.drop_column("agent_run", "external_research_capped")
    op.drop_column("agent_run", "external_research_count")
