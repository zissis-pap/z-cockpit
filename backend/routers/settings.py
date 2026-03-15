from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.settings_manager import settings_manager
from backend.services.github_manager import github_manager

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings():
    return {"ok": True, "settings": settings_manager.get_masked()}


class SettingsPayload(BaseModel):
    github_username: str = ""
    github_token: str = ""
    clone_base_path: str = ""


@router.post("")
async def save_settings(payload: SettingsPayload):
    settings_manager.update(payload.model_dump())
    return {"ok": True}


@router.post("/test-connection")
async def test_connection():
    s = settings_manager.raw
    result = await github_manager.test_connection(
        s.get("github_username", ""),
        s.get("github_token", ""),
    )
    return result
