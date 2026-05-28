"""enable pg_trgm + trigram GIN indices on post/inspiration for full-text search

Revision ID: 20260525_0100
Revises: 20260522_0200
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260525_0100"
down_revision: str | None = "20260522_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pg_trgm: trigram 模糊匹配 + similarity() 评分。对中文友好（不需要分词）。
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # GIN + gin_trgm_ops 让 ILIKE '%xxx%' 和 similarity() 都能走索引。
    # post 的 tags 是 JSONB，转 text 才能建 trgm 索引。
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_title_trgm ON post USING gin (title gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_summary_trgm ON post USING gin (summary gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_content_trgm ON post USING gin (content gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_tags_trgm ON post USING gin ((tags::text) gin_trgm_ops)")

    op.execute("CREATE INDEX IF NOT EXISTS ix_inspiration_content_trgm ON inspiration USING gin (content gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_inspiration_content_trgm")
    op.execute("DROP INDEX IF EXISTS ix_post_tags_trgm")
    op.execute("DROP INDEX IF EXISTS ix_post_content_trgm")
    op.execute("DROP INDEX IF EXISTS ix_post_summary_trgm")
    op.execute("DROP INDEX IF EXISTS ix_post_title_trgm")
    # pg_trgm 不 drop，其他模块可能也用，留着无害
