"""
MQTT REST API + WebSocket.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.services.mqtt_manager import mqtt_manager

router    = APIRouter(prefix="/api/mqtt", tags=["mqtt"])
ws_router = APIRouter(tags=["mqtt-ws"])


# ── WebSocket ──────────────────────────────────────────────────────────────────

@ws_router.websocket("/ws/mqtt")
async def ws_mqtt(websocket: WebSocket):
    await websocket.accept()
    mqtt_manager.add_ws_client(websocket)
    # Send current broker state immediately
    await websocket.send_json({"type": "init", "brokers": mqtt_manager.list_brokers()})
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        pass
    finally:
        mqtt_manager.remove_ws_client(websocket)


# ── Brokers ────────────────────────────────────────────────────────────────────

@router.get("/brokers")
async def list_brokers():
    return {"brokers": mqtt_manager.list_brokers()}


class AddBrokerRequest(BaseModel):
    name:     str         = ''
    host:     str
    port:     int         = 1883
    username: str | None  = None
    password: str | None  = None


@router.post("/brokers")
async def add_broker(req: AddBrokerRequest):
    return await mqtt_manager.add_broker(req.name, req.host, req.port, req.username, req.password)


@router.delete("/brokers/{broker_id}")
async def remove_broker(broker_id: str):
    return await mqtt_manager.remove_broker(broker_id)


@router.post("/brokers/{broker_id}/connect")
async def connect_broker(broker_id: str):
    return await mqtt_manager.connect_broker(broker_id)


@router.post("/brokers/{broker_id}/disconnect")
async def disconnect_broker(broker_id: str):
    return await mqtt_manager.disconnect_broker(broker_id)


# ── Topics ─────────────────────────────────────────────────────────────────────

class TopicRequest(BaseModel):
    topic: str


@router.post("/brokers/{broker_id}/topics")
async def subscribe_topic(broker_id: str, req: TopicRequest):
    return await mqtt_manager.subscribe_topic(broker_id, req.topic)


@router.delete("/brokers/{broker_id}/topics/{topic:path}")
async def unsubscribe_topic(broker_id: str, topic: str):
    return await mqtt_manager.unsubscribe_topic(broker_id, topic)


# ── Publish ────────────────────────────────────────────────────────────────────

class PublishRequest(BaseModel):
    topic:   str
    payload: str


@router.post("/brokers/{broker_id}/publish")
async def publish(broker_id: str, req: PublishRequest):
    return await mqtt_manager.publish(broker_id, req.topic, req.payload)
