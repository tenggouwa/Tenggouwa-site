"""agent 自提技能提案：agent_skill_proposal（owner 维度）

Revision ID: 20260725_0100
Revises: 20260724_0100
Create Date: 2026-07-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260725_0100"
down_revision: str | None = "20260724_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_skill_proposal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("parameters", JSONB(), nullable=False, server_default="{}"),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agent_skill_proposal_owner", "agent_skill_proposal", ["owner", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_skill_proposal_owner", table_name="agent_skill_proposal")
    op.drop_table("agent_skill_proposal")
