"""
MQTT connection manager — supports multiple brokers, dynamic topic subscribe/unsubscribe.
Requires: pip install aiomqtt
"""
import asyncio
import uuid
from dataclasses import dataclass, field as dc_field

from fastapi import WebSocket

try:
    import aiomqtt
    AIOMQTT_AVAILABLE = True
except ImportError:
    AIOMQTT_AVAILABLE = False


@dataclass
class BrokerConfig:
    id: str
    host: str
    port: int
    username: str | None
    password: str | None
    topics: list[str] = dc_field(default_factory=list)
    connected: bool = False
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "id":        self.id,
            "host":      self.host,
            "port":      self.port,
            "username":  self.username,
            "topics":    list(self.topics),
            "connected": self.connected,
            "error":     self.error,
        }


class MQTTManager:
    def __init__(self):
        self._brokers:    dict[str, BrokerConfig]       = {}
        self._tasks:      dict[str, asyncio.Task]       = {}
        self._clients:    dict[str, "aiomqtt.Client"]   = {}
        self._ws_clients: set[WebSocket]                = set()

    # ── WebSocket broadcast ────────────────────────────────────────────────────

    def add_ws_client(self, ws: WebSocket):
        self._ws_clients.add(ws)

    def remove_ws_client(self, ws: WebSocket):
        self._ws_clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = set()
        for ws in list(self._ws_clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    # ── Broker management ──────────────────────────────────────────────────────

    def list_brokers(self) -> list[dict]:
        return [b.to_dict() for b in self._brokers.values()]

    async def add_broker(
        self,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
    ) -> dict:
        if not AIOMQTT_AVAILABLE:
            return {"ok": False, "error": "aiomqtt not installed. Run: pip install aiomqtt"}

        broker_id = str(uuid.uuid4())[:8]
        broker = BrokerConfig(
            id=broker_id, host=host, port=port,
            username=username or None, password=password or None,
        )
        self._brokers[broker_id] = broker

        task = asyncio.create_task(self._run_broker(broker))
        self._tasks[broker_id] = task

        return {"ok": True, "broker": broker.to_dict()}

    async def remove_broker(self, broker_id: str) -> dict:
        if broker_id not in self._brokers:
            return {"ok": False, "error": "Broker not found"}

        task = self._tasks.pop(broker_id, None)
        if task:
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
            except Exception:
                pass

        self._clients.pop(broker_id, None)
        self._brokers.pop(broker_id)

        await self.broadcast({"type": "broker_removed", "broker_id": broker_id})
        return {"ok": True}

    async def subscribe_topic(self, broker_id: str, topic: str) -> dict:
        broker = self._brokers.get(broker_id)
        if not broker:
            return {"ok": False, "error": "Broker not found"}
        if topic in broker.topics:
            return {"ok": True}

        broker.topics.append(topic)

        client = self._clients.get(broker_id)
        if client and broker.connected:
            try:
                await client.subscribe(topic)
            except Exception as e:
                broker.topics.remove(topic)
                return {"ok": False, "error": str(e)}

        await self.broadcast({"type": "broker_updated", "broker": broker.to_dict()})
        return {"ok": True}

    async def unsubscribe_topic(self, broker_id: str, topic: str) -> dict:
        broker = self._brokers.get(broker_id)
        if not broker:
            return {"ok": False, "error": "Broker not found"}
        if topic not in broker.topics:
            return {"ok": True}

        broker.topics.remove(topic)

        client = self._clients.get(broker_id)
        if client and broker.connected:
            try:
                await client.unsubscribe(topic)
            except Exception:
                pass

        await self.broadcast({"type": "broker_updated", "broker": broker.to_dict()})
        return {"ok": True}

    async def publish(self, broker_id: str, topic: str, payload: str) -> dict:
        broker = self._brokers.get(broker_id)
        if not broker:
            return {"ok": False, "error": "Broker not found"}
        client = self._clients.get(broker_id)
        if not client or not broker.connected:
            return {"ok": False, "error": "Not connected"}
        try:
            await client.publish(topic, payload.encode())
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Background MQTT task ───────────────────────────────────────────────────

    async def _run_broker(self, broker: BrokerConfig):
        kwargs: dict = {"hostname": broker.host, "port": broker.port}
        if broker.username:
            kwargs["username"] = broker.username
        if broker.password:
            kwargs["password"] = broker.password

        try:
            async with aiomqtt.Client(**kwargs) as client:
                self._clients[broker.id] = client
                broker.connected = True
                broker.error = None
                await self.broadcast({"type": "broker_updated", "broker": broker.to_dict()})

                for topic in broker.topics:
                    await client.subscribe(topic)

                async for message in client.messages:
                    try:
                        payload_text = message.payload.decode("utf-8", errors="replace")
                    except Exception:
                        payload_text = repr(message.payload)

                    await self.broadcast({
                        "type":      "message",
                        "broker_id": broker.id,
                        "topic":     str(message.topic),
                        "payload":   payload_text,
                        "qos":       int(message.qos),
                        "retain":    bool(message.retain),
                    })

        except asyncio.CancelledError:
            pass
        except Exception as e:
            broker.error = str(e)
            broker.connected = False
            self._clients.pop(broker.id, None)
            await self.broadcast({"type": "broker_updated", "broker": broker.to_dict()})


mqtt_manager = MQTTManager()
