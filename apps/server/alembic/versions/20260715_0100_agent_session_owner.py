"""agent_session 加 owner 列（会话归属，供「我的会话」列表 + 续聊，防跨通道读私有历史）

Revision ID: 20260715_0100
Revises: 20260709_0200
Create Date: 2026-07-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260715_0100"
down_revision: str | None = "20260709_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # owner 为空 = 公开/匿名会话；非空 = 私有通道该 owner 所有（既往会话都置 NULL）。
    op.add_column("agent_session", sa.Column("owner", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_agent_session_owner_updated",
        "agent_session",
        ["owner", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_session_owner_updated", table_name="agent_session")
    op.drop_column("agent_session", "owner")
