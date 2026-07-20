"""Enforce one message per sequence number in an agent session.

Revision ID: 20260720_0100
Revises: 20260718_0100
Create Date: 2026-07-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260720_0100"
down_revision: str | None = "20260718_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_agent_message_session_seq", table_name="agent_message")
    op.create_index("ix_agent_message_session_seq", "agent_message", ["session_id", "seq"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_agent_message_session_seq", table_name="agent_message")
    op.create_index("ix_agent_message_session_seq", "agent_message", ["session_id", "seq"], unique=False)
