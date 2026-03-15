"""
Serial port manager with async reading and WebSocket broadcasting.
"""
import asyncio
import json
import threading
from typing import Optional, Set
from fastapi import WebSocket

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False


class SerialManager:
    def __init__(self):
        self.ser: Optional[object] = None  # serial.Serial
        self.ws_clients: Set[WebSocket] = set()
        self.connected: bool = False
        self.port: str = ""
        self.baud_rate: int = 115200
        self._stop_event = threading.Event()
        self._read_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._log_file: Optional[object] = None   # open file handle
        self._log_path: str = ""

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

    # ──────────────────────────────────────────────────────────────────────────
    # Logging
    # ──────────────────────────────────────────────────────────────────────────

    def start_log(self, path: str) -> dict:
        import os
        path = os.path.expanduser(path)
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        try:
            self._log_file = open(path, "a", encoding="utf-8", buffering=1)  # line-buffered
            self._log_path = path
            return {"ok": True, "path": path}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def stop_log(self) -> dict:
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass
            self._log_file = None
        path = self._log_path
        self._log_path = ""
        return {"ok": True, "path": path}

    def _write_log(self, line: str):
        if self._log_file:
            try:
                self._log_file.write(line)
            except Exception:
                pass

    # ──────────────────────────────────────────────────────────────────────────
    # Port listing
    # ──────────────────────────────────────────────────────────────────────────

    def list_ports(self) -> list[dict]:
        if not SERIAL_AVAILABLE:
            return []
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({
                "device": p.device,
                "description": p.description or p.device,
                "hwid": p.hwid or "",
            })
        return sorted(ports, key=lambda x: x["device"])

    # ──────────────────────────────────────────────────────────────────────────
    # Connection
    # ──────────────────────────────────────────────────────────────────────────

    async def connect(self, port: str, baud_rate: int, bytesize: int = 8,
                      parity: str = "N", stopbits: int = 1) -> dict:
        if not SERIAL_AVAILABLE:
            return {"ok": False, "error": "pyserial not installed"}
        if self.connected:
            return {"ok": False, "error": "Already connected"}

        try:
            self.ser = serial.Serial(
                port=port,
                baudrate=baud_rate,
                bytesize=bytesize,
                parity=parity,
                stopbits=stopbits,
                timeout=0.1,
            )
            self.port = port
            self.baud_rate = baud_rate
            self.connected = True
            self._loop = asyncio.get_event_loop()
            self._stop_event.clear()
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            await self.broadcast({"type": "status", "connected": True, "port": port, "baud": baud_rate})
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def disconnect(self) -> dict:
        self._stop_event.set()
        if self._read_thread:
            self._read_thread.join(timeout=2.0)
            self._read_thread = None
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None
        self.connected = False
        await self.broadcast({"type": "status", "connected": False})
        return {"ok": True}

    # ──────────────────────────────────────────────────────────────────────────
    # Send
    # ──────────────────────────────────────────────────────────────────────────

    async def send(self, data: str, data_type: str = "ascii", line_ending: str = "\\r\\n") -> dict:
        if not self.connected or not self.ser:
            return {"ok": False, "error": "Not connected"}

        ENDINGS = {
            "none": b"",
            "\\n": b"\n",
            "\\r": b"\r",
            "\\r\\n": b"\r\n",
            "\\n\\r": b"\n\r",
        }
        ending = ENDINGS.get(line_ending, b"\r\n")

        try:
            if data_type == "hex":
                raw = bytes.fromhex(data.replace(" ", ""))
            else:
                raw = data.encode("utf-8", errors="replace")
            self.ser.write(raw + ending)
            from datetime import datetime
            ts = datetime.now().strftime("%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}"
            self._write_log(f"[{ts}] TX | {data}\n")
            return {"ok": True, "bytes": len(raw) + len(ending)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ──────────────────────────────────────────────────────────────────────────
    # Background reader thread
    # ──────────────────────────────────────────────────────────────────────────

    def _read_loop(self):
        while not self._stop_event.is_set():
            try:
                if self.ser and self.ser.in_waiting > 0:
                    data = self.ser.read(self.ser.in_waiting)
                    if data and self._loop:
                        asyncio.run_coroutine_threadsafe(
                            self._on_data(data), self._loop
                        )
            except Exception as e:
                if not self._stop_event.is_set():
                    asyncio.run_coroutine_threadsafe(
                        self.broadcast({"type": "error", "text": str(e)}),
                        self._loop,
                    )
                break
            self._stop_event.wait(timeout=0.01)

    async def _on_data(self, data: bytes):
        from datetime import datetime
        hex_str = data.hex(" ").upper()
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            text = ""
        ts = datetime.now().strftime("%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}"
        self._write_log(f"[{ts}] RX | {text or hex_str}\n")
        await self.broadcast({
            "type": "data",
            "hex": hex_str,
            "text": text,
            "raw": list(data),
        })


serial_manager = SerialManager()
