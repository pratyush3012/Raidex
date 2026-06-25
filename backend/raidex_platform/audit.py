import uuid
from datetime import datetime, timezone
from typing import Any


class AuditLogger:
    def __init__(self, db: Any):
        self.db = db

    async def log(self, *, actor_id: str, action: str, target_type: str, target_id: str, before: dict | None = None, after: dict | None = None) -> dict:
        entry = {
            "audit_id": "aud_" + uuid.uuid4().hex[:12],
            "actor_id": actor_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "before_state": before,
            "after_state": after,
            "immutable": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.db.audit_log.insert_one(entry)
        return entry
