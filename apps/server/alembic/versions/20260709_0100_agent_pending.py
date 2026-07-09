"""agent: agent_session 加 pending 列（C2 交互审批的待批工具暂存）

Revision ID: 20260709_0100
Revises: 20260708_0100
Create Date: 2026-07-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260709_0100"
down_revision: str | None = "20260708_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_session", sa.Column("pending", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_session", "pending")
