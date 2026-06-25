import hashlib
from typing import Any


class FeatureFlagService:
    def __init__(self, db: Any | None = None, defaults: dict[str, dict] | None = None):
        self.db = db
        self.defaults = defaults or {}

    async def enabled(self, flag: str, user: dict | None = None) -> bool:
        config = self.defaults.get(flag, {"enabled": False})
        if self.db is not None and hasattr(self.db, "feature_flags"):
            saved = await self.db.feature_flags.find_one({"flag": flag, "enabled": True}, {"_id": 0})
            if saved:
                config = saved
        if not config.get("enabled", False):
            return False
        roles = config.get("roles")
        if roles and (not user or user.get("role") not in roles):
            return False
        if config.get("internal_only") and not str(user.get("email", "") if user else "").endswith("@raidex.internal"):
            return False
        percentage = int(config.get("percentage", 100))
        if percentage >= 100:
            return True
        key = f"{flag}:{user.get('user_id') if user else 'guest'}"
        bucket = int(hashlib.sha256(key.encode()).hexdigest(), 16) % 100
        return bucket < percentage
