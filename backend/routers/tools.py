import asyncio
from fastapi import APIRouter, Request

from backend.services.network_tools import (
    get_local_interfaces,
    scan_network,
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
