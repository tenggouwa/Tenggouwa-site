"""agent 私有通道鉴权边界（Phase C-auth）：/api/agent/chat 必须 JWT，公开通道免鉴权。

安全关键回归——高危 write/MCP 工具只在私有通道暴露，若私有通道漏鉴权=公开 RCE。
只断言 401 边界（current_admin 在 get_session 之前短路，无需 DB）。
"""

from db import get_session
from fastapi import FastAPI
from fastapi.testclient import TestClient
from modules.agent.router import private_router, public_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(private_router, prefix="/api")
    app.include_router(public_router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: None  # 免真 DB：只验鉴权边界
    return TestClient(app)


def test_private_channel_requires_bearer():
    r = _client().post("/api/agent/chat", json={"q": "hi"})
    assert r.status_code == 401


def test_private_channel_rejects_bad_token():
    r = _client().post("/api/agent/chat", json={"q": "hi"}, headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_public_channel_not_auth_gated():
    # 公开通道不因缺 token 而 401（会走到 DB 才失败，只要 != 401 即证明没挂 current_admin）
    r = _client().post("/api/public/agent/chat", json={"q": "hi"})
    assert r.status_code != 401
