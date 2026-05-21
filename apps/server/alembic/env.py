"""Alembic env：复用我们自己的 config + ORM Base。

跑迁移：
    cd apps/server
    source .venv/bin/activate
    cd app && alembic -c ../alembic.ini upgrade head
"""

import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config

# 确保 alembic 在 apps/server 根目录跑时也能 import 到 app/ 下的模块
SERVER_ROOT = Path(__file__).resolve().parent.parent
APP_DIR = SERVER_ROOT / "app"
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# 默认 ENV=dev，让 ConfigManager 能加载 config-dev.yml
os.environ.setdefault("ENV", "dev")

from common import config  # noqa: E402
from db import Base  # noqa: E402,F401  # 触发模型 import 以注册到 Base.metadata
from db.pg import async_pg  # noqa: E402

alembic_config = context.config
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """从我们自己的 yaml 配置拼接 DSN。"""
    return async_pg.build_url()


def run_migrations_offline() -> None:
    """离线模式：只输出 SQL，不连库。"""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """在线模式：用 asyncpg 连库并执行。"""
    cfg = alembic_config.get_section(alembic_config.config_ini_section) or {}
    cfg["sqlalchemy.url"] = get_url()

    engine = async_engine_from_config(cfg, prefix="sqlalchemy.")
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()
    # 让别人能跟踪关闭
    _ = config  # 防止 ruff 不要 import


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
