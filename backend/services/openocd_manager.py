"""
OpenOCD process manager with async telnet client and WebSocket broadcasting.
"""
import asyncio
import json
import os
import re
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
        if running:
            self.server_status = "running"
        elif self.server_status != "stopped":
            self.server_status = "stopped"
        return {
            "server": self.server_status,
            "connected": self.connected,
            "pid": self.process.pid if running else None,
        }

    async def _read_process_output(self):
        """Stream process stdout/stderr to WebSocket clients."""
        assert self.process and self.process.stdout
        # Use chunked reads to avoid asyncio's 64 KB readline limit
        # (LimitOverrunError on verbose/debug OpenOCD output).
        buf = b""
        try:
            while True:
                chunk = await self.process.stdout.read(4096)
                if not chunk:
                    break  # EOF — process has exited
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = line.decode("utf-8", errors="replace").rstrip()
                    if not text:
                        continue
                    tl = text.lower()
                    if "error" in tl or "failed" in tl:
                        level = "error"
                    elif "warn" in tl:
                        level = "warn"
                    else:
                        level = "info"
                    await self.log(text, level)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await self.log(f"Log reader error: {e}", "error")
        finally:
            proc_exited = self.process is None or self.process.returncode is not None
            if proc_exited:
                self.server_status = "stopped"
                await self.broadcast({"type": "status", "server": "stopped", "connected": False})

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

    async def send_command(self, cmd: str, timeout: float = 30.0) -> str:
        if not self.connected or not self.telnet_writer or not self.telnet_reader:
            return "ERROR: Not connected"
        async with self._command_lock:
            try:
                self.telnet_writer.write(f"{cmd}\n".encode())
                await self.telnet_writer.drain()
                raw = await asyncio.wait_for(self._read_until_prompt(), timeout=timeout)
                # Strip command echo (first line) and trailing prompt
                lines = raw.split("\n")
                if lines and lines[0].strip() == cmd.strip():
                    lines = lines[1:]
                result = "\n".join(lines).rstrip("> ").strip()
                return result
            except asyncio.TimeoutError:
                return "ERROR: Command timed out"
            except Exception as e:
                self.connected = False
                await self.broadcast({"type": "status", "server": self.server_status, "connected": False})
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

    async def flash_erase_chip(self) -> str:
        """Erase the entire flash device (all banks)."""
        await self.send_command("halt")
        resp = await self.send_command("flash erase_device 0", timeout=120.0)
        await self.log(f"flash erase_device 0 -> {resp}", "info" if "error" not in resp.lower() else "error")
        return resp

    async def flash_program(self, filename: str, address: str, verify: bool = True) -> str:
        # Pass address explicitly so OpenOCD programs at the correct location.
        # Use verify_image separately so verification also targets the same address.
        cmd = f"program {filename} {address}"
        resp = await self.send_command(cmd, timeout=120.0)
        await self.log(f"program -> {resp}", "info" if "error" not in resp.lower() else "error")
        if verify:
            vresp = await self.send_command(f"verify_image {filename} {address}", timeout=60.0)
            await self.log(f"verify -> {vresp}", "info" if "error" not in vresp.lower() else "error")
            resp = resp + "\n" + vresp
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
        """Returns list of {address, words} dicts.
        Uses dump_image for large reads (fast binary transfer, no output size limit).
        Falls back to mdw for small reads.
        """
        LARGE_THRESHOLD = 1024  # bytes

        addr_int = int(address, 16) if address.lower().startswith('0x') else int(address)

        if size > LARGE_THRESHOLD:
            dump_path = str(self.upload_dir / "_mem_read.bin")
            await self.send_command(f"dump_image {dump_path} 0x{addr_int:08X} {size}")
            if not os.path.exists(dump_path):
                return []
            with open(dump_path, "rb") as f:
                data = f.read()
            rows = []
            for off in range(0, len(data), 16):
                chunk = data[off:off + 16]
                chunk = chunk + b"\xff" * (16 - len(chunk))
                words = [int.from_bytes(chunk[i:i + 4], "little") for i in range(0, 16, 4)]
                rows.append({"address": f"0x{addr_int + off:08X}", "words": words})
            return rows

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
                int(addr_str, 16)  # validate — skips non-address lines
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

    async def flash_get_page_size(self) -> int:
        """Query flash info 0 and return the minimum sector/page size in bytes."""
        raw = await self.send_command("flash info 0")
        # Parse lines like: #  0: 0x00000000 (0x400 1024B) erased
        sizes = re.findall(r'\(0x([0-9a-fA-F]+)\s+\d+', raw)
        if sizes:
            return min(int(s, 16) for s in sizes)
        return 2048  # default 2 KB

    async def flash_patch_bytes(self, address: int, data: bytes) -> dict:
        """
        Patch flash memory bytes.
        Reads the affected page(s), applies changes, erases, reprograms.
        Returns {ok, result, page_size, page_base}.
        """
        page_size = await self.flash_get_page_size()
        start_page = (address // page_size) * page_size
        end_page = (((address + len(data) - 1) // page_size) + 1) * page_size
        total_size = end_page - start_page

        dump_path = str(self.upload_dir / "_patch_dump.bin")
        patch_path = str(self.upload_dir / "_patch_write.bin")

        # reset halt clears any stale flash error flags (PGSERR/PGAERR/PROGERR)
        # that would cause subsequent writes to fail
        await self.send_command("reset halt")

        # Read current page content
        await self.send_command(f"dump_image {dump_path} 0x{start_page:08X} {total_size}")
        if not os.path.exists(dump_path):
            return {"ok": False, "result": "Failed to dump flash page"}

        with open(dump_path, "rb") as f:
            page_data = bytearray(f.read())

        # Pad if short; also ensure size is a multiple of 8 (STM32L4 double-word requirement)
        if len(page_data) < total_size:
            page_data.extend(b"\xff" * (total_size - len(page_data)))
        pad = (8 - len(page_data) % 8) % 8
        if pad:
            page_data.extend(b"\xff" * pad)

        # Apply modifications
        offset_in_page = address - start_page
        for i, b in enumerate(data):
            if offset_in_page + i < len(page_data):
                page_data[offset_in_page + i] = b

        # Write patched data
        with open(patch_path, "wb") as f:
            f.write(bytes(page_data))

        # unlock: clears FLASH lock bit; erase: handles sector erase before write
        # 120s timeout — large pages or slow adapters can take a while
        prog_result = await self.send_command(
            f"flash write_image erase unlock {patch_path} 0x{start_page:08X} bin",
            timeout=120.0,
        )
        ok = "error" not in prog_result.lower()
        return {
            "ok": ok,
            "result": prog_result,
            "page_size": page_size,
            "page_base": f"0x{start_page:08X}",
        }


openocd_manager = OpenOCDManager()
