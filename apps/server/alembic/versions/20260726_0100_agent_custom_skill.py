"""owner 自定义 skill：agent_custom_skill（http / prompt 两种执行体）

Revision ID: 20260726_0100
Revises: 20260725_0100
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "20260726_0100"
down_revision: str | None = "20260725_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_custom_skill",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("parameters", JSONB(), nullable=False, server_default="{}"),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("uq_agent_custom_skill_owner_name", "agent_custom_skill", ["owner", "name"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_agent_custom_skill_owner_name", table_name="agent_custom_skill")
    op.drop_table("agent_custom_skill")
