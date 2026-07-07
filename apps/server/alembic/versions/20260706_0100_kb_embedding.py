"""kb: 给 kb_chunk 加 pgvector embedding 列 + hnsw 索引（语义混合检索）

Revision ID: 20260706_0100
Revises: 20260703_0100
Create Date: 2026-07-06

需要 postgres 镜像带 pgvector 扩展（docker-compose 已换 pgvector/pgvector:pg16）。
bge-m3 = 1024 维（< pgvector ANN 索引 2000 维上限，故可建 hnsw）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "20260706_0100"
down_revision: str | None = "20260703_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("kb_chunk", sa.Column("embedding", Vector(1024), nullable=True))
    # hnsw 余弦距离索引（1024 维可建）。语料小时精确扫描也行，索引供规模变大后提速。
    op.execute("CREATE INDEX ix_kb_chunk_embedding_hnsw ON kb_chunk USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_chunk_embedding_hnsw")
    op.drop_column("kb_chunk", "embedding")
