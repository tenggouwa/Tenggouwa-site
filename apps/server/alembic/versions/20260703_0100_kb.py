"""kb: 个人知识库 source/document/chunk（v0 无嵌入，检索走 pg_trgm）

Revision ID: 20260703_0100
Revises: 20260625_0100
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260703_0100"
down_revision: str | None = "20260625_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pg_trgm 已在 20260525_0100 启用；这里 defensively 再声明一次。
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "kb_source",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("uq_kb_source_kind_name", "kb_source", ["kind", "name"], unique=True)

    op.create_table(
        "kb_document",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "source_id",
            sa.Integer(),
            sa.ForeignKey("kb_source.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("raw_md", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("uq_kb_document_source_ext", "kb_document", ["source_id", "external_id"], unique=True)

    op.create_table(
        "kb_chunk",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("kb_document.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ord", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        # embedding VECTOR(<dim>) 列 v0 不建；升级混合检索时再 ALTER TABLE 加。
    )
    op.create_index("uq_kb_chunk_doc_ord", "kb_chunk", ["document_id", "ord"], unique=True)
    # trigram GIN：让 kb_chunk.content 的 ILIKE / word_similarity 走索引（对中文友好）。
    op.execute("CREATE INDEX ix_kb_chunk_content_trgm ON kb_chunk USING gin (content gin_trgm_ops)")


def downgrade() -> None:
    op.drop_table("kb_chunk")
    op.drop_table("kb_document")
    op.drop_table("kb_source")
