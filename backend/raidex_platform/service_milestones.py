# RAIDEX_SERVICE_MILESTONES
# Tracks cumulative RAIDEX-platform mileage per vehicle (vehicle.lifetime_km,
# already maintained by trip completion) and awards a benefit record exactly
# once each time a configurable threshold is crossed. Benefits are NOT fake
# redemptions - until a real service-center partner integration exists, a
# benefit sits as "eligible" then "pending_partner_fulfillment" until an admin
# marks it "fulfilled" (manual process, honestly represented).
import uuid
from datetime import datetime, timezone
from typing import Any

DEFAULT_THRESHOLDS_KM = [10_000, 25_000, 50_000, 100_000]
CONFIG_ID = "service_milestones"
BENEFIT_STATUSES = ("eligible", "pending_partner_fulfillment", "fulfilled")


class ServiceMilestoneService:
    def __init__(self, db: Any):
        self.db = db

    async def _config(self) -> dict:
        doc = await self.db.service_milestones.find_one({"config_id": CONFIG_ID}, {"_id": 0})
        return doc or {}

    async def get_thresholds(self) -> list[int]:
        config = await self._config()
        thresholds = config.get("thresholds_km")
        return sorted(int(x) for x in thresholds) if thresholds else list(DEFAULT_THRESHOLDS_KM)

    async def set_thresholds(self, thresholds_km: list[int], *, updated_by: str) -> dict:
        doc = {
            "config_id": CONFIG_ID,
            "thresholds_km": sorted(int(x) for x in thresholds_km),
            "updated_by": updated_by,
            "updated_at": self._now(),
        }
        await self.db.service_milestones.update_one({"config_id": CONFIG_ID}, {"$set": doc}, upsert=True)
        return doc

    async def check_and_award(self, vehicle_id: str) -> list[dict]:
        """Call after any event that can move a vehicle's lifetime_km (trip
        completion). Returns newly-crossed milestone benefit records (empty if
        none newly crossed). Idempotent: each threshold is recorded on
        `vehicle_service_progress` the first time it's crossed and never
        re-awarded, so a retried trip-completion call can't double-benefit."""
        vehicle = await self.db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
        if not vehicle:
            return []
        lifetime_km = float(vehicle.get("lifetime_km", 0))
        progress = await self.db.vehicle_service_progress.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
        awarded = set((progress or {}).get("awarded_thresholds_km", []))
        thresholds = await self.get_thresholds()
        newly_crossed = [t for t in thresholds if lifetime_km >= t and t not in awarded]

        if not newly_crossed:
            await self.db.vehicle_service_progress.update_one(
                {"vehicle_id": vehicle_id},
                {"$set": {"vehicle_id": vehicle_id, "lifetime_km": lifetime_km, "updated_at": self._now()}},
                upsert=True,
            )
            return []

        new_benefits = []
        for threshold in newly_crossed:
            benefit = {
                "benefit_id": "svcben_" + uuid.uuid4().hex[:12],
                "vehicle_id": vehicle_id,
                "owner_id": vehicle.get("owner_id"),
                "milestone_km": threshold,
                "lifetime_km_at_award": lifetime_km,
                "status": "eligible",
                "benefit_type": "service_credit",
                "created_at": self._now(),
                "fulfilled_at": None,
                "notes": None,
            }
            await self.db.service_benefits.insert_one(benefit)
            new_benefits.append(benefit)

        awarded |= set(newly_crossed)
        await self.db.vehicle_service_progress.update_one(
            {"vehicle_id": vehicle_id},
            {"$set": {
                "vehicle_id": vehicle_id, "lifetime_km": lifetime_km,
                "awarded_thresholds_km": sorted(awarded),
                "updated_at": self._now(),
            }},
            upsert=True,
        )
        return new_benefits

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
