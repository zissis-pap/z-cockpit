"""
Remote agent management REST API.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.remotes_manager import remotes_manager

router = APIRouter(prefix="/api/remotes", tags=["remotes"])


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
