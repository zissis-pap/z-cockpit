import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.github_manager import github_manager
from backend.services.settings_manager import settings_manager

router = APIRouter(prefix="/api/projects", tags=["projects"])
ws_router = APIRouter(tags=["projects-ws"])


@ws_router.websocket("/ws/projects")
async def ws_projects(websocket: WebSocket):
    await websocket.accept()
    github_manager.add_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        github_manager.remove_client(websocket)


# ── Repo listing ──────────────────────────────────────────────────────────────

@router.get("/repos")
async def list_repos():
    s = settings_manager.raw
    username = s.get("github_username", "")
    token = s.get("github_token", "")

    if not username and not token:
        return {"ok": False, "error": "not_configured", "repos": []}

    repos = await github_manager.list_repos(username, token)

    # Parallel local status check for all repos
    statuses = await asyncio.gather(
        *[github_manager.get_status_async(r["name"]) for r in repos],
        return_exceptions=True,
    )

    result = []
    for repo, status in zip(repos, statuses):
        if isinstance(status, Exception):
            status = {"status": "unknown", "local_path": ""}
        result.append({
            "name": repo["name"],
            "full_name": repo.get("full_name", ""),
            "description": repo.get("description") or "",
            "html_url": repo.get("html_url", ""),
            "clone_url": repo.get("clone_url", ""),
            "private": repo.get("private", False),
            "fork": repo.get("fork", False),
            "language": repo.get("language") or "",
            "updated_at": repo.get("updated_at", ""),
            "stargazers_count": repo.get("stargazers_count", 0),
            **status,
        })

    return {"ok": True, "repos": result}


@router.get("/repos/{repo_name}/status")
async def repo_status(repo_name: str):
    status = await github_manager.get_status_async(repo_name)
    return {"ok": True, **status}


@router.get("/repos/{repo_name}/changes")
async def repo_changes(repo_name: str):
    files = await asyncio.to_thread(github_manager.get_changed_files, repo_name)
    return {"ok": True, "files": files}


# ── Git operations ────────────────────────────────────────────────────────────

class CommitPayload(BaseModel):
    message: str


@router.post("/repos/{repo_name}/clone")
async def clone_repo(repo_name: str, clone_url: str):
    asyncio.create_task(github_manager.clone(repo_name, clone_url))
    return {"ok": True, "message": "Clone started"}


@router.post("/repos/{repo_name}/pull")
async def pull_repo(repo_name: str):
    asyncio.create_task(github_manager.pull(repo_name))
    return {"ok": True, "message": "Pull started"}


@router.post("/repos/{repo_name}/fetch")
async def fetch_repo(repo_name: str):
    asyncio.create_task(github_manager.fetch(repo_name))
    return {"ok": True, "message": "Fetch started"}


@router.post("/repos/{repo_name}/commit")
async def commit_repo(repo_name: str, payload: CommitPayload):
    if not payload.message.strip():
        return {"ok": False, "error": "Commit message cannot be empty"}
    asyncio.create_task(github_manager.commit_and_push(repo_name, payload.message))
    return {"ok": True, "message": "Commit started"}
