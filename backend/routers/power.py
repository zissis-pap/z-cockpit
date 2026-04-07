"""Power Controller — persists MQTT broker config and publishes switch commands."""
import json

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.settings_manager import settings_manager

router = APIRouter(prefix="/api/power", tags=["power"])

try:
    import aiomqtt
    AIOMQTT_AVAILABLE = True
except ImportError:
    AIOMQTT_AVAILABLE = False


class PowerConfig(BaseModel):
    host:         str       = ''
    port:         int       = 1883
    username:     str       = ''
    password:     str       = ''
    topic:        str       = ''
    num_switches: int       = 2
    switch_names: list[str] = []


class SwitchCommand(BaseModel):
    switch: int
    status: str   # "ON" or "OFF"


@router.get("/config")
def get_config():
    return {"ok": True, "config": settings_manager.get_power_controller()}


@router.put("/config")
def save_config(req: PowerConfig):
    cfg = settings_manager.set_power_controller(req.model_dump())
    return {"ok": True, "config": cfg}


@router.post("/test")
async def test_connection():
    if not AIOMQTT_AVAILABLE:
        return {"ok": False, "error": "aiomqtt not installed"}

    cfg = settings_manager.get_power_controller()
    if not cfg.get("host"):
        return {"ok": False, "error": "Host not configured"}

    kwargs: dict = {"hostname": cfg["host"], "port": int(cfg["port"])}
    username = cfg.get("username", "").strip()
    password = cfg.get("password", "").strip()
    if username:
        kwargs["username"] = username
    if password:
        kwargs["password"] = password

    try:
        async with aiomqtt.Client(**kwargs):
            pass
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/publish")
async def publish_command(req: SwitchCommand):
    if not AIOMQTT_AVAILABLE:
        return {"ok": False, "error": "aiomqtt not installed"}

    cfg = settings_manager.get_power_controller()
    if not cfg.get("host"):
        return {"ok": False, "error": "Power controller host not configured"}
    if not cfg.get("topic"):
        return {"ok": False, "error": "Power controller topic not configured"}

    payload = json.dumps({"switch": str(req.switch), "status": req.status.upper()})

    kwargs: dict = {"hostname": cfg["host"], "port": int(cfg["port"])}
    username = cfg.get("username", "").strip()
    password = cfg.get("password", "").strip()
    if username:
        kwargs["username"] = username
    if password:
        kwargs["password"] = password

    try:
        async with aiomqtt.Client(**kwargs) as client:
            await client.publish(cfg["topic"], payload.encode())
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
