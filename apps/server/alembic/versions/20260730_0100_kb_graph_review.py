"""KB graph review workflow and disabled relations.

Revision ID: 20260730_0100
Revises: 20260728_0100
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260730_0100"
down_revision: str | None = "20260728_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("kb_relation", sa.Column("disabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "kb_graph_review",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default="{}"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(length=64), nullable=False),
        sa.Column("resolved_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_kb_graph_review_status_created", "kb_graph_review", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_kb_graph_review_status_created", table_name="kb_graph_review")
    op.drop_table("kb_graph_review")
    op.drop_column("kb_relation", "disabled")
