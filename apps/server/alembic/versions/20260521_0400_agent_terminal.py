"""agent + terminal_session

Revision ID: 20260521_0400
Revises: 20260521_0300
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260521_0400"
down_revision: str | None = "20260521_0300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("token_sha256", sa.String(length=64), nullable=False, unique=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "terminal_session",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bytes_in", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bytes_out", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unlock_method", sa.String(length=16), nullable=False),
        sa.Column("voice_transcript", sa.String(length=200), nullable=True),
        sa.Column("client_ip", sa.String(length=64), nullable=True),
        sa.Column("client_ua", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_terminal_session_agent_opened", "terminal_session", ["agent_id", "opened_at"])


def downgrade() -> None:
    op.drop_index("ix_terminal_session_agent_opened", table_name="terminal_session")
    op.drop_table("terminal_session")
    op.drop_table("agent")
