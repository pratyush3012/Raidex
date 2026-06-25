import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from providers.push_sender import PushPayload


class NotificationService:
    def __init__(self, db: Any, push_sender: Any | None = None):
        self.db = db
        self.push_sender = push_sender

    async def notify(
        self,
        *,
        user_id: str,
        title: str,
        body: str,
        ntype: str = "info",
        channels: list[str] | None = None,
    ) -> dict:
        channels = channels or ["in_app", "push"]
        notification = {
            "notification_id": "ntf_" + uuid.uuid4().hex[:12],
            "user_id": user_id,
            "title": title,
            "body": body,
            "type": ntype,
            "channels": channels,
            "read": False,
            "created_at": self._now(),
        }
        await self.db.notifications.insert_one(notification)
        for channel in channels:
            await self.db.notification_outbox.insert_one({
                "outbox_id": "out_" + uuid.uuid4().hex[:12],
                "notification_id": notification["notification_id"],
                "user_id": user_id,
                "channel": channel,
                "status": "queued",
                "attempts": 0,
                "next_attempt_at": self._now(),
                "created_at": self._now(),
            })
        return notification

    async def retry_failed(self, limit: int = 50) -> int:
        failed = await self.db.notification_outbox.find({"status": "failed"}).limit(limit).to_list(limit)
        retried = 0
        for item in failed:
            attempts = int(item.get("attempts", 0)) + 1
            await self.db.notification_outbox.update_one(
                {"outbox_id": item["outbox_id"]},
                {"$set": {
                    "status": "queued",
                    "attempts": attempts,
                    "next_attempt_at": (datetime.now(timezone.utc) + timedelta(minutes=min(60, attempts * 5))).isoformat(),
                }},
            )
            retried += 1
        return retried

    async def send_push_for_event(self, event) -> None:
        if not self.push_sender or not event.user_id:
            return
        title = event.payload.get("title") or event.name.replace(".", " ").title()
        body = event.payload.get("body") or "Raidex update"
        await self.push_sender.send(PushPayload(user_id=event.user_id, title=title, body=body))

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
