from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.settings_manager import settings_manager
from backend.services import github_manager, bitbucket_manager

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/accounts")
async def get_accounts():
    return {"ok": True, "accounts": settings_manager.get_accounts_masked()}


class AccountPayload(BaseModel):
    platform: str = "github"
    label: str = ""
    username: str = ""
    token: str = ""
    workspace: str = ""
    clone_base_path: str = ""


@router.post("/accounts")
async def add_account(payload: AccountPayload):
    acct = settings_manager.add_account(payload.model_dump())
    return {"ok": True, "account": acct}


@router.put("/accounts/{account_id}")
async def update_account(account_id: str, payload: AccountPayload):
    acct = settings_manager.update_account(account_id, payload.model_dump())
    if acct is None:
        return {"ok": False, "error": "Account not found"}
    return {"ok": True, "account": acct}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    ok = settings_manager.delete_account(account_id)
    return {"ok": ok}


@router.post("/accounts/{account_id}/test")
async def test_account(account_id: str):
    acct = settings_manager.get_account_raw(account_id)
    if not acct:
        return {"ok": False, "error": "Account not found"}
    platform = acct.get("platform", "github")
    if platform == "bitbucket":
        return await bitbucket_manager.test_connection(acct["username"], acct["token"])
    return await github_manager.test_connection(acct["username"], acct["token"])
