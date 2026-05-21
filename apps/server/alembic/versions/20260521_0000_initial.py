"""initial: post + inspiration

Revision ID: 20260521_0000
Revises:
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521_0000"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "post",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("slug", sa.String(length=120), nullable=False, unique=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_post_published_at", "post", ["published_at"], unique=False)

    op.create_table(
        "inspiration",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("mood", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_inspiration_created_at", "inspiration", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_inspiration_created_at", table_name="inspiration")
    op.drop_table("inspiration")
    op.drop_index("ix_post_published_at", table_name="post")
    op.drop_table("post")
