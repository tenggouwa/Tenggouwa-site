"""KB 概念图谱：kb_entity / kb_relation + provenance 链接表，kb_document 加 graph_hash

Revision ID: 20260716_0100
Revises: 20260715_0100
Create Date: 2026-07-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260716_0100"
down_revision: str | None = "20260715_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 抽取用的增量水位：与嵌入的 content_hash 各自独立（抽取要调 LLM，贵，不该跟着嵌入白跑）
    op.add_column("kb_document", sa.Column("graph_hash", sa.String(length=64), nullable=True))

    op.create_table(
        "kb_entity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("norm_key", sa.String(length=120), nullable=False, unique=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "kb_entity_doc",
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("kb_entity.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("kb_document.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "kb_relation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("kb_entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("kb_entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("uq_kb_relation_triple", "kb_relation", ["source_id", "target_id", "type"], unique=True)
    op.create_table(
        "kb_relation_doc",
        sa.Column("relation_id", sa.Integer(), sa.ForeignKey("kb_relation.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("kb_document.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("kb_relation_doc")
    op.drop_index("uq_kb_relation_triple", table_name="kb_relation")
    op.drop_table("kb_relation")
    op.drop_table("kb_entity_doc")
    op.drop_table("kb_entity")
    op.drop_column("kb_document", "graph_hash")
