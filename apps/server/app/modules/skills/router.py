from fastapi import APIRouter

from ..common_schema import ResponseModel
from .schema import SkillInfo
from .service import skills_service

public_router = APIRouter(prefix="/public/skills", tags=["public.skills"])


@public_router.get("", response_model=ResponseModel[list[SkillInfo]])
async def list_skills() -> ResponseModel[list[SkillInfo]]:
    return ResponseModel(data=skills_service.list_skills())
