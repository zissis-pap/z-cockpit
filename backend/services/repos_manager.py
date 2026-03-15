"""Orchestrates multi-account git operations and WebSocket broadcasts."""
import asyncio
import subprocess
from pathlib import Path

from fastapi import WebSocket

from .settings_manager import settings_manager
from . import github_manager, bitbucket_manager


class ReposManager:
    def __init__(self):
        self._ws_clients: set[WebSocket] = set()

    # ── WebSocket ──────────────────────────────────────────────────────────────

    def add_client(self, ws: WebSocket):
        self._ws_clients.add(ws)

    def remove_client(self, ws: WebSocket):
        self._ws_clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        for ws in self._ws_clients:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    async def _log(self, repo_key: str, text: str, level: str = 'info'):
        await self.broadcast({'type': 'log', 'repo': repo_key, 'text': text, 'level': level})

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _resolve(self, account_id: str, repo_name: str):
        """Returns (account, repo_path, repo_key) or raises ValueError."""
        account = settings_manager.get_account_raw(account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")
        repo_path = Path(account['clone_base_path']) / repo_name
        repo_key = f"{account_id}/{repo_name}"
        return account, repo_path, repo_key

    async def _run(self, args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        return proc.returncode, stdout.decode(errors='replace'), stderr.decode(errors='replace')

    async def _stream_proc(self, args: list[str], cwd: Path, repo_key: str) -> bool:
        """Run a subprocess, stream output as log messages, return success."""
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            async for raw_line in proc.stdout:
                text = raw_line.decode(errors='replace').rstrip()
                if text:
                    await self._log(repo_key, text)
            await proc.wait()
            return proc.returncode == 0
        except Exception as e:
            await self._log(repo_key, str(e), 'error')
            return False

    # ── Status ─────────────────────────────────────────────────────────────────

    async def get_status(self, account_id: str, repo_name: str) -> dict:
        try:
            _, repo_path, _ = self._resolve(account_id, repo_name)
        except ValueError:
            return {'status': 'unknown', 'local_path': ''}

        if not (repo_path / '.git').exists():
            return {'status': 'not_cloned', 'local_path': ''}

        # Local changes
        rc, stdout, _ = await self._run(['git', 'status', '--porcelain'], cwd=repo_path)
        has_changes = bool(stdout.strip()) if rc == 0 else False

        # Ahead/behind vs upstream (uses cached remote info, no network)
        ahead = 0
        behind = 0
        rc2, out2, _ = await self._run(
            ['git', 'rev-list', '--count', '--left-right', 'HEAD...@{u}'],
            cwd=repo_path,
        )
        if rc2 == 0 and out2.strip():
            parts = out2.strip().split()
            if len(parts) == 2:
                ahead = int(parts[0])
                behind = int(parts[1])

        if has_changes and behind > 0:
            status = 'diverged'
        elif has_changes:
            status = 'dirty'
        elif behind > 0:
            status = 'behind'
        elif ahead > 0:
            status = 'ahead'
        else:
            status = 'clean'

        return {'status': status, 'local_path': str(repo_path), 'ahead': ahead, 'behind': behind}

    def get_changed_files(self, account_id: str, repo_name: str) -> list[dict]:
        try:
            _, repo_path, _ = self._resolve(account_id, repo_name)
        except ValueError:
            return []
        if not repo_path.exists():
            return []
        result = subprocess.run(
            ['git', 'status', '--porcelain'],
            cwd=str(repo_path), capture_output=True, text=True,
        )
        files = []
        for line in result.stdout.splitlines():
            if len(line) >= 4:
                code = line[:2].strip() or '?'
                files.append({'code': code, 'file': line[3:]})
        return files

    # ── Git operations ─────────────────────────────────────────────────────────

    async def clone(self, account_id: str, repo_name: str, clone_url: str):
        try:
            account, repo_path, repo_key = self._resolve(account_id, repo_name)
        except ValueError as e:
            return

        await self.broadcast({'type': 'op_start', 'op': 'clone', 'repo': repo_key})
        platform = account.get('platform', 'github')
        if platform == 'bitbucket':
            auth_url = bitbucket_manager.make_auth_clone_url(clone_url, account['username'], account['token'])
        else:
            auth_url = github_manager.make_auth_clone_url(clone_url, account['token'])

        repo_path.parent.mkdir(parents=True, exist_ok=True)
        ok = await self._stream_proc(['git', 'clone', auth_url, str(repo_path)], cwd=repo_path.parent, repo_key=repo_key)
        await self.broadcast({'type': 'op_done', 'op': 'clone', 'repo': repo_key, 'ok': ok})

    async def pull(self, account_id: str, repo_name: str):
        try:
            _, repo_path, repo_key = self._resolve(account_id, repo_name)
        except ValueError:
            return
        await self.broadcast({'type': 'op_start', 'op': 'pull', 'repo': repo_key})
        ok = await self._stream_proc(['git', 'pull'], cwd=repo_path, repo_key=repo_key)
        await self.broadcast({'type': 'op_done', 'op': 'pull', 'repo': repo_key, 'ok': ok})

    async def fetch(self, account_id: str, repo_name: str):
        try:
            _, repo_path, repo_key = self._resolve(account_id, repo_name)
        except ValueError:
            return
        await self.broadcast({'type': 'op_start', 'op': 'fetch', 'repo': repo_key})
        ok = await self._stream_proc(['git', 'fetch'], cwd=repo_path, repo_key=repo_key)
        await self.broadcast({'type': 'op_done', 'op': 'fetch', 'repo': repo_key, 'ok': ok})

    async def commit_and_push(self, account_id: str, repo_name: str, message: str):
        import re
        try:
            account, repo_path, repo_key = self._resolve(account_id, repo_name)
        except ValueError:
            return
        await self.broadcast({'type': 'op_start', 'op': 'commit', 'repo': repo_key})

        # Stage
        ok = await self._stream_proc(['git', 'add', '-A'], cwd=repo_path, repo_key=repo_key)
        if not ok:
            await self.broadcast({'type': 'op_done', 'op': 'commit', 'repo': repo_key, 'ok': False})
            return

        # Commit (allow "nothing to commit" — exit 1 but not a fatal error)
        await self._stream_proc(['git', 'commit', '-m', message], cwd=repo_path, repo_key=repo_key)

        # Push with credentials injected into the remote URL
        rc, remote_url, _ = await self._run(['git', 'remote', 'get-url', 'origin'], cwd=repo_path)
        if rc != 0:
            await self._log(repo_key, 'Could not determine remote URL', 'error')
            await self.broadcast({'type': 'op_done', 'op': 'commit', 'repo': repo_key, 'ok': False})
            return

        # Strip any existing embedded credentials before re-injecting
        clean_url = re.sub(r'https://[^@]+@', 'https://', remote_url.strip())
        platform = account.get('platform', 'github')
        if platform == 'bitbucket':
            auth_url = bitbucket_manager.make_auth_clone_url(clean_url, account['username'], account['token'])
        else:
            auth_url = github_manager.make_auth_clone_url(clean_url, account['token'])

        ok = await self._stream_proc(['git', 'push', auth_url, 'HEAD'], cwd=repo_path, repo_key=repo_key)
        await self.broadcast({'type': 'op_done', 'op': 'commit', 'repo': repo_key, 'ok': ok})


repos_manager = ReposManager()
