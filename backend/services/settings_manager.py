"""
Persistent multi-account settings storage at ~/.config/z-cockpit/settings.json
"""
import json
import uuid
from pathlib import Path

CONFIG_PATH = Path.home() / ".config" / "z-cockpit" / "settings.json"
_MASK = "•"

ACCOUNT_DEFAULTS = {
    "id": "",
    "platform": "github",   # github | bitbucket
    "label": "",
    "username": "",
    "token": "",            # GitHub PAT or Bitbucket app password
    "workspace": "",        # Bitbucket workspace (defaults to username if blank)
    "clone_base_path": str(Path.home() / "Projects"),
}


def _mask(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return _MASK * len(token)
    return token[:4] + _MASK * (len(token) - 8) + token[-4:]


def _is_masked(value: str) -> bool:
    return _MASK in value


class SettingsManager:
    def __init__(self):
        self._accounts: list[dict] = []
        self._load()

    # ── I/O ───────────────────────────────────────────────────────────────────

    def _load(self):
        if not CONFIG_PATH.exists():
            return
        try:
            data = json.loads(CONFIG_PATH.read_text())
            # Migrate legacy flat format → accounts list
            if "accounts" in data:
                self._accounts = data["accounts"]
            elif "github_username" in data:
                self._accounts = [{
                    **ACCOUNT_DEFAULTS,
                    "id": str(uuid.uuid4()),
                    "platform": "github",
                    "label": "Default",
                    "username": data.get("github_username", ""),
                    "token": data.get("github_token", ""),
                    "clone_base_path": data.get("clone_base_path", ACCOUNT_DEFAULTS["clone_base_path"]),
                }]
                self._save()
        except Exception:
            pass

    def _save(self):
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps({"accounts": self._accounts}, indent=2))
        try:
            CONFIG_PATH.chmod(0o600)
        except Exception:
            pass

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _mask_account(self, acct: dict) -> dict:
        a = dict(acct)
        a["token"] = _mask(a.get("token", ""))
        return a

    def _expand_path(self, acct: dict) -> dict:
        a = dict(acct)
        a["clone_base_path"] = str(Path(a.get("clone_base_path", "~/Projects")).expanduser())
        ws = a.get("workspace", "").strip()
        if not ws:
            a["workspace"] = a.get("username", "")
        return a

    # ── Public API ────────────────────────────────────────────────────────────

    def get_accounts_masked(self) -> list[dict]:
        return [self._mask_account(a) for a in self._accounts]

    def get_account_raw(self, account_id: str) -> dict | None:
        for a in self._accounts:
            if a["id"] == account_id:
                return self._expand_path(a)
        return None

    def all_accounts_raw(self) -> list[dict]:
        return [self._expand_path(a) for a in self._accounts]

    def add_account(self, data: dict) -> dict:
        acct = {**ACCOUNT_DEFAULTS, **{k: v for k, v in data.items() if k in ACCOUNT_DEFAULTS}}
        acct["id"] = str(uuid.uuid4())
        self._accounts.append(acct)
        self._save()
        return self._mask_account(acct)

    def update_account(self, account_id: str, data: dict) -> dict | None:
        for i, a in enumerate(self._accounts):
            if a["id"] == account_id:
                for k, v in data.items():
                    if k == "token" and _is_masked(v):
                        continue    # don't overwrite with masked value
                    if k in ACCOUNT_DEFAULTS and k != "id":
                        a[k] = v
                self._accounts[i] = a
                self._save()
                return self._mask_account(a)
        return None

    def delete_account(self, account_id: str) -> bool:
        before = len(self._accounts)
        self._accounts = [a for a in self._accounts if a["id"] != account_id]
        if len(self._accounts) < before:
            self._save()
            return True
        return False


settings_manager = SettingsManager()
