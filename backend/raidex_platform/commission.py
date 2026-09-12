# RAIDEX_COMMISSION_ENGINE
# Single source of truth for platform commission. Nothing else in the codebase
# should hardcode a commission percentage - always go through CommissionService.
from typing import Any, Optional

DEFAULT_COMMISSION_RATE = 0.40  # RAIDEX platform target take rate (business default)
CONFIG_ID = "commission"


class CommissionService:
    """Resolves the effective commission rate and computes deterministic
    gross/commission/net splits. Backed by a single `platform_config` document
    so the rate is admin-configurable without a code deploy. Vehicle-category
    and owner-specific overrides take precedence over the global default.

    Historical financial correctness: callers that create a durable financial
    record (a booking, a payout) must snapshot the *resolved* rate/amounts onto
    that record at creation time - do not re-resolve the live rate for
    historical records, since the whole point of this service is that the
    global rate can change going forward without altering the past.
    """

    def __init__(self, db: Any):
        self.db = db

    async def _config(self) -> dict:
        if self.db is None:
            return {}
        doc = await self.db.platform_config.find_one({"config_id": CONFIG_ID}, {"_id": 0})
        return doc or {}

    async def get_rate(self, *, vehicle_category: Optional[str] = None, owner_id: Optional[str] = None) -> float:
        config = await self._config()
        owner_overrides = config.get("owner_overrides") or {}
        if owner_id and owner_id in owner_overrides:
            return float(owner_overrides[owner_id])
        category_overrides = config.get("category_overrides") or {}
        if vehicle_category and vehicle_category in category_overrides:
            return float(category_overrides[vehicle_category])
        return float(config.get("default_rate", DEFAULT_COMMISSION_RATE))

    async def calculate(
        self,
        gross_amount: float,
        *,
        vehicle_category: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> dict:
        rate = await self.get_rate(vehicle_category=vehicle_category, owner_id=owner_id)
        gross = round(float(gross_amount), 2)
        commission_amount = round(gross * rate, 2)
        net_amount = round(gross - commission_amount, 2)
        return {
            "gross_amount": gross,
            "commission_rate": rate,
            "commission_amount": commission_amount,
            "net_amount": net_amount,
        }

    async def get_config(self) -> dict:
        config = await self._config()
        return {
            "default_rate": float(config.get("default_rate", DEFAULT_COMMISSION_RATE)),
            "category_overrides": config.get("category_overrides") or {},
            "owner_overrides": config.get("owner_overrides") or {},
            "updated_at": config.get("updated_at"),
            "updated_by": config.get("updated_by"),
        }

    async def set_config(
        self,
        *,
        default_rate: Optional[float] = None,
        category_overrides: Optional[dict] = None,
        owner_overrides: Optional[dict] = None,
        updated_by: str,
        now: str,
    ) -> dict:
        current = await self._config()
        update = {
            "config_id": CONFIG_ID,
            "default_rate": float(default_rate) if default_rate is not None else float(current.get("default_rate", DEFAULT_COMMISSION_RATE)),
            "category_overrides": category_overrides if category_overrides is not None else (current.get("category_overrides") or {}),
            "owner_overrides": owner_overrides if owner_overrides is not None else (current.get("owner_overrides") or {}),
            "updated_at": now,
            "updated_by": updated_by,
        }
        await self.db.platform_config.update_one({"config_id": CONFIG_ID}, {"$set": update}, upsert=True)
        return await self.get_config()
