from pydantic import BaseModel


class SkillInfo(BaseModel):
    name: str
    description: str
    parameters: dict
