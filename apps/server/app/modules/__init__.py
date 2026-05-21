"""业务模块聚合。

每个业务模块放在 `app/modules/<name>/` 下，内部按 `router.py / service.py /
repository.py / schema.py` 拆分。本文件汇总所有模块路由到一个总 `router`，
统一挂在 FastAPI app 的 `/api` 前缀下（见 `main.py`）。
"""

from fastapi import APIRouter

from .auth.router import router as auth_router
from .inspirations.router import admin_router as inspiration_admin_router
from .inspirations.router import public_router as inspiration_public_router
from .posts.router import admin_router as post_admin_router
from .posts.router import public_router as post_public_router

__all__ = ["router"]

router = APIRouter(prefix="/api")

# 公开接口（前台 web 用，免鉴权）
router.include_router(post_public_router)
router.include_router(inspiration_public_router)

# 管理接口（admin 后台用，需 JWT）
router.include_router(auth_router)
router.include_router(post_admin_router)
router.include_router(inspiration_admin_router)
