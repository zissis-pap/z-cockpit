"""
Persistent settings storage at ~/.config/z-cockpit/settings.json
"""
import json
import os
from pathlib import Path

CONFIG_PATH = Path.home() / ".config" / "z-cockpit" / "settings.json"

DEFAULTS: dict = {
    "github_username": "",
    "github_token": "",
    "clone_base_path": str(Path.home() / "Projects"),
}

_MASK_CHAR = "•"


def _mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return _MASK_CHAR * len(token)
    return token[:4] + _MASK_CHAR * (len(token) - 8) + token[-4:]


class SettingsManager:
    def __init__(self):
        self._data: dict = dict(DEFAULTS)
        self._load()

    # ── File I/O ──────────────────────────────────────────────────────────────

    def _load(self):
        if CONFIG_PATH.exists():
            try:
                stored = json.loads(CONFIG_PATH.read_text())
                for k in DEFAULTS:
                    if k in stored:
                        self._data[k] = stored[k]
            except Exception:
                pass

    def _save(self):
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(self._data, indent=2))
        try:
            CONFIG_PATH.chmod(0o600)
        except Exception:
            pass

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def raw(self) -> dict:
        """Full settings including plaintext token — only for internal service use."""
        d = dict(self._data)
        d["clone_base_path"] = str(Path(d["clone_base_path"]).expanduser())
        return d

    def get_masked(self) -> dict:
        """Settings safe to return to the frontend — token is masked."""
        d = dict(self._data)
        d["github_token"] = _mask_token(d.get("github_token", ""))
        return d

    def update(self, data: dict) -> None:
        for key in DEFAULTS:
            if key not in data:
                continue
            value = data[key]
            # If the frontend sent back a masked token, ignore it
            if key == "github_token" and _MASK_CHAR in value:
                continue
            self._data[key] = value
        self._save()


settings_manager = SettingsManager()
