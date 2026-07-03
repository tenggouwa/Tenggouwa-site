"""业务模块聚合。

每个业务模块放在 `app/modules/<name>/` 下，内部按 `router.py / service.py /
repository.py / schema.py` 拆分。本文件汇总所有模块路由到一个总 `router`，
统一挂在 FastAPI app 的 `/api` 前缀下（见 `main.py`）。
"""

from fastapi import APIRouter

from .analytics.router import admin_router as analytics_admin_router
from .analytics.router import public_router as analytics_public_router
from .auth.router import router as auth_router
from .casino.router import public_router as casino_public_router
from .inspirations.router import admin_router as inspiration_admin_router
from .inspirations.router import public_router as inspiration_public_router
from .kb.router import admin_router as kb_admin_router
from .kb.router import public_router as kb_public_router
from .pi.router import agent_router as pi_agent_router
from .pi.router import public_router as pi_public_router
from .posts.router import admin_router as post_admin_router
from .posts.router import public_router as post_public_router
from .search.router import public_router as search_public_router
from .seo.router import admin_router as seo_admin_router
from .seo.router import public_router as seo_public_router
from .terminal.router import admin_router as terminal_admin_router
from .terminal.router import agent_router as terminal_agent_router
from .terminal.router import client_ws_router as terminal_client_ws_router
from .terminal.router import console_router as terminal_console_router
from .totp.router import router as totp_router

__all__ = ["router"]

router = APIRouter(prefix="/api")

# 公开接口（前台 web 用，免鉴权）
router.include_router(post_public_router)
router.include_router(casino_public_router)
router.include_router(inspiration_public_router)
router.include_router(kb_public_router)
router.include_router(analytics_public_router)
router.include_router(pi_public_router)
router.include_router(search_public_router)
router.include_router(seo_public_router)
router.include_router(terminal_console_router)  # /api/console/*：自带 voice/TOTP 鉴权

# Mac agent 接入（WSS，bearer agent_token）
router.include_router(terminal_agent_router)
# 树莓派 pi-agent 接入（HTTPS POST，bearer PI_AGENT_TOKEN）
router.include_router(pi_agent_router)

# 管理接口（admin 后台用，需 JWT）
router.include_router(auth_router)
router.include_router(totp_router)
router.include_router(post_admin_router)
router.include_router(inspiration_admin_router)
router.include_router(kb_admin_router)
router.include_router(analytics_admin_router)
router.include_router(seo_admin_router)
router.include_router(terminal_admin_router)
router.include_router(terminal_client_ws_router)
