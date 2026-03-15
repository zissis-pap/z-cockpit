"""
GitHub API client and local git operations manager.
"""
import asyncio
import json
import subprocess
from pathlib import Path
from typing import Set
from fastapi import WebSocket

from backend.services.settings_manager import settings_manager

_GH_API = "https://api.github.com"
_TIMEOUT = 15.0


class GitHubManager:
    def __init__(self):
        self.ws_clients: Set[WebSocket] = set()

    # ── WebSocket broadcast ───────────────────────────────────────────────────

    def add_client(self, ws: WebSocket):
        self.ws_clients.add(ws)

    def remove_client(self, ws: WebSocket):
        self.ws_clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        payload = json.dumps(msg)
        for ws in self.ws_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        self.ws_clients -= dead

    async def log(self, text: str, level: str = "info", repo: str = ""):
        await self.broadcast({"type": "log", "text": text, "level": level, "repo": repo})

    # ── GitHub REST API ───────────────────────────────────────────────────────

    async def test_connection(self, username: str, token: str) -> dict:
        import httpx
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{_GH_API}/user", headers=headers)
            if r.status_code == 200:
                data = r.json()
                return {"ok": True, "login": data.get("login"), "name": data.get("name")}
            return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def list_repos(self, username: str, token: str) -> list[dict]:
        import httpx
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        all_repos: list[dict] = []
        page = 1
        async with httpx.AsyncClient(timeout=15) as client:
            while True:
                url = f"{_GH_API}/user/repos" if token else f"{_GH_API}/users/{username}/repos"
                params = {"per_page": 100, "page": page, "sort": "updated", "affiliation": "owner,collaborator"}
                try:
                    r = await client.get(url, headers=headers, params=params)
                    if r.status_code != 200:
                        break
                    batch = r.json()
                    if not batch:
                        break
                    all_repos.extend(batch)
                    page += 1
                    if len(batch) < 100:
                        break
                except Exception:
                    break
        return all_repos

    # ── Local git status ──────────────────────────────────────────────────────

    def local_path(self, repo_name: str) -> Path:
        base = Path(settings_manager.raw["clone_base_path"])
        return base / repo_name

    def get_status(self, repo_name: str) -> dict:
        path = self.local_path(repo_name)

        if not path.exists() or not (path / ".git").exists():
            return {"status": "not_cloned", "local_path": str(path)}

        # Local changes
        has_changes = False
        try:
            r = subprocess.run(
                ["git", "-C", str(path), "status", "--porcelain"],
                capture_output=True, text=True, timeout=5,
            )
            has_changes = bool(r.stdout.strip())
        except Exception:
            pass

        # Behind remote (uses cached fetch data — no network call)
        behind = 0
        try:
            r = subprocess.run(
                ["git", "-C", str(path), "rev-list", "--count", "HEAD..@{u}"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0 and r.stdout.strip().isdigit():
                behind = int(r.stdout.strip())
        except Exception:
            pass

        if has_changes and behind > 0:
            status = "diverged"
        elif has_changes:
            status = "dirty"
        elif behind > 0:
            status = "behind"
        else:
            status = "clean"

        return {"status": status, "local_path": str(path), "has_changes": has_changes, "behind": behind}

    async def get_status_async(self, repo_name: str) -> dict:
        return await asyncio.wait_for(
            asyncio.to_thread(self.get_status, repo_name),
            timeout=5.0,
        )

    def get_changed_files(self, repo_name: str) -> list[dict]:
        path = self.local_path(repo_name)
        try:
            r = subprocess.run(
                ["git", "-C", str(path), "status", "--porcelain"],
                capture_output=True, text=True, timeout=5,
            )
            files = []
            for line in r.stdout.splitlines():
                if len(line) >= 3:
                    files.append({"code": line[:2].strip(), "file": line[3:]})
            return files
        except Exception:
            return []

    # ── Git operations ────────────────────────────────────────────────────────

    async def clone(self, repo_name: str, clone_url: str):
        s = settings_manager.raw
        token = s.get("github_token", "")
        base = Path(s["clone_base_path"])
        base.mkdir(parents=True, exist_ok=True)
        dest = str(base / repo_name)

        if token and "github.com" in clone_url:
            auth_url = clone_url.replace("https://", f"https://{token}@")
        else:
            auth_url = clone_url

        await self._run_op(repo_name, "clone", ["git", "clone", auth_url, dest])

    async def pull(self, repo_name: str):
        path = str(self.local_path(repo_name))
        await self._run_op(repo_name, "pull", ["git", "-C", path, "pull"])

    async def fetch(self, repo_name: str):
        path = str(self.local_path(repo_name))
        await self._run_op(repo_name, "fetch", ["git", "-C", path, "fetch", "origin", "-q"])

    async def commit_and_push(self, repo_name: str, message: str):
        path = str(self.local_path(repo_name))
        s = settings_manager.raw
        token = s.get("github_token", "")

        # Inject token into push URL
        if token:
            r = subprocess.run(
                ["git", "-C", path, "remote", "get-url", "origin"],
                capture_output=True, text=True,
            )
            remote_url = r.stdout.strip()
            if remote_url and "github.com" in remote_url and f"{token}@" not in remote_url:
                new_url = remote_url.replace("https://", f"https://{token}@")
                subprocess.run(["git", "-C", path, "remote", "set-url", "origin", new_url])

        cmds = [
            ["git", "-C", path, "add", "-A"],
            ["git", "-C", path, "commit", "-m", message],
            ["git", "-C", path, "push"],
        ]
        await self._run_sequence(repo_name, "commit", cmds)

    # ── Subprocess helpers ────────────────────────────────────────────────────

    async def _run_op(self, repo_name: str, op: str, cmd: list):
        await self.broadcast({"type": "op_start", "repo": repo_name, "op": op})
        ok = True
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            async for line in proc.stdout:
                await self.log(line.decode("utf-8", errors="replace").rstrip(), repo=repo_name)
            await proc.wait()
            ok = proc.returncode == 0
        except Exception as e:
            await self.log(f"Error: {e}", level="error", repo=repo_name)
            ok = False
        await self.broadcast({"type": "op_done", "repo": repo_name, "op": op, "ok": ok})

    async def _run_sequence(self, repo_name: str, op: str, cmds: list):
        await self.broadcast({"type": "op_start", "repo": repo_name, "op": op})
        ok = True
        for cmd in cmds:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                async for line in proc.stdout:
                    await self.log(line.decode("utf-8", errors="replace").rstrip(), repo=repo_name)
                await proc.wait()
                if proc.returncode != 0:
                    ok = False
                    break
            except Exception as e:
                await self.log(f"Error: {e}", level="error", repo=repo_name)
                ok = False
                break
        await self.broadcast({"type": "op_done", "repo": repo_name, "op": op, "ok": ok})


github_manager = GitHubManager()
