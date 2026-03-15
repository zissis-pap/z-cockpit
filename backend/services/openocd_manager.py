"""
OpenOCD process manager with async telnet client and WebSocket broadcasting.
"""
import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Set
from fastapi import WebSocket


class OpenOCDManager:
    def __init__(self):
        self.process: Optional[asyncio.subprocess.Process] = None
        self.telnet_reader: Optional[asyncio.StreamReader] = None
        self.telnet_writer: Optional[asyncio.StreamWriter] = None
        self.ws_clients: Set[WebSocket] = set()
        self.server_status: str = "stopped"   # stopped | starting | running | error
        self.connected: bool = False
        self.executable: str = "openocd"
        self.interface_config: str = "interface/stlink.cfg"
        self.target_config: str = ""
        self.custom_config: str = ""
        self.telnet_port: int = 4444
        self.tcl_port: int = 6666
        self._log_task: Optional[asyncio.Task] = None
        self._command_lock = asyncio.Lock()
        self.upload_dir = Path(tempfile.gettempdir()) / "z-cockpit"
        self.upload_dir.mkdir(exist_ok=True)

    # ──────────────────────────────────────────────────────────────────────────
    # WebSocket management
    # ──────────────────────────────────────────────────────────────────────────

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

    async def log(self, text: str, level: str = "info"):
        await self.broadcast({"type": "log", "text": text, "level": level})

    # ──────────────────────────────────────────────────────────────────────────
    # Server lifecycle
    # ──────────────────────────────────────────────────────────────────────────

    async def start(self, config: dict):
        if self.process and self.process.returncode is None:
            await self.log("Server already running", "warn")
            return {"ok": False, "error": "Already running"}

        self.executable = config.get("executable", "openocd")
        self.interface_config = config.get("interface_config", "interface/stlink.cfg")
        self.target_config = config.get("target_config", "")
        self.custom_config = config.get("custom_config", "")
        self.telnet_port = config.get("telnet_port", 4444)
        self.tcl_port = config.get("tcl_port", 6666)

        cmd = [self.executable]
        cmd += ["-f", self.interface_config]

        if self.custom_config:
            cmd += ["-f", self.custom_config]
        elif self.target_config:
            cmd += ["-f", self.target_config]

        cmd += ["-c", f"telnet_port {self.telnet_port}"]
        cmd += ["-c", f"tcl_port {self.tcl_port}"]

        cmd_str = " ".join(cmd)
        await self.log(f"Starting: {cmd_str}", "info")

        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            self.server_status = "starting"
            await self.broadcast({"type": "status", "server": "starting", "pid": self.process.pid})
            self._log_task = asyncio.create_task(self._read_process_output())
            return {"ok": True, "pid": self.process.pid, "cmd": cmd_str}
        except FileNotFoundError:
            self.server_status = "error"
            await self.log(f"openocd executable not found: {self.executable}", "error")
            return {"ok": False, "error": f"Executable not found: {self.executable}"}
        except Exception as e:
            self.server_status = "error"
            await self.log(f"Failed to start: {e}", "error")
            return {"ok": False, "error": str(e)}

    async def stop(self):
        if self._log_task:
            self._log_task.cancel()
            self._log_task = None

        await self.disconnect()

        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
            except Exception:
                pass
            self.process = None

        self.server_status = "stopped"
        await self.broadcast({"type": "status", "server": "stopped", "connected": False})
        await self.log("OpenOCD server stopped", "info")
        return {"ok": True}

    async def get_status(self):
        running = self.process is not None and self.process.returncode is None
        if running and self.server_status == "starting":
            self.server_status = "running"
        elif not running and self.server_status != "stopped":
            self.server_status = "stopped"
        return {
            "server": self.server_status,
            "connected": self.connected,
            "pid": self.process.pid if running else None,
        }

    async def _read_process_output(self):
        """Stream process stdout/stderr to WebSocket clients."""
        assert self.process and self.process.stdout
        try:
            async for line in self.process.stdout:
                text = line.decode("utf-8", errors="replace").rstrip()
                level = "info"
                tl = text.lower()
                if "error" in tl or "failed" in tl:
                    level = "error"
                elif "warn" in tl:
                    level = "warn"
                elif "info" in tl:
                    level = "info"
                await self.log(text, level)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await self.log(f"Log reader error: {e}", "error")
        finally:
            rc = self.process.returncode if self.process else None
            self.server_status = "stopped"
            await self.broadcast({"type": "status", "server": "stopped", "connected": False, "returncode": rc})

    # ──────────────────────────────────────────────────────────────────────────
    # Telnet (command) connection
    # ──────────────────────────────────────────────────────────────────────────

    async def connect(self):
        if self.connected:
            return {"ok": False, "error": "Already connected"}
        try:
            self.telnet_reader, self.telnet_writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", self.telnet_port),
                timeout=5.0,
            )
            # Read initial banner + prompt
            await asyncio.wait_for(self._read_until_prompt(), timeout=5.0)
            self.connected = True
            await self.broadcast({"type": "status", "server": self.server_status, "connected": True})
            await self.log("Telnet connected", "info")
            return {"ok": True}
        except asyncio.TimeoutError:
            return {"ok": False, "error": "Connection timed out — is OpenOCD running?"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def disconnect(self):
        if self.telnet_writer:
            try:
                self.telnet_writer.close()
                await self.telnet_writer.wait_closed()
            except Exception:
                pass
            self.telnet_writer = None
            self.telnet_reader = None
        self.connected = False
        await self.broadcast({"type": "status", "server": self.server_status, "connected": False})
        return {"ok": True}

    async def _read_until_prompt(self) -> str:
        """Read from telnet until the '> ' prompt appears."""
        assert self.telnet_reader
        buf = b""
        while True:
            chunk = await self.telnet_reader.read(4096)
            if not chunk:
                break
            buf += chunk
            if buf.endswith(b"> "):
                break
        return buf.decode("utf-8", errors="replace")

    async def send_command(self, cmd: str) -> str:
        if not self.connected or not self.telnet_writer or not self.telnet_reader:
            return "ERROR: Not connected"
        async with self._command_lock:
            try:
                self.telnet_writer.write(f"{cmd}\n".encode())
                await self.telnet_writer.drain()
                raw = await asyncio.wait_for(self._read_until_prompt(), timeout=30.0)
                # Strip command echo (first line) and trailing prompt
                lines = raw.split("\n")
                # Remove echo of sent command
                if lines and lines[0].strip() == cmd.strip():
                    lines = lines[1:]
                result = "\n".join(lines).rstrip("> ").strip()
                return result
            except asyncio.TimeoutError:
                return "ERROR: Command timed out"
            except Exception as e:
                self.connected = False
                return f"ERROR: {e}"

    # ──────────────────────────────────────────────────────────────────────────
    # Flash operations
    # ──────────────────────────────────────────────────────────────────────────

    async def flash_halt(self) -> str:
        resp = await self.send_command("halt")
        await self.log(f"halt -> {resp}", "info")
        return resp

    async def flash_erase(self, address: str, size: str) -> str:
        cmd = f"flash erase_address {address} {size}"
        resp = await self.send_command(cmd)
        await self.log(f"{cmd} -> {resp}", "info" if "error" not in resp.lower() else "error")
        return resp

    async def flash_program(self, filename: str, address: str, verify: bool = True) -> str:
        verify_flag = " verify" if verify else ""
        cmd = f"program {filename}{verify_flag} reset exit"
        resp = await self.send_command(cmd)
        await self.log(f"program -> {resp}", "info" if "error" not in resp.lower() else "error")
        return resp

    async def flash_read(self, filename: str, address: str, size: str) -> str:
        cmd = f"dump_image {filename} {address} {size}"
        resp = await self.send_command(cmd)
        await self.log(f"dump_image -> {resp}", "info")
        return resp

    async def flash_reset_run(self) -> str:
        resp = await self.send_command("reset run")
        await self.log(f"reset run -> {resp}", "info")
        return resp

    async def flash_verify(self, filename: str, address: str) -> str:
        cmd = f"verify_image {filename} {address}"
        resp = await self.send_command(cmd)
        await self.log(f"verify_image -> {resp}", "info" if "error" not in resp.lower() else "error")
        return resp

    # ──────────────────────────────────────────────────────────────────────────
    # Memory operations
    # ──────────────────────────────────────────────────────────────────────────

    async def memory_read(self, address: str, size: int) -> list[dict]:
        """Returns list of {address, words} dicts parsed from mdw output."""
        word_count = (size + 3) // 4
        cmd = f"mdw {address} {word_count}"
        raw = await self.send_command(cmd)
        return self._parse_mdw(raw)

    def _parse_mdw(self, raw: str) -> list[dict]:
        rows = []
        for line in raw.splitlines():
            line = line.strip()
            if ":" not in line:
                continue
            parts = line.split(":", 1)
            if len(parts) != 2:
                continue
            addr_str = parts[0].strip()
            words_str = parts[1].strip().split()
            try:
                addr = int(addr_str, 16)
                words = [int(w, 16) for w in words_str if len(w) == 8]
                rows.append({"address": addr_str, "words": words})
            except ValueError:
                continue
        return rows

    async def memory_write_word(self, address: str, value: str) -> str:
        cmd = f"mww {address} {value}"
        resp = await self.send_command(cmd)
        await self.log(f"mww -> {resp}", "info")
        return resp

    async def flash_info(self) -> str:
        return await self.send_command("flash info 0")


openocd_manager = OpenOCDManager()
