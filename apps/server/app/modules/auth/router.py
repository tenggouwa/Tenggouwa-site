import logging

from fastapi import APIRouter

from ..common_schema import ResponseModel
from .schema import LoginRequest, LoginResponse
from .service import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/auth", tags=["admin.auth"])


@router.post("/login", response_model=ResponseModel[LoginResponse])
async def login(payload: LoginRequest) -> ResponseModel[LoginResponse]:
    """管理员登录，成功后返回 JWT。"""
    resp = auth_service.login(payload)
    return ResponseModel(data=resp)
