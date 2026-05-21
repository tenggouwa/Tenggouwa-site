# Tenggouwa server prod image
# 单阶段：python:3.12-slim + uv，简单直接

FROM python:3.12-slim

# 安装 uv（极快的依赖管理）
RUN pip install --no-cache-dir uv==0.4.27

WORKDIR /srv

# 依赖层（利用 docker 缓存）
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev 2>/dev/null \
    || uv sync --no-dev

# 应用代码
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV PYTHONUNBUFFERED=1
ENV ENV=prod

EXPOSE 10095
ENTRYPOINT ["./entrypoint.sh"]
