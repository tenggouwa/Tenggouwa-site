"""TOTP service 的 JWT token 逻辑测试。

覆盖 step / trust token 的签发与校验，重点在安全边界：类型混淆、跨账号、过期、篡改。
这些都是纯函数（只依赖注入的 jwt secret），不碰数据库。
"""

import time

import jwt
import pytest
from conftest import TEST_JWT_SECRET
from modules.totp.service import STEP_TTL, TRUST_TTL, totp_service


def _decode(token: str) -> dict:
    return jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])


def test_step_token_payload():
    payload = _decode(totp_service.make_step_token("alice"))
    assert payload["sub"] == "alice"
    assert payload["type"] == "step"
    assert payload["exp"] - payload["iat"] == STEP_TTL


def test_trust_token_payload():
    payload = _decode(totp_service.make_trust_token("alice"))
    assert payload["sub"] == "alice"
    assert payload["type"] == "trust"
    assert payload["exp"] - payload["iat"] == TRUST_TTL


def test_trust_token_roundtrip():
    token = totp_service.make_trust_token("alice")
    assert totp_service.verify_trust_token(token, "alice") is True


def test_trust_token_rejects_other_user():
    token = totp_service.make_trust_token("alice")
    assert totp_service.verify_trust_token(token, "bob") is False


@pytest.mark.parametrize("token", [None, "", "not.a.jwt", "a.b.c"])
def test_trust_token_rejects_bad_input(token):
    assert totp_service.verify_trust_token(token, "alice") is False


def test_step_token_not_accepted_as_trust():
    """type 混淆防护：step token 不能冒充 trust token。"""
    step = totp_service.make_step_token("alice")
    assert totp_service.verify_trust_token(step, "alice") is False


def test_trust_token_rejects_expired():
    now = int(time.time())
    expired = jwt.encode(
        {"sub": "alice", "type": "trust", "iat": now - 10, "exp": now - 1},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    assert totp_service.verify_trust_token(expired, "alice") is False


def test_trust_token_rejects_wrong_secret():
    forged = jwt.encode(
        {"sub": "alice", "type": "trust", "iat": int(time.time()), "exp": int(time.time()) + 100},
        "a-totally-different-secret-0123456789abcdef",
        algorithm="HS256",
    )
    assert totp_service.verify_trust_token(forged, "alice") is False


def test_trust_token_rejects_tampered_signature():
    token = totp_service.make_trust_token("alice")
    tampered = token[:-3] + ("aaa" if token[-3:] != "aaa" else "bbb")
    assert totp_service.verify_trust_token(tampered, "alice") is False


def test_username_from_trust_token():
    token = totp_service.make_trust_token("alice")
    assert totp_service.username_from_trust_token(token) == "alice"


def test_username_from_trust_token_rejects_step():
    step = totp_service.make_step_token("alice")
    assert totp_service.username_from_trust_token(step) is None


@pytest.mark.parametrize("token", [None, "", "garbage"])
def test_username_from_trust_token_bad_input(token):
    assert totp_service.username_from_trust_token(token) is None
