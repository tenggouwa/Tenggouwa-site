"""Auth service 密码校验与 admin 查找逻辑测试。

`_verify_password` / `_find_admin` 都是 staticmethod 纯逻辑：bcrypt 校验、明文回退、
坏 hash 容错、环境变量 password_hash 覆盖。
"""

import bcrypt
import pytest
from common import config
from modules.auth.service import AuthService


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def test_verify_password_bcrypt_correct():
    admin = {"username": "alice", "password_hash": _hash("s3cret")}
    assert AuthService._verify_password("s3cret", admin) is True


def test_verify_password_bcrypt_wrong():
    admin = {"username": "alice", "password_hash": _hash("s3cret")}
    assert AuthService._verify_password("nope", admin) is False


def test_verify_password_bad_hash_format():
    """非法 bcrypt 串触发 ValueError，应被吞掉返回 False 而非崩溃。"""
    admin = {"username": "alice", "password_hash": "not-a-bcrypt-hash"}
    assert AuthService._verify_password("whatever", admin) is False


def test_verify_password_plain_fallback():
    admin = {"username": "alice", "password": "plain-pw"}
    assert AuthService._verify_password("plain-pw", admin) is True
    assert AuthService._verify_password("wrong", admin) is False


def test_verify_password_no_credentials():
    assert AuthService._verify_password("anything", {"username": "alice"}) is False


@pytest.fixture
def _admins_config():
    original = config.config_cache.get("auth")
    config.config_cache["auth"] = {"admins": [{"username": "alice", "password_hash": "$2b$hash"}]}
    yield
    if original is None:
        config.config_cache.pop("auth", None)
    else:
        config.config_cache["auth"] = original


def test_find_admin_match(_admins_config):
    admin = AuthService._find_admin("alice")
    assert admin is not None
    assert admin["username"] == "alice"


def test_find_admin_missing(_admins_config):
    assert AuthService._find_admin("bob") is None


def test_find_admin_env_override(_admins_config):
    override = "$2b$override"
    config.config_cache["ADMIN_ALICE_PASSWORD_HASH"] = override
    try:
        admin = AuthService._find_admin("alice")
        assert admin is not None
        assert admin["password_hash"] == override
    finally:
        config.config_cache.pop("ADMIN_ALICE_PASSWORD_HASH", None)
