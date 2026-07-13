"""agent 私有通道鉴权边界：/api/agent/chat 必须带 TOTP 换来的 agent_token，公开通道免鉴权。

安全关键回归——高危 write/MCP 工具只在私有通道暴露，若私有通道漏鉴权=公开 RCE。
断言 401 边界 + agent_token 只认 type=agent + 吊销纪元。TestClient 用例把 get_session 覆盖成 None，
纯纪元/DB 逻辑用 _FakeTotpRepo 桩掉（current_agent_owner 现在会读 admin_totp 的 agent_epoch）。
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


class _FakeTotpRepo:
    """免 DB 的吊销纪元桩：类变量存当前 epoch，bump 递增。"""

    _epoch = 0

    def __init__(self, _session) -> None:
        pass

    async def agent_epoch(self, _owner) -> int:
        return _FakeTotpRepo._epoch

    async def bump_agent_epoch(self, _owner) -> int:
        _FakeTotpRepo._epoch += 1
        return _FakeTotpRepo._epoch


def _stub_epoch(monkeypatch, current: int = 0) -> None:
    import modules.agent.auth as aauth
    import modules.agent.router as arouter

    _FakeTotpRepo._epoch = current
    monkeypatch.setattr(aauth, "AdminTotpRepository", _FakeTotpRepo)
    monkeypatch.setattr(arouter, "AdminTotpRepository", _FakeTotpRepo)


def test_private_channel_requires_bearer():
    assert _post_chat().status_code == 401


def test_private_channel_rejects_bad_token():
    assert _post_chat({"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_private_channel_rejects_non_agent_token():
    # 用同一密钥签一个 type=admin 的 token：类型不符 → 私有通道拒（别把别的 token 当 agent 用）
    secret = config.config_cache["AUTH_JWT_SECRET"]
    admin_tok = jwt.encode({"sub": "owner", "type": "admin"}, secret, algorithm="HS256")
    assert _post_chat({"Authorization": f"Bearer {admin_tok}"}).status_code == 401


def test_private_channel_accepts_agent_token(monkeypatch):
    # 合法 agent_token（纪元匹配）过鉴权 → 不再 401（后续会走到 chat DB override=None 才失败）
    _stub_epoch(monkeypatch, 0)
    token, ttl = make_agent_token("owner", 0)
    assert ttl >= 5 * 60
    assert _post_chat({"Authorization": f"Bearer {token}"}).status_code != 401


def test_public_channel_not_auth_gated():
    # 公开通道不因缺 token 而 401（会走到 DB 才失败，只要 != 401 即证明没挂鉴权门）
    r = _client().post("/api/public/agent/chat", json={"q": "hi"})
    assert r.status_code != 401


def test_unlock_rate_limited(monkeypatch):
    # 解锁端点限流：mock 掉 TOTP 校验（免 DB），换一把小闸，超限返回 429
    import modules.agent.router as arouter
    from common.rate_limit import AttemptLimiter

    async def fake_unlock(_session, _code):
        return "owner"

    monkeypatch.setattr(arouter.terminal_service, "unlock_with_totp", fake_unlock)
    monkeypatch.setattr(arouter, "unlock_limiter", AttemptLimiter(per_ip=2, ip_window=60, total=100, total_window=60))
    _stub_epoch(monkeypatch, 0)  # unlock 会读吊销纪元，桩掉免 DB
    c = _client()
    body = {"totp": "123456"}
    assert c.post("/api/public/agent/unlock", json=body).status_code == 200
    assert c.post("/api/public/agent/unlock", json=body).status_code == 200
    assert c.post("/api/public/agent/unlock", json=body).status_code == 429  # 第 3 次被限


def test_agent_token_roundtrip():
    from modules.agent.auth import _decode, make_agent_token

    tok, _ = make_agent_token("alice", 7)
    assert _decode(tok) == ("alice", 7)  # 带出 (owner, epoch)
    assert _decode("garbage") is None


async def test_revoked_token_rejected(monkeypatch):
    # token 纪元 < 当前吊销纪元 → 拒（"注销所有会话"后旧 token 失效）
    from fastapi import HTTPException
    from modules.agent import auth

    _stub_epoch(monkeypatch, 5)
    token, _ = auth.make_agent_token("owner", 0)  # 旧纪元 0
    try:
        await auth.current_agent_owner(f"Bearer {token}", session=None)
        raise AssertionError("已吊销的 token 不该通过")
    except HTTPException as e:
        assert e.status_code == 401


async def test_current_epoch_token_accepted(monkeypatch):
    from modules.agent import auth

    _stub_epoch(monkeypatch, 3)
    token, _ = auth.make_agent_token("owner", 3)  # 纪元匹配
    assert await auth.current_agent_owner(f"Bearer {token}", session=None) == "owner"


def test_revoke_endpoint_invalidates_token(monkeypatch):
    # 用 agent_token 打 /revoke → 纪元 +1 → 同一 token 再打 chat 被拒
    _stub_epoch(monkeypatch, 0)
    token, _ = make_agent_token("owner", 0)
    auth_hdr = {"Authorization": f"Bearer {token}"}
    c = _client()
    assert c.post("/api/agent/revoke", headers=auth_hdr).status_code == 200
    assert _FakeTotpRepo._epoch == 1  # 纪元已 +1
    assert _post_chat(auth_hdr).status_code == 401  # 旧 token 作废


async def test_agent_token_rejected_by_current_admin():
    # 关键隔离（评审 Critical）：agent_token 用派生密钥签，不能拿去过 current_admin 越权到 admin 路由
    from types import SimpleNamespace

    from dependencies.jwt_auth import current_admin
    from fastapi import HTTPException
    from modules.agent.auth import make_agent_token

    token, _ = make_agent_token("owner", 0)
    try:
        await current_admin(SimpleNamespace(method="POST"), f"Bearer {token}")
        raise AssertionError("current_admin 不该接受 agent_token")
    except HTTPException as e:
        assert e.status_code == 401


def test_agent_token_ttl_env_override(monkeypatch):
    from modules.agent.auth import make_agent_token

    monkeypatch.setenv("AGENT_TOKEN_TTL_MIN", "120")
    _, ttl = make_agent_token("x", 0)
    assert ttl == 120 * 60
    monkeypatch.setenv("AGENT_TOKEN_TTL_MIN", "1")  # 低于下限 → 钳到 5min
    _, ttl2 = make_agent_token("x", 0)
    assert ttl2 == 5 * 60
