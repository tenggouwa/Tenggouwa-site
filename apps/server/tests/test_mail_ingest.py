"""mail ingest：HMAC 校验 + 抽码/归一化入库（用假 repo，不碰 DB）。"""

import hashlib
import hmac

import pytest
from common import config
from modules.mail.schema import MailIngestPayload
from modules.mail.service import MailService

SECRET = "test-mail-ingest-secret-0123456789"


@pytest.fixture(autouse=True)
def _inject_secret():
    original = config.config_cache.get("MAIL_INGEST_SECRET")
    config.config_cache["MAIL_INGEST_SECRET"] = SECRET
    yield
    if original is None:
        config.config_cache.pop("MAIL_INGEST_SECRET", None)
    else:
        config.config_cache["MAIL_INGEST_SECRET"] = original


def _sign(ts: str, body: bytes) -> str:
    return "sha256=" + hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()


def test_verify_hmac_ok():
    svc = MailService()
    body = b'{"message_id":"m1","to":"a@x.com"}'
    assert svc.verify_hmac(body, "1000", _sign("1000", body), now=1000) is True


def test_verify_hmac_bad_signature():
    svc = MailService()
    body = b'{"x":1}'
    assert svc.verify_hmac(body, "1000", "sha256=deadbeef", now=1000) is False


def test_verify_hmac_expired_timestamp():
    svc = MailService()
    body = b"{}"
    assert svc.verify_hmac(body, "1000", _sign("1000", body), now=1000 + 301) is False


def test_verify_hmac_body_tampered():
    svc = MailService()
    sig = _sign("1000", b'{"a":1}')
    assert svc.verify_hmac(b'{"a":2}', "1000", sig, now=1000) is False


def test_verify_hmac_missing_secret():
    config.config_cache.pop("MAIL_INGEST_SECRET", None)
    svc = MailService()
    body = b"{}"
    assert svc.verify_hmac(body, "1000", _sign("1000", body), now=1000) is False


async def test_ingest_normalizes_and_extracts(monkeypatch):
    captured: dict = {}

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def upsert_message(self, **kwargs):
            captured.update(kwargs)
            return True

    monkeypatch.setattr("modules.mail.service.MailRepository", FakeRepo)
    svc = MailService()
    payload = MailIngestPayload.model_validate(
        {
            "message_id": "m-1",
            "to": "Netflix@Tenggouwa.COM",
            "subject": "验证码",
            "body": "您的验证码是 123456，5分钟内有效",
        }
    )
    is_new = await svc.ingest(None, payload)

    assert is_new is True
    assert captured["to_address"] == "netflix@tenggouwa.com"
    assert captured["mailbox"] == "netflix"
    assert captured["code"] == "123456"
    assert captured["expires_at"] > captured["received_at"]


async def test_ingest_uses_worker_provided_code(monkeypatch):
    captured: dict = {}

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def upsert_message(self, **kwargs):
            captured.update(kwargs)
            return False  # 模拟重复投递

    monkeypatch.setattr("modules.mail.service.MailRepository", FakeRepo)
    svc = MailService()
    payload = MailIngestPayload.model_validate(
        {"message_id": "m-2", "to": "x@tenggouwa.com", "subject": "s", "body": "no digits", "code": "998877"}
    )
    is_new = await svc.ingest(None, payload)

    assert is_new is False
    assert captured["code"] == "998877"  # 用 Worker 预抽的码，不再兜底
