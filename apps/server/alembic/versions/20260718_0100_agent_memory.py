"""agent 长期记忆：agent_memory（owner 维度、跨会话，带 pgvector embedding）

Revision ID: 20260718_0100
Revises: 20260716_0100
Create Date: 2026-07-18

记忆表按 owner 过滤后每人至多几十条 → 向量扫描量极小，不建 hnsw（省写入成本）；
owner+created_at 复合索引够用（召回先按 owner 圈定，再在小集合内算距离）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "20260718_0100"
down_revision: str | None = "20260716_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_memory",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_agent_memory_owner", "agent_memory", ["owner", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_memory_owner", table_name="agent_memory")
    op.drop_table("agent_memory")
