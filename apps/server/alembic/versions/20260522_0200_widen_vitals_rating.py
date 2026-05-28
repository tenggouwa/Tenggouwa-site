"""widen web_vitals.rating 16 → 32

web-vitals 库的 rating 取值含 'needs-improvement'（17 字符），
原本 VARCHAR(16) 装不下，触发 StringDataRightTruncationError。

Revision ID: 20260522_0200
Revises: 20260522_0100
Create Date: 2026-05-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260522_0200"
down_revision: str | None = "20260522_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "web_vitals",
        "rating",
        existing_type=sa.String(length=16),
        type_=sa.String(length=32),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "web_vitals",
        "rating",
        existing_type=sa.String(length=32),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
