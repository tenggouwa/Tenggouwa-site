# syntax=docker/dockerfile:1
# Tenggouwa server prod image
# 单阶段：python:3.12-slim + uv，简单直接

FROM python:3.12-slim

# 国内构建用阿里云 PyPI 镜像，避免 files.pythonhosted.org 超时。
# UV_HTTP_TIMEOUT 调到 120s：阿里云出境链路慢/抖，默认 30s 下大包（如
#   google-api-python-client 14MB）会超时构建失败。
# UV_COMPILE_BYTECODE：构建期预编译 .pyc 省冷启动。
# UV_LINK_MODE=copy：cache mount 跨文件系统，免 hardlink 警告。
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_TRUSTED_HOST=mirrors.aliyun.com \
    UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/ \
    UV_HTTP_TIMEOUT=120 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# 安装 uv（极快的依赖管理）。版本要 >= 生成 uv.lock 的本地 uv，否则读不了
# 新版 lock（revision 字段）会让 --frozen 失败。
RUN pip install --no-cache-dir uv==0.6.5

WORKDIR /srv

# 依赖层。--mount=type=cache 把 uv 的 wheel 缓存跨构建持久化：依赖没变时
# 不重下，只有改动的包才下载（对慢带宽尤其关键）。
# 只用 --frozen：lock 与 pyproject 失配时直接构建失败（loud），而不是静默
# 回退到 `uv sync` 重解析、把没测过的新版本悄悄带上线（曾导致 uvicorn 0.48 事故）。
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# 应用代码
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh \
    && mkdir -p logs  # logging_config.yml 里的 file handler 写 ../logs/，容器里 cwd=app 时落在 /srv/logs/

ENV PYTHONUNBUFFERED=1
ENV ENV=prod

EXPOSE 10095
ENTRYPOINT ["./entrypoint.sh"]
