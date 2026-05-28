"""seo: web_vitals + search snapshot

Revision ID: 20260522_0100
Revises: 20260521_0400
Create Date: 2026-05-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260522_0100"
down_revision: str | None = "20260521_0400"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "web_vitals",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("metric", sa.String(length=16), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("rating", sa.String(length=16), nullable=False),
        sa.Column("nav_type", sa.String(length=32), nullable=True),
        sa.Column("is_mobile", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visitor_hash", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_web_vitals_ts", "web_vitals", ["ts"])
    op.create_index("ix_web_vitals_metric_ts", "web_vitals", ["metric", "ts"])
    op.create_index("ix_web_vitals_path_ts", "web_vitals", ["path", "ts"])

    op.create_table(
        "seo_search_snapshot",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("snapshot_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("impressions", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("clicks", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("ctr", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("position", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "top_queries",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("indexed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "ix_seo_snapshot_date_channel",
        "seo_search_snapshot",
        ["snapshot_date", "channel"],
    )
    op.create_index("ix_seo_snapshot_url", "seo_search_snapshot", ["url"])


def downgrade() -> None:
    op.drop_index("ix_seo_snapshot_url", table_name="seo_search_snapshot")
    op.drop_index("ix_seo_snapshot_date_channel", table_name="seo_search_snapshot")
    op.drop_table("seo_search_snapshot")

    op.drop_index("ix_web_vitals_path_ts", table_name="web_vitals")
    op.drop_index("ix_web_vitals_metric_ts", table_name="web_vitals")
    op.drop_index("ix_web_vitals_ts", table_name="web_vitals")
    op.drop_table("web_vitals")
