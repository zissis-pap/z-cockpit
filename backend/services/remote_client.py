"""
HTTP client that speaks to a remote z-cockpit agent.
Provides the same interface used by script_runner._execute_step so the runner
can target a remote machine without knowing whether it's local or remote.
"""
import asyncio
import time
from typing import Optional

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


class RemoteClient:
    """Thin async client over a remote z-cockpit agent's HTTP API."""

    def __init__(self, host: str, port: int, token: str = ""):
        self._base = f"http://{host}:{port}"
        self._headers = {"X-Token": token} if token else {}
        self._http: Optional["httpx.AsyncClient"] = None
        # Serial RX buffer polling state
        self._rx_listeners: list[asyncio.Queue] = []
        self._poll_task: Optional[asyncio.Task] = None
        self._poll_offset: int = 0
        # mirror properties the script runner reads
        self.connected: bool = False        # openocd connected
        self.serial_connected: bool = False
        self.serial_port: str = ""
        self.server_status: str = "stopped"

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def _client(self) -> "httpx.AsyncClient":
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=self._base,
                headers=self._headers,
                timeout=60.0,
            )
        return self._http

    async def close(self):
        if self._poll_task:
            self._poll_task.cancel()
            try: await self._poll_task
            except asyncio.CancelledError: pass
            self._poll_task = None
        if self._http and not self._http.is_closed:
            await self._http.aclose()
            self._http = None

    async def _post(self, path: str, **json_body) -> dict:
        if not HTTPX_AVAILABLE:
            raise RuntimeError("httpx is required for remote agents: pip install httpx")
        c = await self._client()
        r = await c.post(path, json=json_body or None)
        r.raise_for_status()
        return r.json()

    async def _get(self, path: str, **params) -> dict:
        if not HTTPX_AVAILABLE:
            raise RuntimeError("httpx is required for remote agents: pip install httpx")
        c = await self._client()
        r = await c.get(path, params=params or None)
        r.raise_for_status()
        return r.json()

    # ── OpenOCD ────────────────────────────────────────────────────────────────

    async def start(self, config: dict) -> dict:
        result = await self._post("/api/openocd/start", **config)
        return result

    async def connect(self) -> dict:
        result = await self._post("/api/openocd/connect")
        if result.get("ok"):
            self.connected = True
        return result

    async def send_command(self, cmd: str, timeout: float = 30.0) -> str:
        try:
            c = await self._client()
            r = await c.post("/api/openocd/command", json={"cmd": cmd},
                             timeout=timeout + 5)
            r.raise_for_status()
            return r.json().get("result", "")
        except Exception as e:
            return f"ERROR: {e}"

    async def flash_erase_chip(self) -> str:
        r = await self._post("/api/openocd/flash/erase_chip")
        return r.get("result", "")

    async def flash_program(self, filename: str, address: str,
                            verify: bool = True, do_reset: bool = True) -> str:
        r = await self._post("/api/openocd/flash/program",
                             filename=filename, address=address,
                             verify=verify, do_reset=do_reset)
        return r.get("result", "")

    async def upload_firmware(self, data: bytes, filename: str) -> str:
        """Upload binary to the remote agent, return the filename it was stored as."""
        if not HTTPX_AVAILABLE:
            raise RuntimeError("httpx is required for remote agents: pip install httpx")
        c = await self._client()
        r = await c.post(
            "/api/openocd/firmware/upload",
            files={"file": (filename, data, "application/octet-stream")},
            timeout=120.0,
        )
        r.raise_for_status()
        result = r.json()
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "Upload failed"))
        return result["filename"]

    # ── Serial ─────────────────────────────────────────────────────────────────

    async def list_ports(self) -> list[dict]:
        r = await self._get("/api/serial/ports")
        return r.get("ports", [])

    async def connect_serial(self, port: str, baud_rate: int) -> dict:
        result = await self._post("/api/serial/connect", port=port, baud_rate=baud_rate)
        if result.get("ok"):
            self.serial_connected = True
            self.serial_port = port
        return result

    async def disconnect_serial(self) -> dict:
        result = await self._post("/api/serial/disconnect")
        self.serial_connected = False
        self.serial_port = ""
        return result

    async def send_serial(self, data: str, data_type: str = "ascii",
                          line_ending: str = "none") -> dict:
        return await self._post("/api/serial/send",
                                data=data, data_type=data_type, line_ending=line_ending)

    # ── RX listener (uart_wait support) ───────────────────────────────────────

    def add_rx_listener(self, queue: asyncio.Queue):
        self._rx_listeners.append(queue)
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self._poll_rx())

    def remove_rx_listener(self, queue: asyncio.Queue):
        try:
            self._rx_listeners.remove(queue)
        except ValueError:
            pass
        if not self._rx_listeners and self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None

    async def _poll_rx(self):
        """Poll the remote agent's serial buffer and feed registered queues."""
        self._poll_offset = 0
        while True:
            try:
                r = await self._get("/api/serial/buffer", since=self._poll_offset)
                chunks: list[str] = r.get("chunks", [])
                self._poll_offset = r.get("next_offset", self._poll_offset)
                for chunk in chunks:
                    for q in list(self._rx_listeners):
                        try:
                            q.put_nowait(chunk)
                        except Exception:
                            pass
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                return
            except Exception:
                await asyncio.sleep(0.5)
