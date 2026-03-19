import asyncio
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from backend.services.network_tools import (
    get_local_interfaces,
    scan_network,
    list_interfaces,
    capture_packets,
)

router    = APIRouter(prefix="/api/tools", tags=["tools"])
ws_router = APIRouter(tags=["tools-ws"])


@router.get("/network/interfaces")
async def network_interfaces(request: Request):
    ifaces = await get_local_interfaces()
    client_ip = request.headers.get("X-Forwarded-For") or (request.client.host if request.client else "unknown")
    return {"interfaces": ifaces, "client_ip": client_ip}


@router.post("/network/scan")
async def network_scan(body: dict):
    subnet = body.get("subnet", "192.168.1.0/24")
    hosts = await scan_network(subnet)
    return {"hosts": hosts, "count": len(hosts)}


@router.get("/network/capture-interfaces")
async def capture_interfaces():
    ifaces = await list_interfaces()
    return {"interfaces": ifaces}


@ws_router.websocket("/ws/tools/capture")
async def ws_capture(websocket: WebSocket):
    await websocket.accept()
    proc_task = None
    try:
        while True:
            msg = await websocket.receive_json()
            action = msg.get("action")

            if action == "start":
                iface = msg.get("interface", "eth0")
                filt = msg.get("filter", "")
                if proc_task:
                    proc_task.cancel()

                async def stream(interface: str = iface, filter_expr: str = filt):
                    try:
                        async for pkt in capture_packets(interface, filter_expr):
                            if "error" in pkt:
                                await websocket.send_json({"type": "error", "message": pkt["error"]})
                            else:
                                await websocket.send_json({"type": "packet", "data": pkt})
                    except Exception:
                        pass
                    try:
                        await websocket.send_json({"type": "stopped"})
                    except Exception:
                        pass

                proc_task = asyncio.create_task(stream())

            elif action == "stop":
                if proc_task:
                    proc_task.cancel()
                    proc_task = None
                await websocket.send_json({"type": "stopped"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if proc_task:
            proc_task.cancel()
