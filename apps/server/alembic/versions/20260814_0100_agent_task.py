"""agent: durable owner task state.

Revision ID: 20260814_0100
Revises: 20260803_0100
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260814_0100"
down_revision: str | None = "20260813_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_task",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "session_id", sa.String(length=32), sa.ForeignKey("agent_session.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", JSONB(), nullable=False, server_default="{}"),
        sa.Column("run_id", sa.BigInteger(), sa.ForeignKey("agent_run.id", ondelete="SET NULL"), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_task_owner_created", "agent_task", ["owner", "created_at"])
    op.create_index("ix_agent_task_status", "agent_task", ["status"])
    op.create_table(
        "agent_task_event",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("task_id", sa.String(length=32), sa.ForeignKey("agent_task.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("data", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("task_id", "seq", name="uq_agent_task_event_seq"),
    )


def downgrade() -> None:
    op.drop_table("agent_task_event")
    op.drop_index("ix_agent_task_status", table_name="agent_task")
    op.drop_index("ix_agent_task_owner_created", table_name="agent_task")
    op.drop_table("agent_task")
