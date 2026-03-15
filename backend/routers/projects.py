import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.repos_manager import repos_manager
from backend.services.settings_manager import settings_manager
from backend.services import github_manager, bitbucket_manager

router = APIRouter(prefix="/api/projects", tags=["projects"])
ws_router = APIRouter(tags=["projects-ws"])


@ws_router.websocket("/ws/projects")
async def ws_projects(websocket: WebSocket):
    await websocket.accept()
    repos_manager.add_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        repos_manager.remove_client(websocket)


# ── Repo listing ──────────────────────────────────────────────────────────────

async def _fetch_account_repos(account: dict) -> list[dict]:
    platform = account.get("platform", "github")
    if platform == "bitbucket":
        raw = await bitbucket_manager.list_repos(
            account["username"], account["token"], account.get("workspace", "")
        )
        normalized = [bitbucket_manager.normalize_repo(r, account) for r in raw]
    else:
        raw = await github_manager.list_repos(account["username"], account["token"])
        normalized = [github_manager.normalize_repo(r, account) for r in raw]

    statuses = await asyncio.gather(
        *[repos_manager.get_status(account["id"], r["name"]) for r in normalized],
        return_exceptions=True,
    )
    result = []
    for repo, status in zip(normalized, statuses):
        if isinstance(status, Exception):
            status = {"status": "unknown", "local_path": ""}
        result.append({**repo, **status})
    return result


@router.get("/repos")
async def list_repos():
    accounts = settings_manager.all_accounts_raw()
    if not accounts:
        return {"ok": False, "error": "not_configured", "repos": []}

    all_results = await asyncio.gather(
        *[_fetch_account_repos(a) for a in accounts],
        return_exceptions=True,
    )
    repos = []
    for r in all_results:
        if not isinstance(r, Exception):
            repos.extend(r)
    return {"ok": True, "repos": repos}


@router.get("/repos/{account_id}/{repo_name}/status")
async def repo_status(account_id: str, repo_name: str):
    status = await repos_manager.get_status(account_id, repo_name)
    return {"ok": True, **status}


@router.get("/repos/{account_id}/{repo_name}/changes")
async def repo_changes(account_id: str, repo_name: str):
    files = await asyncio.to_thread(repos_manager.get_changed_files, account_id, repo_name)
    return {"ok": True, "files": files}


# ── Git operations ────────────────────────────────────────────────────────────

class CommitPayload(BaseModel):
    message: str


@router.post("/repos/{account_id}/{repo_name}/clone")
async def clone_repo(account_id: str, repo_name: str, clone_url: str):
    asyncio.create_task(repos_manager.clone(account_id, repo_name, clone_url))
    return {"ok": True, "message": "Clone started"}


@router.post("/repos/{account_id}/{repo_name}/pull")
async def pull_repo(account_id: str, repo_name: str):
    asyncio.create_task(repos_manager.pull(account_id, repo_name))
    return {"ok": True, "message": "Pull started"}


@router.post("/repos/{account_id}/{repo_name}/fetch")
async def fetch_repo(account_id: str, repo_name: str):
    asyncio.create_task(repos_manager.fetch(account_id, repo_name))
    return {"ok": True, "message": "Fetch started"}


@router.post("/repos/{account_id}/{repo_name}/commit")
async def commit_repo(account_id: str, repo_name: str, payload: CommitPayload):
    if not payload.message.strip():
        return {"ok": False, "error": "Commit message cannot be empty"}
    asyncio.create_task(repos_manager.commit_and_push(account_id, repo_name, payload.message))
    return {"ok": True, "message": "Commit started"}
