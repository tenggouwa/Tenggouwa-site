"""agent_inbox：主动/定时任务产出的收件箱（owner 维度）

Revision ID: 20260722_0100
Revises: 20260718_0100
Create Date: 2026-07-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260722_0100"
down_revision: str | None = "20260718_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_inbox",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_inbox_owner_created", "agent_inbox", ["owner", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_inbox_owner_created", table_name="agent_inbox")
    op.drop_table("agent_inbox")
