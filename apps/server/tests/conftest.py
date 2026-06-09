"""Pytest 公共夹具。

注入一个固定的 `AUTH_JWT_SECRET` 到全局 config 单例，让 token 相关逻辑可在
无配置文件的 CI 环境里跑。secret 取 32+ 字节，避开 PyJWT 的 InsecureKeyLengthWarning。
"""

import os

# config 单例在 import 时实例化，要求 ENV 非空（否则 ConfigManager 直接抛错）。
# CI 不设 ENV，这里兜底成 test，加载 app/config/config-test.yml。
os.environ["ENV"] = os.environ.get("ENV") or "test"

import pytest  # noqa: E402
from common import config  # noqa: E402

TEST_JWT_SECRET = "test-secret-key-for-pytest-0123456789abcdef"


@pytest.fixture(autouse=True)
def _inject_jwt_secret():
    original = config.config_cache.get("AUTH_JWT_SECRET")
    config.config_cache["AUTH_JWT_SECRET"] = TEST_JWT_SECRET
    yield
    if original is None:
        config.config_cache.pop("AUTH_JWT_SECRET", None)
    else:
        config.config_cache["AUTH_JWT_SECRET"] = original
