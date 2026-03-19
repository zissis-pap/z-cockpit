"""
Remote agent registry — stores and manages remote z-cockpit agent connections.
"""
import json
import uuid
from pathlib import Path
from typing import Optional

REMOTES_FILE = Path(__file__).parent.parent.parent / "config" / "remotes.json"


def _load() -> list[dict]:
    try:
        return json.loads(REMOTES_FILE.read_text())
    except Exception:
        return []


def _save(remotes: list[dict]):
    REMOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    REMOTES_FILE.write_text(json.dumps(remotes, indent=2))


class RemotesManager:
    def list(self) -> list[dict]:
        return [self._public(r) for r in _load()]

    def get(self, remote_id: str) -> Optional[dict]:
        for r in _load():
            if r["id"] == remote_id:
                return r
        return None

    def add(self, name: str, host: str, port: int, token: str = "") -> dict:
        remotes = _load()
        remote = {"id": str(uuid.uuid4())[:8], "name": name, "host": host,
                  "port": port, "token": token}
        remotes.append(remote)
        _save(remotes)
        return self._public(remote)

    def update(self, remote_id: str, name: str, host: str, port: int, token: str = "") -> Optional[dict]:
        remotes = _load()
        for r in remotes:
            if r["id"] == remote_id:
                r.update({"name": name, "host": host, "port": port})
                if token:          # empty string = keep existing
                    r["token"] = token
                _save(remotes)
                return self._public(r)
        return None

    def delete(self, remote_id: str) -> bool:
        remotes = _load()
        new = [r for r in remotes if r["id"] != remote_id]
        if len(new) == len(remotes):
            return False
        _save(new)
        return True

    async def test(self, remote_id: str) -> dict:
        import httpx
        r = self.get(remote_id)
        if not r:
            return {"ok": False, "error": "Not found"}
        base = f"http://{r['host']}:{r['port']}"
        headers = {"X-Token": r["token"]} if r.get("token") else {}
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(base + "/", headers=headers)
                if resp.status_code == 401:
                    return {"ok": False, "error": "Auth failed — wrong token?"}
                data = resp.json()
                return {"ok": True, "info": data}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @staticmethod
    def _public(r: dict) -> dict:
        """Return remote dict without exposing the raw token."""
        return {
            "id":       r["id"],
            "name":     r["name"],
            "host":     r["host"],
            "port":     r["port"],
            "has_token": bool(r.get("token")),
        }


remotes_manager = RemotesManager()
