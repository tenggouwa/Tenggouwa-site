"""异步 Postgres 接入。

约定：
- 配置在 `postgres.<name>`（默认 `default`），密码读环境变量
  `POSTGRES_<NAME>_PASSWORD`（即 `POSTGRES_DEFAULT_PASSWORD`）。
- `Base` 是所有 ORM 模型的基类；不要再用 `db/mysql.py` 里那个旧 Base。
- 提供两种使用方式：
  1) FastAPI 依赖 `get_session`：注入 `AsyncSession`，请求结束自动 commit / rollback。
  2) 上下文管理 `async_pg.session()`：脚本 / 后台任务使用。
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from urllib.parse import quote_plus

from common import config
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有 ORM 模型基类。"""


class AsyncPostgres:
    def __init__(self, name: str = "default") -> None:
        self.name = name
        self._engine: AsyncEngine | None = None
        self._sessionmaker: async_sessionmaker[AsyncSession] | None = None

    def build_url(self, *, driver: str = "asyncpg") -> str:
        pg_config = config.get(f"postgres.{self.name}", {}) or {}
        host = pg_config.get("host", "127.0.0.1")
        port = pg_config.get("port", 5432)
        db = pg_config.get("db", "")
        user = pg_config.get("user", "postgres")
        password = config.get(f"POSTGRES_{self.name.upper()}_PASSWORD", "") or ""
        return f"postgresql+{driver}://{user}:{quote_plus(password)}@{host}:{port}/{db}"

    def get_engine(self) -> AsyncEngine:
        if self._engine is None:
            pg_config = config.get(f"postgres.{self.name}", {}) or {}
            sa_config = pg_config.get("sqlalchemy", {}) or {}
            self._engine = create_async_engine(
                self.build_url(),
                pool_size=sa_config.get("pool_size", 5),
                max_overflow=sa_config.get("max_overflow", 5),
                pool_timeout=sa_config.get("pool_timeout", 30),
                pool_recycle=sa_config.get("pool_recycle", 1800),
                pool_pre_ping=True,
                echo=sa_config.get("echo", False),
            )
            self._sessionmaker = async_sessionmaker(self._engine, expire_on_commit=False, class_=AsyncSession)
        return self._engine

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        if self._sessionmaker is None:
            self.get_engine()
        assert self._sessionmaker is not None
        async with self._sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def close(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
            self._engine = None
            self._sessionmaker = None


async_pg = AsyncPostgres()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖：每个请求一个 session，正常退出自动 commit。"""
    async with async_pg.session() as session:
        yield session
