"""admin_totp

Revision ID: 20260521_0300
Revises: 20260521_0200
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260521_0300"
down_revision: str | None = "20260521_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_totp",
        sa.Column("username", sa.String(length=64), primary_key=True),
        sa.Column("secret_b32", sa.String(length=64), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_table("admin_totp")
