"""
OpenOCD REST API routes and WebSocket endpoint.
"""
import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.services.openocd_manager import openocd_manager

router = APIRouter(prefix="/api/openocd", tags=["openocd"])
ws_router = APIRouter(tags=["openocd-ws"])


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket
# ──────────────────────────────────────────────────────────────────────────────

@ws_router.websocket("/ws/openocd")
async def ws_openocd(websocket: WebSocket):
    await websocket.accept()
    openocd_manager.add_client(websocket)
    # Send current status immediately
    status = await openocd_manager.get_status()
    await websocket.send_json({"type": "status", **status})
    try:
        while True:
            await websocket.receive_text()  # keep alive; client sends pings
    except WebSocketDisconnect:
        pass
    finally:
        openocd_manager.remove_client(websocket)


# ──────────────────────────────────────────────────────────────────────────────
# Server control
# ──────────────────────────────────────────────────────────────────────────────

class StartConfig(BaseModel):
    executable: str = "openocd"
    interface_config: str = "interface/stlink.cfg"
    target_config: str = ""
    custom_config: str = ""
    telnet_port: int = 4444
    tcl_port: int = 6666


@router.post("/start")
async def start_server(config: StartConfig):
    return await openocd_manager.start(config.model_dump())


@router.post("/stop")
async def stop_server():
    return await openocd_manager.stop()


@router.post("/connect")
async def connect_telnet():
    return await openocd_manager.connect()


@router.post("/disconnect")
async def disconnect_telnet():
    return await openocd_manager.disconnect()


@router.get("/status")
async def get_status():
    return await openocd_manager.get_status()


# ──────────────────────────────────────────────────────────────────────────────
# Commands
# ──────────────────────────────────────────────────────────────────────────────

class CommandRequest(BaseModel):
    cmd: str


@router.post("/command")
async def send_command(req: CommandRequest):
    result = await openocd_manager.send_command(req.cmd)
    return {"ok": True, "result": result}


# ──────────────────────────────────────────────────────────────────────────────
# Firmware upload
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/firmware/upload")
async def upload_firmware(file: UploadFile = File(...)):
    dest = openocd_manager.upload_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True, "path": str(dest), "filename": file.filename, "size": len(content)}


# ──────────────────────────────────────────────────────────────────────────────
# Flash operations
# ──────────────────────────────────────────────────────────────────────────────

class FlashEraseRequest(BaseModel):
    address: str = "0x08000000"
    size: str = "0x20000"


class FlashProgramRequest(BaseModel):
    filename: str
    address: str = "0x08000000"
    verify: bool = True


class FlashReadRequest(BaseModel):
    address: str = "0x08000000"
    size: str = "0x10000"
    output_filename: str = "dump.bin"


class FlashVerifyRequest(BaseModel):
    filename: str
    address: str = "0x08000000"


@router.post("/flash/halt")
async def flash_halt():
    result = await openocd_manager.flash_halt()
    return {"ok": True, "result": result}


@router.post("/flash/erase")
async def flash_erase(req: FlashEraseRequest):
    result = await openocd_manager.flash_erase(req.address, req.size)
    return {"ok": "error" not in result.lower(), "result": result}


@router.post("/flash/program")
async def flash_program(req: FlashProgramRequest):
    path = openocd_manager.upload_dir / req.filename
    if not path.exists():
        return {"ok": False, "error": f"File not found: {req.filename}"}
    result = await openocd_manager.flash_program(str(path), req.address, req.verify)
    return {"ok": "error" not in result.lower(), "result": result}


@router.post("/flash/read")
async def flash_read(req: FlashReadRequest):
    out = openocd_manager.upload_dir / req.output_filename
    result = await openocd_manager.flash_read(str(out), req.address, req.size)
    ok = "error" not in result.lower() and out.exists()
    return {"ok": ok, "result": result, "filename": req.output_filename if ok else None}


@router.post("/flash/verify")
async def flash_verify(req: FlashVerifyRequest):
    path = openocd_manager.upload_dir / req.filename
    if not path.exists():
        return {"ok": False, "error": f"File not found: {req.filename}"}
    result = await openocd_manager.flash_verify(str(path), req.address)
    return {"ok": "error" not in result.lower(), "result": result}


@router.post("/flash/reset")
async def flash_reset():
    result = await openocd_manager.flash_reset_run()
    return {"ok": True, "result": result}


@router.get("/flash/download/{filename}")
async def flash_download(filename: str):
    path = openocd_manager.upload_dir / filename
    if not path.exists():
        return {"ok": False, "error": "File not found"}
    return FileResponse(str(path), filename=filename, media_type="application/octet-stream")


# ──────────────────────────────────────────────────────────────────────────────
# Memory operations
# ──────────────────────────────────────────────────────────────────────────────

class MemReadRequest(BaseModel):
    address: str = "0x08000000"
    size: int = 256


class MemWriteRequest(BaseModel):
    address: str
    value: str


@router.post("/memory/read")
async def memory_read(req: MemReadRequest):
    rows = await openocd_manager.memory_read(req.address, req.size)
    return {"ok": True, "rows": rows}


@router.post("/memory/write")
async def memory_write(req: MemWriteRequest):
    result = await openocd_manager.memory_write_word(req.address, req.value)
    return {"ok": True, "result": result}


@router.get("/flash/info")
async def flash_info():
    result = await openocd_manager.flash_info()
    return {"ok": True, "result": result}


class FlashPatchRequest(BaseModel):
    address: int        # absolute address as integer
    data: list[int]     # byte values to write


@router.post("/flash/patch_bytes")
async def flash_patch_bytes(req: FlashPatchRequest):
    return await openocd_manager.flash_patch_bytes(req.address, bytes(req.data))


@router.get("/flash/page_size")
async def flash_page_size():
    size = await openocd_manager.flash_get_page_size()
    return {"ok": True, "page_size": size}
