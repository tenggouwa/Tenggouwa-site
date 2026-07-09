"""agent 私有通道鉴权边界：/api/agent/chat 必须带 TOTP 换来的 agent_token，公开通道免鉴权。

安全关键回归——高危 write/MCP 工具只在私有通道暴露，若私有通道漏鉴权=公开 RCE。
断言 401 边界（current_agent_owner 在 get_session 之前短路，无需 DB）+ agent_token 只认 type=agent。
"""

import jwt
from common import config
from db import get_session
from fastapi import FastAPI
from fastapi.testclient import TestClient
from modules.agent.auth import make_agent_token
from modules.agent.router import private_router, public_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(private_router, prefix="/api")
    app.include_router(public_router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: None  # 免真 DB：只验鉴权边界
    return TestClient(app)


def _post_chat(headers=None):
    return _client().post("/api/agent/chat", json={"q": "hi"}, headers=headers or {})


def test_private_channel_requires_bearer():
    assert _post_chat().status_code == 401


def test_private_channel_rejects_bad_token():
    assert _post_chat({"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_private_channel_rejects_non_agent_token():
    # 用同一密钥签一个 type=admin 的 token：类型不符 → 私有通道拒（别把别的 token 当 agent 用）
    secret = config.config_cache["AUTH_JWT_SECRET"]
    admin_tok = jwt.encode({"sub": "owner", "type": "admin"}, secret, algorithm="HS256")
    assert _post_chat({"Authorization": f"Bearer {admin_tok}"}).status_code == 401


def test_private_channel_accepts_agent_token():
    # 合法 agent_token 过鉴权 → 不再 401（后续会走到 DB override=None 才失败，只要 != 401）
    token, ttl = make_agent_token("owner")
    assert ttl >= 5 * 60
    assert _post_chat({"Authorization": f"Bearer {token}"}).status_code != 401


def test_public_channel_not_auth_gated():
    # 公开通道不因缺 token 而 401（会走到 DB 才失败，只要 != 401 即证明没挂鉴权门）
    r = _client().post("/api/public/agent/chat", json={"q": "hi"})
    assert r.status_code != 401


def test_agent_token_roundtrip():
    from modules.agent.auth import _decode, make_agent_token

    tok, _ = make_agent_token("alice")
    assert _decode(tok) == "alice"
    assert _decode("garbage") is None


async def test_agent_token_rejected_by_current_admin():
    # 关键隔离（评审 Critical）：agent_token 用派生密钥签，不能拿去过 current_admin 越权到 admin 路由
    from types import SimpleNamespace

    from dependencies.jwt_auth import current_admin
    from fastapi import HTTPException
    from modules.agent.auth import make_agent_token

    token, _ = make_agent_token("owner")
    try:
        await current_admin(SimpleNamespace(method="POST"), f"Bearer {token}")
        raise AssertionError("current_admin 不该接受 agent_token")
    except HTTPException as e:
        assert e.status_code == 401


def test_agent_token_ttl_env_override(monkeypatch):
    from modules.agent.auth import make_agent_token

    monkeypatch.setenv("AGENT_TOKEN_TTL_MIN", "120")
    _, ttl = make_agent_token("x")
    assert ttl == 120 * 60
    monkeypatch.setenv("AGENT_TOKEN_TTL_MIN", "1")  # 低于下限 → 钳到 5min
    _, ttl2 = make_agent_token("x")
    assert ttl2 == 5 * 60
