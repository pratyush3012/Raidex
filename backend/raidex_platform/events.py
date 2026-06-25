import inspect
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable


Subscriber = Callable[["DomainEvent"], Awaitable[None] | None]


@dataclass(frozen=True)
class DomainEvent:
    name: str
    payload: dict[str, Any]
    user_id: str | None = None
    event_id: str = field(default_factory=lambda: "evt_" + uuid.uuid4().hex[:16])
    occurred_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EventBus:
    def __init__(self, db: Any | None = None):
        self.db = db
        self._subscribers: dict[str, list[Subscriber]] = {}

    def set_db(self, db: Any) -> None:
        self.db = db

    def subscribe(self, event_name: str, subscriber: Subscriber) -> None:
        self._subscribers.setdefault(event_name, []).append(subscriber)

    async def publish(self, event: DomainEvent) -> DomainEvent:
        if self.db is not None and hasattr(self.db, "event_log"):
            await self.db.event_log.insert_one(self._event_doc(event, "published"))

        for subscriber in list(self._subscribers.get(event.name, [])):
            try:
                result = subscriber(event)
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:
                if self.db is not None and hasattr(self.db, "event_failures"):
                    await self.db.event_failures.insert_one({
                        **self._event_doc(event, "subscriber_failed"),
                        "subscriber": getattr(subscriber, "__name__", subscriber.__class__.__name__),
                        "error": str(exc)[:500],
                    })
        return event

    @staticmethod
    def _event_doc(event: DomainEvent, status: str) -> dict[str, Any]:
        return {
            "event_id": event.event_id,
            "name": event.name,
            "user_id": event.user_id,
            "payload": event.payload,
            "occurred_at": event.occurred_at,
            "status": status,
        }
