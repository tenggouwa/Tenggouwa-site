"""Exercise the portal's HTTP authentication boundary without a production DB."""

import time
from unittest.mock import AsyncMock

import bcrypt
import jwt
import pytest
from common import config
from common.rate_limit import AttemptLimiter
from db import get_session
from dependencies import current_admin
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from middlewares.router_logging_middleware import RouterLoggingMiddleware
from modules.mail import portal
from modules.mail.repository import MailRepository

PASSWORD = "portal-test-password"
PASSWORD_HASH = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
HEADERS = {"X-Mail-Portal": "1"}


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setitem(config.config_cache, "MAIL_PORTAL_PASSWORD_HASH", PASSWORD_HASH)
    monkeypatch.setattr(portal, "login_limiter", AttemptLimiter(per_ip=6, ip_window=60, total=30, total_window=60))
    monkeypatch.setattr(portal.mail_service, "list_inboxes", AsyncMock(return_value=[]))
    monkeypatch.setattr(portal.mail_service, "list_messages", AsyncMock(return_value=[]))
    app = FastAPI()
    app.add_middleware(RouterLoggingMiddleware)
    app.include_router(portal.router, prefix="/api")

    async def session():
        yield None

    app.dependency_overrides[get_session] = session

    @app.get("/api/admin/test", dependencies=[Depends(current_admin)])
    async def admin_only():
        return True

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://portal.example") as http:
        yield http


async def login(client):
    return await client.post("/api/mail/login", json={"password": PASSWORD}, headers=HEADERS)


@pytest.mark.parametrize("path", ["inboxes", "example/messages", "example/latest-code"])
async def test_anonymous_cannot_read(client, path):
    result = await client.get(f"/api/mail/{path}")
    assert result.status_code == 401
    assert result.headers["cache-control"] == "no-store"


async def test_login_read_logout_and_cookie_security(client, caplog):
    result = await login(client)
    assert result.status_code == 200
    cookie = result.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    assert "Path=/api/mail" in cookie
    assert (await client.get("/api/mail/inboxes")).status_code == 200
    assert (await client.get("/api/mail/example/messages")).status_code == 200
    assert PASSWORD not in str([getattr(record, "request_params", {}) for record in caplog.records])
    assert (await client.post("/api/mail/logout", headers=HEADERS)).status_code == 200
    assert (await client.get("/api/mail/inboxes")).status_code == 401


async def test_mail_token_cannot_be_used_as_admin_bearer(client):
    await login(client)
    token = client.cookies.get(portal.COOKIE)
    assert (await client.get("/api/admin/test", headers={"Authorization": f"Bearer {token}"})).status_code == 401


async def test_admin_token_cannot_read_mail_portal(client):
    now = int(time.time())
    token = jwt.encode(
        {"sub": "admin", "iat": now, "exp": now + 3600}, config.get("AUTH_JWT_SECRET"), algorithm="HS256"
    )
    client.cookies.set(portal.COOKIE, token)
    assert (await client.get("/api/mail/inboxes")).status_code == 401


async def test_password_rotation_revokes_session(client, monkeypatch):
    await login(client)
    monkeypatch.setitem(config.config_cache, "MAIL_PORTAL_PASSWORD_HASH", "changed-hash")
    assert (await client.get("/api/mail/inboxes")).status_code == 401
    monkeypatch.setitem(config.config_cache, "MAIL_PORTAL_PASSWORD_HASH", "")
    assert (await client.get("/api/mail/inboxes")).status_code == 503
    assert (await login(client)).status_code == 503


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "mail-reader", "aud": "mail-portal", "iat": 1, "exp": 2},
        {"sub": "mail-reader", "aud": "admin", "iat": 1, "exp": 9999999999},
        {"sub": "admin", "aud": "mail-portal", "iat": 1, "exp": 9999999999},
        {"sub": "mail-reader", "aud": "mail-portal"},
    ],
)
async def test_invalid_sessions_rejected(client, claims):
    client.cookies.set(portal.COOKIE, jwt.encode(claims, portal.signing_key(), algorithm="HS256"))
    assert (await client.get("/api/mail/inboxes")).status_code == 401


async def test_wrong_password_rate_limit_and_csrf_header(client):
    assert (await client.post("/api/mail/login", json={"password": PASSWORD})).status_code == 403
    for _ in range(6):
        result = await client.post("/api/mail/login", json={"password": "wrong"}, headers=HEADERS)
        assert result.status_code == 401
    assert (await login(client)).status_code == 429


@pytest.mark.parametrize("method", ["latest_code", "list_messages", "list_inboxes"])
async def test_all_queries_exclude_expired_mail(method):
    class Session:
        async def execute(self, statement):
            compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
            assert "mail_message.expires_at > clock_timestamp()" in compiled
            raise RuntimeError("query inspected")

    repo = MailRepository(Session())
    with pytest.raises(RuntimeError, match="query inspected"):
        if method == "latest_code":
            await repo.latest_code("example")
        elif method == "list_messages":
            await repo.list_messages("example", limit=50, offset=0)
        else:
            await repo.list_inboxes()
