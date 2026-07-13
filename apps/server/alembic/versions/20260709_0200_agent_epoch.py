"""admin_totp 加 agent_epoch 列（agent_token 吊销纪元，"注销所有会话"）

Revision ID: 20260709_0200
Revises: 20260709_0100
Create Date: 2026-07-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260709_0200"
down_revision: str | None = "20260709_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "admin_totp",
        sa.Column("agent_epoch", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("admin_totp", "agent_epoch")
