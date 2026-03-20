"""
Remote agent management REST API.
Includes a generic HTTP proxy and WebSocket proxy for remote agents.
"""
import asyncio
from fastapi import APIRouter, Request, Response, WebSocket
from pydantic import BaseModel
import httpx
import websockets

from backend.services.remotes_manager import remotes_manager

router    = APIRouter(prefix="/api/remotes", tags=["remotes"])
ws_router = APIRouter(tags=["remotes"])


@router.get("")
async def list_remotes():
    return {"ok": True, "remotes": remotes_manager.list()}


class RemoteBody(BaseModel):
    name:  str
    host:  str
    port:  int  = 7777
    token: str  = ""


@router.post("")
async def add_remote(body: RemoteBody):
    remote = remotes_manager.add(body.name, body.host, body.port, body.token)
    return {"ok": True, "remote": remote}


@router.put("/{remote_id}")
async def update_remote(remote_id: str, body: RemoteBody):
    remote = remotes_manager.update(remote_id, body.name, body.host, body.port, body.token)
    if not remote:
        return {"ok": False, "error": "Not found"}
    return {"ok": True, "remote": remote}


@router.delete("/{remote_id}")
async def delete_remote(remote_id: str):
    ok = remotes_manager.delete(remote_id)
    return {"ok": ok}


@router.post("/{remote_id}/test")
async def test_remote(remote_id: str):
    return await remotes_manager.test(remote_id)


# ── Generic HTTP proxy ────────────────────────────────────────────────────────

@router.api_route(
    "/{remote_id}/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_http(remote_id: str, path: str, request: Request):
    cfg = remotes_manager.get(remote_id)
    if not cfg:
        return Response(content='{"ok":false,"error":"Remote not found"}', status_code=404,
                        media_type="application/json")

    url = f"http://{cfg['host']}:{cfg['port']}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"

    headers: dict[str, str] = {}
    if cfg.get("token"):
        headers["X-Token"] = cfg["token"]
    ct = request.headers.get("content-type")
    if ct:
        headers["content-type"] = ct

    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.request(
                method=request.method,
                url=url,
                content=body,
                headers=headers,
            )
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )
    except httpx.ConnectError as e:
        return Response(
            content=f'{{"ok":false,"error":"Cannot reach remote agent: {e}"}}',
            status_code=502,
            media_type="application/json",
        )


# ── WebSocket proxy ───────────────────────────────────────────────────────────

async def _proxy_ws(websocket: WebSocket, remote_id: str, ws_path: str):
    """Bidirectionally proxy a WebSocket connection to a remote agent endpoint."""
    cfg = remotes_manager.get(remote_id)
    if not cfg:
        await websocket.close(code=1008, reason="Remote not found")
        return

    await websocket.accept()

    extra_headers: dict[str, str] = {}
    if cfg.get("token"):
        extra_headers["X-Token"] = cfg["token"]

    remote_url = f"ws://{cfg['host']}:{cfg['port']}/{ws_path}"

    try:
        async with websockets.connect(remote_url, additional_headers=extra_headers) as remote_ws:

            async def fwd_to_client():
                async for msg in remote_ws:
                    if isinstance(msg, bytes):
                        await websocket.send_bytes(msg)
                    else:
                        await websocket.send_text(msg)

            async def fwd_to_remote():
                while True:
                    data = await websocket.receive_text()
                    if data != "ping":
                        await remote_ws.send(data)

            done, pending = await asyncio.wait(
                [asyncio.create_task(fwd_to_client()),
                 asyncio.create_task(fwd_to_remote())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            for t in done:
                try:
                    t.exception()
                except Exception:
                    pass
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@ws_router.websocket("/ws/remotes/{remote_id}/openocd")
async def proxy_openocd_ws(websocket: WebSocket, remote_id: str):
    await _proxy_ws(websocket, remote_id, "ws/openocd")


@ws_router.websocket("/ws/remotes/{remote_id}/serial")
async def proxy_serial_ws(websocket: WebSocket, remote_id: str):
    await _proxy_ws(websocket, remote_id, "ws/serial")
