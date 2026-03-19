"""
Scripts REST API + WebSocket for step-based script execution.
"""
import asyncio
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.script_runner import script_runner

router    = APIRouter(prefix="/api/scripts", tags=["scripts"])
ws_router = APIRouter(tags=["scripts-ws"])


# ── WebSocket ──────────────────────────────────────────────────────────────────

@ws_router.websocket("/ws/scripts")
async def ws_scripts(websocket: WebSocket):
    await websocket.accept()
    script_runner.add_ws_client(websocket)
    await websocket.send_json({"type": "init", "running": script_runner.running})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        script_runner.remove_ws_client(websocket)


# ── Script CRUD ────────────────────────────────────────────────────────────────

@router.get("")
async def list_scripts():
    return {"ok": True, "scripts": script_runner.list_scripts()}


@router.get("/{script_id}")
async def get_script(script_id: int):
    s = script_runner.get_script(script_id)
    if not s:
        return {"ok": False, "error": "Not found"}
    return {"ok": True, "script": s}


class ScriptBody(BaseModel):
    id: int
    name: str
    src: str
    files: dict = {}


@router.post("")
async def upsert_script(body: ScriptBody):
    saved = script_runner.upsert_script(body.model_dump())
    return {"ok": True, "script": saved}


@router.delete("/{script_id}")
async def delete_script(script_id: int):
    ok = script_runner.delete_script(script_id)
    return {"ok": ok}


# ── Execution ──────────────────────────────────────────────────────────────────

@router.post("/stop")
async def stop_script():
    script_runner.stop()
    return {"ok": True}


@router.post("/{script_id}/run")
async def run_script(script_id: int):
    asyncio.create_task(script_runner.run(script_id))
    return {"ok": True}
