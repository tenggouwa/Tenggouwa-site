import logging.config
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from common import config, load_logging_config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from gunicorn.app.base import Application
from middlewares import GlobalExceptionMiddleware, RouterLoggingMiddleware
from modules import router as api_router
from starlette.middleware.gzip import GZipMiddleware

env: str = config.get("ENV")
logging_config = load_logging_config(config.get("logger.config_path", None))
logging.config.dictConfig(logging_config)
logger = logging.getLogger(__name__)
logging.getLogger("uvicorn.access").handlers = []


def create_app() -> FastAPI:
    enable_docs = env in ["dev", "test"]
    docs_url = "/docs" if enable_docs else None
    redoc_url = "/redoc" if enable_docs else None
    openapi_url = "/openapi.json" if enable_docs else None

    def setup_proxy_bypass() -> None:
        bypass_addresses = ["127.0.0.1", "localhost", "::1", "*.local", "10.*", "192.168.*", "172.16.*", "172.17.*"]
        current_no_proxy = os.environ.get("NO_PROXY", "") or os.environ.get("no_proxy", "")
        current_no_proxy = "".join(c for c in current_no_proxy if c.isprintable())
        existing = {e.strip() for e in current_no_proxy.split(",") if e.strip()}
        new_no_proxy = ",".join(sorted(existing.union(set(bypass_addresses))))
        os.environ["NO_PROXY"] = new_no_proxy
        os.environ["no_proxy"] = new_no_proxy
        logger.info(f"设置代理绕过配置: {new_no_proxy}")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        logger.info("Starting tenggouwa-server...")
        setup_proxy_bypass()
        # 真实数据库 / Redis 资源初始化放这里
        logger.info("tenggouwa-server started.")
        yield
        logger.info("Stopping tenggouwa-server...")
        logger.info("tenggouwa-server stopped.")

    app = FastAPI(
        title="tenggouwa-server",
        root_path=config.get("fastapi.root_path"),
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
        lifespan=lifespan,
    )

    allow_origins = config.get("fastapi.cors_allow_origins")
    if allow_origins is not None:
        # noinspection PyTypeChecker
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allow_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    # noinspection PyTypeChecker
    app.add_middleware(RouterLoggingMiddleware)
    # noinspection PyTypeChecker
    app.add_middleware(GlobalExceptionMiddleware)
    # noinspection PyTypeChecker
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    app.include_router(api_router)

    @app.get("/")
    async def read_root():
        return {"name": "tenggouwa-server", "status": "ok"}

    @app.get("/health/check")
    async def health_check():
        return {"status": "UP"}

    @app.head("/health/check")
    async def health_check_head():
        return Response(status_code=200)

    return app


main_app = create_app()


class StandaloneApplication(Application):
    def __init__(self, app, my_options: dict | None = None, config_file: str | None = None) -> None:
        try:
            import uvloop  # noqa: PLC0415

            if sys.platform != "win32":
                uvloop.install()
                logger.info("Using uvloop as event loop policy in Gunicorn master process")
        except ImportError:
            logger.warning("uvloop not available - using default event loop policy in Gunicorn master process")

        self.application = app
        self.options = my_options or {}
        self.config_file = config_file
        super().__init__()

    def init(self, parser, opts, args):  # noqa: ARG002
        return self.application

    def load_config(self):
        _config = self.cfg
        for key, value in self.options.items():
            if key in _config.settings and value is not None:
                _config.set(key.lower(), value)
        if self.config_file:
            cfp = Path(self.config_file)
            if not cfp.exists():
                logger.error(f"配置文件 {self.config_file} 不存在.")
                sys.exit(1)
            self.load_config_from_file(str(cfp))

    def load(self):
        return self.application


if __name__ == "__main__":
    logger.info(f"ENV: {env}, host: {config.get('fastapi.host')}, port: {config.get('fastapi.port')}")
    if env == "dev":
        uvicorn_config = uvicorn.Config(
            "main:main_app",
            host=config.get("fastapi.host"),
            port=config.get("fastapi.port"),
            reload=False,
            log_config=logging_config,
        )
        try:
            uvicorn.Server(uvicorn_config).run()
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt received, server will stop.")
    else:
        workers = config.get("fastapi.workers", 1)
        options = {
            "bind": f"{config.get('fastapi.host')}:{config.get('fastapi.port')}",
            "workers": workers,
            "worker_class": "uvicorn_worker.UvicornWorker",
            "timeout": 60,
            "graceful_timeout": 50,
            "limit_concurrency": 5000,
            "backlog": 32000,
            "logconfig_dict": logging_config,
            "preload_app": True,
        }
        logger.info("Starting Gunicorn server...")
        StandaloneApplication(main_app, my_options=options).run()
