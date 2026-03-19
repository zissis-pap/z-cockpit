"""
Script runner — executes JSON step-based scripts against OpenOCD / Serial.
Supports both local managers and remote z-cockpit agents.
"""
import asyncio
import base64
import json
import re
import time
from pathlib import Path
from typing import Optional
from fastapi import WebSocket

from backend.services.openocd_manager import openocd_manager
from backend.services.serial_manager import serial_manager
from backend.services.remotes_manager import remotes_manager
from backend.services.remote_client import RemoteClient

SCRIPTS_FILE = Path(__file__).parent.parent.parent / "config" / "scripts.json"


def _load_scripts() -> list[dict]:
    try:
        return json.loads(SCRIPTS_FILE.read_text())
    except Exception:
        return []


def _save_scripts(scripts: list[dict]):
    SCRIPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCRIPTS_FILE.write_text(json.dumps(scripts, indent=2))


def _interpolate(value: str, ctx: dict) -> str:
    return re.sub(r'\{(\w+)\}', lambda m: str(ctx.get(m.group(1), m.group(0))), value)


def _interpolate_step(step: dict, ctx: dict) -> dict:
    return {k: _interpolate(v, ctx) if isinstance(v, str) else v for k, v in step.items()}


class ScriptRunner:
    def __init__(self):
        self._ws_clients: set[WebSocket] = set()
        self._stop_flag = False
        self._running = False

    # ── WebSocket ──────────────────────────────────────────────────────────────

    def add_ws_client(self, ws: WebSocket):
        self._ws_clients.add(ws)

    def remove_ws_client(self, ws: WebSocket):
        self._ws_clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        for ws in list(self._ws_clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    # ── Script CRUD ────────────────────────────────────────────────────────────

    def list_scripts(self) -> list[dict]:
        return [
            {"id": s["id"], "name": s["name"], "file_keys": list(s.get("files", {}).keys())}
            for s in _load_scripts()
        ]

    def get_script(self, script_id: int) -> Optional[dict]:
        for s in _load_scripts():
            if s["id"] == script_id:
                return s
        return None

    def upsert_script(self, script: dict) -> dict:
        scripts = _load_scripts()
        for i, s in enumerate(scripts):
            if s["id"] == script["id"]:
                scripts[i] = script
                _save_scripts(scripts)
                return script
        scripts.append(script)
        _save_scripts(scripts)
        return script

    def delete_script(self, script_id: int) -> bool:
        scripts = _load_scripts()
        new = [s for s in scripts if s["id"] != script_id]
        if len(new) == len(scripts):
            return False
        _save_scripts(new)
        return True

    # ── Execution ──────────────────────────────────────────────────────────────

    def stop(self):
        self._stop_flag = True

    @property
    def running(self) -> bool:
        return self._running

    async def run(self, script_id: int, remote_id: Optional[str] = None):
        if self._running:
            await self.broadcast({"type": "error", "message": "A script is already running"})
            return

        script = self.get_script(script_id)
        if not script:
            await self.broadcast({"type": "error", "message": "Script not found"})
            return

        try:
            steps = json.loads(script["src"])
        except Exception as e:
            await self.broadcast({"type": "error", "message": f"Invalid script JSON: {e}"})
            return

        files = script.get("files", {})

        # Resolve remote client (None = local)
        remote: Optional[RemoteClient] = None
        if remote_id:
            cfg = remotes_manager.get(remote_id)
            if not cfg:
                await self.broadcast({"type": "error", "message": f"Remote '{remote_id}' not found"})
                return
            remote = RemoteClient(cfg["host"], cfg["port"], cfg.get("token", ""))

        self._running = True
        self._stop_flag = False

        target_label = cfg["name"] if remote_id and cfg else "local"
        await self.broadcast({
            "type": "start",
            "script_id": script_id,
            "step_count": len(steps),
            "target": target_label,
        })

        ctx: dict = {}
        try:
            for i, step in enumerate(steps):
                if self._stop_flag:
                    await self.broadcast({"type": "stopped", "step": i})
                    return

                step = _interpolate_step(step, ctx)
                await self.broadcast({"type": "step_start", "index": i})

                try:
                    result = await self._execute_step(step, files, ctx, remote)
                    if step.get("save_as"):
                        ctx[step["save_as"]] = result or ""
                    await self.broadcast({
                        "type": "step_done",
                        "index": i,
                        "result": str(result) if result is not None else "",
                    })
                except asyncio.CancelledError:
                    await self.broadcast({"type": "stopped", "step": i})
                    return
                except Exception as e:
                    await self.broadcast({"type": "step_error", "index": i, "error": str(e)})
                    return

            await self.broadcast({"type": "done"})
        finally:
            self._running = False
            self._stop_flag = False
            if remote:
                await remote.close()

    async def _execute_step(self, step: dict, files: dict, ctx: dict,
                            remote: Optional[RemoteClient] = None) -> Optional[str]:
        t = step.get("type", "")

        # ── set_var ──────────────────────────────────────────────────────────
        if t == "set_var":
            ctx[step["name"]] = step.get("value", "")
            return step.get("value", "")

        # ── log ──────────────────────────────────────────────────────────────
        if t == "log":
            msg = step.get("message", "")
            await self.broadcast({"type": "log", "message": msg})
            return msg

        # ── delay ────────────────────────────────────────────────────────────
        if t == "delay":
            seconds = float(step.get("seconds", 1))
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if self._stop_flag:
                    raise asyncio.CancelledError("stopped")
                await asyncio.sleep(0.1)
            return f"waited {seconds}s"

        # ── openocd_start ────────────────────────────────────────────────────
        if t == "openocd_start":
            iface = step.get("interface", "interface/stlink.cfg")
            tgt   = step.get("target", "")
            config = {"executable": "openocd", "interface_config": iface, "target_config": tgt}

            if remote:
                result = await remote.start(config)
                if not result.get("ok"):
                    raise RuntimeError(result.get("error", "Failed to start OpenOCD on remote"))
                await asyncio.sleep(1.0)
                for _ in range(30):
                    if self._stop_flag: raise asyncio.CancelledError("stopped")
                    conn = await remote.connect()
                    if conn.get("ok"): break
                    await asyncio.sleep(0.5)
                else:
                    raise RuntimeError("Remote OpenOCD did not become ready in time")
            else:
                if openocd_manager.server_status != "running":
                    result = await openocd_manager.start(config)
                    if not result.get("ok"):
                        raise RuntimeError(result.get("error", "Failed to start OpenOCD"))
                    await asyncio.sleep(1.0)
                if not openocd_manager.connected:
                    for _ in range(30):
                        if self._stop_flag: raise asyncio.CancelledError("stopped")
                        conn = await openocd_manager.connect()
                        if conn.get("ok"): break
                        await asyncio.sleep(0.5)
                    else:
                        raise RuntimeError("OpenOCD did not become ready in time")
            return "started"

        # ── openocd (raw TCL) ─────────────────────────────────────────────────
        if t == "openocd":
            cmd = step.get("cmd", "")
            result = await (remote.send_command(cmd) if remote else openocd_manager.send_command(cmd))
            if result.startswith("ERROR:"):
                raise RuntimeError(result)
            return result

        # ── shorthand TCL commands ────────────────────────────────────────────
        if t == "halt":
            return await (remote.send_command("halt") if remote else openocd_manager.send_command("halt"))

        if t == "resume":
            return await (remote.send_command("resume") if remote else openocd_manager.send_command("resume"))

        if t == "reset":
            return await (remote.send_command("reset run") if remote else openocd_manager.send_command("reset run"))

        if t == "erase":
            return await (remote.flash_erase_chip() if remote else openocd_manager.flash_erase_chip())

        # ── flash ─────────────────────────────────────────────────────────────
        if t == "flash":
            file_key = step.get("file_key")
            file_path_str = step.get("file_path")
            address  = step.get("address", "0x08000000")
            verify   = bool(step.get("verify", True))
            do_reset = bool(step.get("do_reset", True))

            if remote:
                if file_key and file_key in files:
                    data = base64.b64decode(files[file_key])
                    filename = await remote.upload_firmware(data, file_key)
                elif file_path_str:
                    with open(file_path_str, "rb") as f:
                        data = f.read()
                    import os
                    filename = await remote.upload_firmware(data, os.path.basename(file_path_str))
                else:
                    raise RuntimeError("flash step requires file_key or file_path")
                result = await remote.flash_program(filename, address, verify, do_reset)
            else:
                if file_key and file_key in files:
                    data = base64.b64decode(files[file_key])
                    firmware_path = str(openocd_manager.upload_dir / file_key)
                    with open(firmware_path, "wb") as f:
                        f.write(data)
                elif file_path_str:
                    firmware_path = file_path_str
                else:
                    raise RuntimeError("flash step requires file_key (with attached .bin) or file_path")
                result = await openocd_manager.flash_program(firmware_path, address, verify)
                if do_reset:
                    await openocd_manager.send_command("reset run")
            return result

        # ── uart_connect ──────────────────────────────────────────────────────
        if t == "uart_connect":
            port = step.get("port", "")
            baud = int(step.get("baud_rate", 115200))
            if remote:
                if remote.serial_connected and remote.serial_port == port:
                    return "already connected"
                if remote.serial_connected:
                    await remote.disconnect_serial()
                result = await remote.connect_serial(port, baud)
                if not result.get("ok"):
                    raise RuntimeError(result.get("error", "Failed to connect remote serial"))
            else:
                if serial_manager.connected and serial_manager.port == port:
                    return "already connected"
                if serial_manager.connected:
                    await serial_manager.disconnect()
                result = await serial_manager.connect(port, baud)
                if not result.get("ok"):
                    raise RuntimeError(result.get("error", "Failed to connect serial"))
            return "connected"

        # ── uart_disconnect ───────────────────────────────────────────────────
        if t == "uart_disconnect":
            if remote:
                await remote.disconnect_serial()
            else:
                await serial_manager.disconnect()
            return "disconnected"

        # ── uart_send ─────────────────────────────────────────────────────────
        if t == "uart_send":
            data_str = step.get("data", "")
            data_str = data_str.replace("\\n", "\n").replace("\\r", "\r")
            if remote:
                result = await remote.send_serial(data_str, "ascii", "none")
            else:
                result = await serial_manager.send(data_str, "ascii", "none")
            if not result.get("ok"):
                raise RuntimeError(result.get("error", "Failed to send"))
            return f"sent {len(data_str)} bytes"

        # ── uart_wait ─────────────────────────────────────────────────────────
        if t == "uart_wait":
            pattern = step.get("pattern", "")
            timeout = float(step.get("timeout", 10))
            return await self._uart_wait(pattern, timeout, remote)

        # ── uart_extract ──────────────────────────────────────────────────────
        if t == "uart_extract":
            pattern = step.get("pattern", "")
            group   = int(step.get("group", 1))
            timeout = float(step.get("timeout", 10))
            full_match = await self._uart_wait(pattern, timeout, remote)
            m = re.search(pattern, full_match)
            if m:
                try:
                    return m.group(group)
                except IndexError:
                    pass
            return full_match

        # ── exec ──────────────────────────────────────────────────────────────
        if t == "exec":
            cmd = step.get("command", "")
            timeout = float(step.get("timeout", 30))
            proc = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                return stdout.decode("utf-8", errors="replace").strip()
            except asyncio.TimeoutError:
                proc.kill()
                raise RuntimeError(f"exec timed out after {timeout}s")

        raise RuntimeError(f"Unknown step type: '{t}'")

    async def _uart_wait(self, pattern: str, timeout: float,
                         remote: Optional[RemoteClient] = None) -> str:
        queue: asyncio.Queue = asyncio.Queue()
        if remote:
            remote.add_rx_listener(queue)
        else:
            serial_manager.add_rx_listener(queue)
        buf = ""
        deadline = time.monotonic() + timeout
        try:
            while True:
                if self._stop_flag:
                    raise asyncio.CancelledError("stopped")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(f"uart_wait timed out waiting for: {pattern!r}")
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=min(0.1, remaining))
                    buf += chunk
                    if re.search(pattern, buf):
                        return buf
                except asyncio.TimeoutError:
                    continue
        finally:
            if remote:
                remote.remove_rx_listener(queue)
            else:
                serial_manager.remove_rx_listener(queue)


script_runner = ScriptRunner()
