import asyncio
from pathlib import Path
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


# ── File browser ───────────────────────────────────────────────────────────────

def _repo_root(account_id: str, repo_name: str) -> Path | None:
    acct = settings_manager.get_account_raw(account_id)
    if not acct:
        return None
    return Path(acct['clone_base_path']) / repo_name


def _safe_path(root: Path, rel: str) -> Path:
    target = (root / rel.lstrip('/')).resolve()
    if not str(target).startswith(str(root.resolve())):
        raise ValueError("Path outside repository")
    return target


@router.get("/repos/{account_id}/{repo_name}/files")
async def list_files(account_id: str, repo_name: str, path: str = ""):
    root = _repo_root(account_id, repo_name)
    if not root:
        return {"ok": False, "error": "Account not found"}
    if not root.exists():
        return {"ok": False, "error": "Repository not cloned"}
    try:
        target = _safe_path(root, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    if not target.is_dir():
        return {"ok": False, "error": "Not a directory"}

    entries = []
    for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
        if entry.name == '.git':
            continue
        rel = str(entry.relative_to(root))
        entries.append({
            "name": entry.name,
            "path": rel,
            "type": "dir" if entry.is_dir() else "file",
            "size": entry.stat().st_size if entry.is_file() else 0,
        })
    return {"ok": True, "entries": entries}


@router.get("/repos/{account_id}/{repo_name}/file")
async def read_file(account_id: str, repo_name: str, path: str):
    root = _repo_root(account_id, repo_name)
    if not root:
        return {"ok": False, "error": "Account not found"}
    try:
        target = _safe_path(root, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    if not target.is_file():
        return {"ok": False, "error": "Not a file"}
    try:
        return {"ok": True, "content": target.read_text(encoding='utf-8', errors='replace')}
    except Exception as e:
        return {"ok": False, "error": str(e)}


class FileWriteBody(BaseModel):
    content: str


@router.put("/repos/{account_id}/{repo_name}/file")
async def write_file(account_id: str, repo_name: str, path: str, body: FileWriteBody):
    root = _repo_root(account_id, repo_name)
    if not root:
        return {"ok": False, "error": "Account not found"}
    try:
        target = _safe_path(root, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    if not target.is_file():
        return {"ok": False, "error": "File not found"}
    try:
        target.write_text(body.content, encoding='utf-8')
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
