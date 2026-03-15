"""
Serial port REST API routes and WebSocket endpoint.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.serial_manager import serial_manager

router = APIRouter(prefix="/api/serial", tags=["serial"])
ws_router = APIRouter(tags=["serial-ws"])


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket
# ──────────────────────────────────────────────────────────────────────────────

@ws_router.websocket("/ws/serial")
async def ws_serial(websocket: WebSocket):
    await websocket.accept()
    serial_manager.add_client(websocket)
    await websocket.send_json({
        "type": "status",
        "connected": serial_manager.connected,
        "port": serial_manager.port,
        "baud": serial_manager.baud_rate,
    })
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        serial_manager.remove_client(websocket)


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/ports")
async def list_ports():
    return {"ok": True, "ports": serial_manager.list_ports()}


class ConnectRequest(BaseModel):
    port: str
    baud_rate: int = 115200
    bytesize: int = 8
    parity: str = "N"
    stopbits: int = 1


@router.post("/connect")
async def connect(req: ConnectRequest):
    return await serial_manager.connect(
        req.port, req.baud_rate, req.bytesize, req.parity, req.stopbits
    )


@router.post("/disconnect")
async def disconnect():
    return await serial_manager.disconnect()


@router.get("/status")
async def status():
    return {
        "ok": True,
        "connected": serial_manager.connected,
        "port": serial_manager.port,
        "baud": serial_manager.baud_rate,
    }


class SendRequest(BaseModel):
    data: str
    data_type: str = "ascii"   # ascii | hex
    line_ending: str = "\\r\\n"  # none | \n | \r | \r\n | \n\r


@router.post("/send")
async def send(req: SendRequest):
    return await serial_manager.send(req.data, req.data_type, req.line_ending)
