"""analytics: page_view

Revision ID: 20260521_0200
Revises: 20260521_0000
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260521_0200"
down_revision: str | None = "20260521_0000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_view",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("referrer", sa.String(length=500), nullable=True),
        sa.Column("country", sa.String(length=8), nullable=True),
        sa.Column("browser", sa.String(length=32), nullable=True),
        sa.Column("os", sa.String(length=32), nullable=True),
        sa.Column("is_mobile", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visitor_hash", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_page_view_ts", "page_view", ["ts"])
    op.create_index("ix_page_view_path_ts", "page_view", ["path", "ts"])
    op.create_index("ix_page_view_visitor_hash", "page_view", ["visitor_hash"])


def downgrade() -> None:
    op.drop_index("ix_page_view_visitor_hash", table_name="page_view")
    op.drop_index("ix_page_view_path_ts", table_name="page_view")
    op.drop_index("ix_page_view_ts", table_name="page_view")
    op.drop_table("page_view")
