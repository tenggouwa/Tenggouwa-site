"""mail_message：一次性收件箱收到的邮件 + 抽取的验证码

Revision ID: 20260724_0100
Revises: 20260722_0100
Create Date: 2026-07-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260724_0100"
down_revision: str | None = "20260722_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mail_message",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("message_id", sa.String(length=512), nullable=False, unique=True),
        sa.Column("to_address", sa.String(length=320), nullable=False),
        sa.Column("mailbox", sa.String(length=255), nullable=False),
        sa.Column("from_address", sa.String(length=320), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("text_body", sa.Text(), nullable=True),
        sa.Column("code", sa.String(length=16), nullable=True),
        sa.Column("code_kind", sa.String(length=16), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mail_message_mailbox_received", "mail_message", ["mailbox", "received_at"])
    op.create_index("ix_mail_message_expires_at", "mail_message", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mail_message_expires_at", table_name="mail_message")
    op.drop_index("ix_mail_message_mailbox_received", table_name="mail_message")
    op.drop_table("mail_message")
