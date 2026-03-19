#!/usr/bin/env python3
"""
Z-Cockpit Remote Agent
======================
Run this on a remote PC to expose its serial ports and OpenOCD instance
to z-cockpit for remote flashing and script execution.

Requirements:
    pip install fastapi uvicorn pyserial

Optional (for OpenOCD):
    openocd must be in PATH

Usage:
    python remote_agent.py
    python remote_agent.py --port 7777
    python remote_agent.py --port 7777 --token mysecret
    python remote_agent.py --host 0.0.0.0 --port 7777
"""
import argparse
import asyncio
import json
import os
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Optional, Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Optional pyserial ──────────────────────────────────────────────────────────

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

# ── CLI args (parsed at startup) ───────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Z-Cockpit Remote Agent")
parser.add_argument("--host",  default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
parser.add_argument("--port",  type=int, default=7777, help="Port (default: 7777)")
parser.add_argument("--token", default="", help="API token (empty = no auth)")
args = parser.parse_args()

API_TOKEN: str = args.token.strip()

# ── Auth dependency ────────────────────────────────────────────────────────────

def check_token(x_token: str = Header(default="")):
    if API_TOKEN and x_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Token header")

AuthDep = Depends(check_token)

# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="Z-Cockpit Remote Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(tempfile.gettempdir()) / "z-cockpit-agent"
UPLOAD_DIR.mkdir(exist_ok=True)


@app.get("/")
def root():
    return {
        "service": "z-cockpit-remote-agent",
        "version": "1.0",
        "auth": bool(API_TOKEN),
        "serial": SERIAL_AVAILABLE,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Serial Manager
# ══════════════════════════════════════════════════════════════════════════════

class AgentSerialManager:
    def __init__(self):
        self.ser = None
        self.connected = False
        self.port = ""
        self.baud_rate = 115200
        self._stop_event = threading.Event()
        self._read_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ws_clients: Set[WebSocket] = set()
        # Ring buffer for polling-based uart_wait
        self._rx_chunks: list[str] = []
        self._rx_offset: int = 0          # global chunk index (monotonically increasing)
        self._rx_lock = threading.Lock()

    # ── WebSocket management ───────────────────────────────────────────────────

    def add_ws(self, ws: WebSocket): self._ws_clients.add(ws)
    def remove_ws(self, ws: WebSocket): self._ws_clients.discard(ws)

    async def _broadcast(self, msg: dict):
        dead = set()
        for ws in list(self._ws_clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    # ── Port listing ───────────────────────────────────────────────────────────

    def list_ports(self) -> list[dict]:
        if not SERIAL_AVAILABLE:
            return []
        return [
            {"device": p.device, "description": p.description or p.device}
            for p in sorted(serial.tools.list_ports.comports(), key=lambda x: x.device)
        ]

    # ── Connection ─────────────────────────────────────────────────────────────

    async def connect(self, port: str, baud_rate: int) -> dict:
        if not SERIAL_AVAILABLE:
            return {"ok": False, "error": "pyserial not installed"}
        if self.connected:
            return {"ok": False, "error": "Already connected"}
        try:
            self.ser = serial.Serial(port=port, baudrate=baud_rate, timeout=0.1)
            self.port = port
            self.baud_rate = baud_rate
            self.connected = True
            with self._rx_lock:
                self._rx_chunks = []
                self._rx_offset = 0
            self._loop = asyncio.get_event_loop()
            self._stop_event.clear()
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            await self._broadcast({"type": "status", "connected": True, "port": port, "baud": baud_rate})
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def disconnect(self) -> dict:
        self._stop_event.set()
        if self._read_thread:
            self._read_thread.join(timeout=2.0)
            self._read_thread = None
        if self.ser:
            try: self.ser.close()
            except Exception: pass
            self.ser = None
        self.connected = False
        await self._broadcast({"type": "status", "connected": False})
        return {"ok": True}

    async def send(self, data: str, data_type: str = "ascii", line_ending: str = "none") -> dict:
        if not self.connected or not self.ser:
            return {"ok": False, "error": "Not connected"}
        ENDINGS = {"none": b"", "\\n": b"\n", "\\r": b"\r", "\\r\\n": b"\r\n"}
        ending = ENDINGS.get(line_ending, b"")
        try:
            raw = bytes.fromhex(data.replace(" ", "")) if data_type == "hex" else data.encode("utf-8", errors="replace")
            self.ser.write(raw + ending)
            return {"ok": True, "bytes": len(raw) + len(ending)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_buffer(self, since: int) -> dict:
        """Return RX chunks appended since `since` offset. Thread-safe."""
        with self._rx_lock:
            start = max(0, since - (self._rx_offset - len(self._rx_chunks)))
            chunks = self._rx_chunks[start:]
            next_offset = self._rx_offset
        return {"chunks": chunks, "next_offset": next_offset}

    def _read_loop(self):
        while not self._stop_event.is_set():
            try:
                if self.ser and self.ser.in_waiting > 0:
                    data = self.ser.read(self.ser.in_waiting)
                    if data and self._loop:
                        asyncio.run_coroutine_threadsafe(self._on_data(data), self._loop)
            except Exception:
                break
            self._stop_event.wait(timeout=0.01)

    async def _on_data(self, data: bytes):
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            text = ""
        hex_str = data.hex(" ").upper()
        with self._rx_lock:
            self._rx_chunks.append(text)
            self._rx_offset += 1
            # Keep at most 2000 chunks in memory
            if len(self._rx_chunks) > 2000:
                excess = len(self._rx_chunks) - 2000
                self._rx_chunks = self._rx_chunks[excess:]
        await self._broadcast({"type": "data", "hex": hex_str, "text": text, "raw": list(data)})


serial_mgr = AgentSerialManager()


# ══════════════════════════════════════════════════════════════════════════════
# OpenOCD Manager
# ══════════════════════════════════════════════════════════════════════════════

class AgentOpenOCDManager:
    def __init__(self):
        self.process = None
        self.telnet_reader = None
        self.telnet_writer = None
        self.ws_clients: Set[WebSocket] = set()
        self.server_status = "stopped"
        self.connected = False
        self.telnet_port = 4444
        self._log_task = None
        self._command_lock = asyncio.Lock()

    def add_ws(self, ws: WebSocket): self.ws_clients.add(ws)
    def remove_ws(self, ws: WebSocket): self.ws_clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        for ws in list(self.ws_clients):
            try: await ws.send_json(msg)
            except Exception: dead.add(ws)
        self.ws_clients -= dead

    async def log(self, text: str, level: str = "info"):
        await self.broadcast({"type": "log", "text": text, "level": level})

    async def start(self, config: dict) -> dict:
        if self.process and self.process.returncode is None:
            return {"ok": False, "error": "Already running"}
        executable = config.get("executable", "openocd")
        iface = config.get("interface_config", "interface/stlink.cfg")
        target = config.get("target_config", "")
        self.telnet_port = config.get("telnet_port", 4444)
        tcl_port = config.get("tcl_port", 6666)
        cmd = [executable, "-f", iface]
        if target:
            cmd += ["-f", target]
        cmd += ["-c", f"telnet_port {self.telnet_port}", "-c", f"tcl_port {tcl_port}"]
        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            self.server_status = "starting"
            await self.broadcast({"type": "status", "server": "starting", "pid": self.process.pid})
            self._log_task = asyncio.create_task(self._read_output())
            return {"ok": True, "pid": self.process.pid}
        except FileNotFoundError:
            return {"ok": False, "error": f"openocd not found"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def stop(self) -> dict:
        if self._log_task:
            self._log_task.cancel()
            self._log_task = None
        await self.disconnect()
        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=3.0)
            except Exception:
                try: self.process.kill()
                except Exception: pass
            self.process = None
        self.server_status = "stopped"
        await self.broadcast({"type": "status", "server": "stopped", "connected": False})
        return {"ok": True}

    async def get_status(self) -> dict:
        running = self.process is not None and self.process.returncode is None
        if running and self.server_status == "starting":
            self.server_status = "running"
        elif not running and self.server_status != "stopped":
            self.server_status = "stopped"
        return {"server": self.server_status, "connected": self.connected,
                "pid": self.process.pid if running else None}

    async def connect(self) -> dict:
        if self.connected:
            return {"ok": True}
        try:
            self.telnet_reader, self.telnet_writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", self.telnet_port), timeout=5.0)
            await asyncio.wait_for(self._read_until_prompt(), timeout=5.0)
            self.connected = True
            await self.broadcast({"type": "status", "server": self.server_status, "connected": True})
            return {"ok": True}
        except asyncio.TimeoutError:
            return {"ok": False, "error": "Connection timed out"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def disconnect(self) -> dict:
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
        if not self.connected or not self.telnet_writer:
            return "ERROR: Not connected"
        async with self._command_lock:
            try:
                self.telnet_writer.write(f"{cmd}\n".encode())
                await self.telnet_writer.drain()
                raw = await asyncio.wait_for(self._read_until_prompt(), timeout=timeout)
                lines = raw.split("\n")
                if lines and lines[0].strip() == cmd.strip():
                    lines = lines[1:]
                return "\n".join(lines).rstrip("> ").strip()
            except asyncio.TimeoutError:
                return "ERROR: Command timed out"
            except Exception as e:
                self.connected = False
                return f"ERROR: {e}"

    async def flash_erase_chip(self) -> str:
        await self.send_command("halt")
        return await self.send_command("flash erase_device 0", timeout=120.0)

    async def flash_program(self, filename: str, address: str, verify: bool = True) -> str:
        verify_flag = " verify" if verify else ""
        return await self.send_command(f"program {filename}{verify_flag} reset", timeout=120.0)

    async def _read_output(self):
        try:
            async for line in self.process.stdout:
                text = line.decode("utf-8", errors="replace").rstrip()
                level = "error" if any(w in text.lower() for w in ("error", "failed")) else "info"
                await self.log(text, level)
        except asyncio.CancelledError:
            pass
        finally:
            self.server_status = "stopped"
            await self.broadcast({"type": "status", "server": "stopped", "connected": False})


ocd_mgr = AgentOpenOCDManager()


# ══════════════════════════════════════════════════════════════════════════════
# WebSocket routes
# ══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/openocd")
async def ws_openocd(websocket: WebSocket):
    await websocket.accept()
    ocd_mgr.add_ws(websocket)
    status = await ocd_mgr.get_status()
    await websocket.send_json({"type": "status", **status})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ocd_mgr.remove_ws(websocket)


@app.websocket("/ws/serial")
async def ws_serial(websocket: WebSocket):
    await websocket.accept()
    serial_mgr.add_ws(websocket)
    await websocket.send_json({"type": "status", "connected": serial_mgr.connected,
                               "port": serial_mgr.port, "baud": serial_mgr.baud_rate})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        serial_mgr.remove_ws(websocket)


# ══════════════════════════════════════════════════════════════════════════════
# Serial REST routes
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/serial/ports", dependencies=[AuthDep])
async def serial_ports():
    return {"ok": True, "ports": serial_mgr.list_ports()}


@app.get("/api/serial/status", dependencies=[AuthDep])
async def serial_status():
    return {"ok": True, "connected": serial_mgr.connected, "port": serial_mgr.port, "baud": serial_mgr.baud_rate}


@app.get("/api/serial/buffer", dependencies=[AuthDep])
async def serial_buffer(since: int = 0):
    return serial_mgr.get_buffer(since)


class SerialConnectReq(BaseModel):
    port: str
    baud_rate: int = 115200


@app.post("/api/serial/connect", dependencies=[AuthDep])
async def serial_connect(req: SerialConnectReq):
    return await serial_mgr.connect(req.port, req.baud_rate)


@app.post("/api/serial/disconnect", dependencies=[AuthDep])
async def serial_disconnect():
    return await serial_mgr.disconnect()


class SerialSendReq(BaseModel):
    data: str
    data_type: str = "ascii"
    line_ending: str = "none"


@app.post("/api/serial/send", dependencies=[AuthDep])
async def serial_send(req: SerialSendReq):
    return await serial_mgr.send(req.data, req.data_type, req.line_ending)


# ══════════════════════════════════════════════════════════════════════════════
# OpenOCD REST routes
# ══════════════════════════════════════════════════════════════════════════════

class OcdStartReq(BaseModel):
    executable: str = "openocd"
    interface_config: str = "interface/stlink.cfg"
    target_config: str = ""
    telnet_port: int = 4444
    tcl_port: int = 6666


@app.post("/api/openocd/start", dependencies=[AuthDep])
async def ocd_start(req: OcdStartReq):
    return await ocd_mgr.start(req.model_dump())


@app.post("/api/openocd/stop", dependencies=[AuthDep])
async def ocd_stop():
    return await ocd_mgr.stop()


@app.post("/api/openocd/connect", dependencies=[AuthDep])
async def ocd_connect():
    return await ocd_mgr.connect()


@app.post("/api/openocd/disconnect", dependencies=[AuthDep])
async def ocd_disconnect():
    return await ocd_mgr.disconnect()


@app.get("/api/openocd/status", dependencies=[AuthDep])
async def ocd_status():
    return await ocd_mgr.get_status()


class OcdCommandReq(BaseModel):
    cmd: str


@app.post("/api/openocd/command", dependencies=[AuthDep])
async def ocd_command(req: OcdCommandReq):
    result = await ocd_mgr.send_command(req.cmd)
    return {"ok": not result.startswith("ERROR:"), "result": result}


@app.post("/api/openocd/firmware/upload", dependencies=[AuthDep])
async def firmware_upload(file: UploadFile = File(...)):
    dest = UPLOAD_DIR / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True, "filename": file.filename, "size": len(content)}


class FlashProgramReq(BaseModel):
    filename: str
    address: str = "0x08000000"
    verify: bool = True
    do_reset: bool = True


@app.post("/api/openocd/flash/program", dependencies=[AuthDep])
async def flash_program(req: FlashProgramReq):
    path = UPLOAD_DIR / req.filename
    if not path.exists():
        return {"ok": False, "error": f"File not found: {req.filename}"}
    result = await ocd_mgr.flash_program(str(path), req.address, req.verify)
    if req.do_reset:
        await ocd_mgr.send_command("reset run")
    return {"ok": "error" not in result.lower(), "result": result}


@app.post("/api/openocd/flash/halt", dependencies=[AuthDep])
async def flash_halt():
    result = await ocd_mgr.send_command("halt")
    return {"ok": True, "result": result}


@app.post("/api/openocd/flash/erase_chip", dependencies=[AuthDep])
async def flash_erase_chip():
    result = await ocd_mgr.flash_erase_chip()
    return {"ok": "error" not in result.lower(), "result": result}


# ══════════════════════════════════════════════════════════════════════════════
# Startup
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print(f"\nZ-Cockpit Remote Agent")
    print(f"  Listening on  http://{args.host}:{args.port}")
    print(f"  Auth token:   {'(set)' if API_TOKEN else '(none — open access)'}")
    print(f"  Serial:       {'available' if SERIAL_AVAILABLE else 'NOT available — pip install pyserial'}")
    print(f"\n  Add this agent in z-cockpit Settings > Remote Agents\n")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
