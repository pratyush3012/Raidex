# RAIDEX_VEHICLE_SWAP
# Vehicle swap built strictly on top of an active subscription (never a
# standalone booking system). A swap either completes immediately (self-serve
# default) or sits as "requested" pending admin approval when the
# `vehicle_swap_requires_approval` feature flag is enabled. The old vehicle is
# released ONLY when the swap actually commits - never speculatively - so a
# rejected/failed swap can't strand a vehicle in a bad availability state.
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from pymongo.errors import OperationFailure

SWAP_STATUSES = ("requested", "completed", "rejected", "cancelled")


class VehicleSwapService:
    def __init__(self, db: Any):
        self.db = db

    async def check_eligibility(self, subscription: dict) -> None:
        if subscription["status"] != "active":
            raise HTTPException(status_code=422, detail="Subscription must be active to swap vehicles")
        in_progress = await self.db.vehicle_swaps.find_one(
            {"subscription_id": subscription["subscription_id"], "status": "requested"}, {"_id": 0},
        )
        if in_progress:
            raise HTTPException(status_code=409, detail="A swap is already in progress for this subscription")

    @staticmethod
    def quote_fee(*, old_monthly_price: float, old_category: str, new_vehicle: dict, subscription: dict) -> dict:
        price_diff = 0.0
        if new_vehicle["type"] != old_category:
            price_diff = round(float(new_vehicle["price_per_month"]) - float(old_monthly_price), 2)
        included = int(subscription.get("swaps_used", 0)) < int(subscription.get("included_swaps", 0))
        fee_amount = 0.0 if (included and price_diff <= 0) else max(0.0, price_diff)
        return {"fee_amount": fee_amount, "included_swap": included, "price_diff": price_diff}

    async def _assert_vehicle_free(self, vehicle_id: str) -> None:
        conflicting_sub = await self.db.subscriptions.find_one(
            {"vehicle_id": vehicle_id, "status": {"$in": ["pending_payment", "active"]}}, {"_id": 0},
        )
        if conflicting_sub:
            raise HTTPException(status_code=409, detail="Requested vehicle is already allocated to another subscription")
        conflicting_booking = await self.db.bookings.find_one(
            {"vehicle_id": vehicle_id, "status": {"$in": ["confirmed", "active"]}}, {"_id": 0},
        )
        if conflicting_booking:
            raise HTTPException(status_code=409, detail="Requested vehicle is already allocated to a booking")

    async def create_swap(
        self, *, subscription: dict, new_vehicle: dict, user_id: str,
        odometer_old: Optional[float] = None, auto_complete: bool = True,
    ) -> dict:
        old_vehicle_id = subscription["vehicle_id"]
        if new_vehicle["vehicle_id"] == old_vehicle_id:
            raise HTTPException(status_code=400, detail="Cannot swap a vehicle for itself")
        if not new_vehicle.get("available", False):
            raise HTTPException(status_code=409, detail="Requested vehicle is not available")
        await self._assert_vehicle_free(new_vehicle["vehicle_id"])

        fee_quote = self.quote_fee(
            old_monthly_price=subscription["monthly_price"],
            old_category=subscription["vehicle_snapshot"]["type"],
            new_vehicle=new_vehicle, subscription=subscription,
        )

        swap = {
            "swap_id": "swap_" + uuid.uuid4().hex[:12],
            "subscription_id": subscription["subscription_id"],
            "user_id": user_id,
            "old_vehicle_id": old_vehicle_id,
            "new_vehicle_id": new_vehicle["vehicle_id"],
            "fee_amount": fee_quote["fee_amount"],
            "included_swap": fee_quote["included_swap"],
            "odometer_old": odometer_old,
            "status": "requested",
            "created_at": self._now(),
            "completed_at": None,
            "notes": None,
        }
        await self.db.vehicle_swaps.insert_one(swap)
        swap.pop("_id", None)

        if auto_complete:
            return await self.complete_swap(swap["swap_id"])
        return swap

    async def complete_swap(self, swap_id: str) -> dict:
        """Atomically releases the old vehicle, activates the new one, and
        repoints the subscription at the new vehicle. Idempotent - calling
        this again on an already-completed/rejected swap is a no-op."""
        swap = await self.db.vehicle_swaps.find_one({"swap_id": swap_id}, {"_id": 0})
        if not swap:
            raise HTTPException(status_code=404, detail="Swap not found")
        if swap["status"] != "requested":
            return swap

        async def _commit(session=None) -> None:
            # Atomically claim the new vehicle (only if it's still available) so
            # two concurrent swaps/bookings targeting the same vehicle can't both
            # succeed - the loser's claim finds no matching document and raises,
            # aborting the transaction (or, on the non-transactional fallback,
            # surfacing as a conflict before any other field is touched).
            claimed = await self.db.vehicles.find_one_and_update(
                {"vehicle_id": swap["new_vehicle_id"], "available": True},
                {"$set": {"available": False}}, session=session,
            )
            if not claimed:
                raise HTTPException(status_code=409, detail="Requested vehicle is no longer available")
            await self.db.vehicles.update_one(
                {"vehicle_id": swap["old_vehicle_id"]}, {"$set": {"available": True}}, session=session,
            )
            sub_update: dict = {"$set": {"vehicle_id": swap["new_vehicle_id"], "updated_at": self._now()}}
            if swap["included_swap"]:
                sub_update["$inc"] = {"swaps_used": 1}
            await self.db.subscriptions.update_one(
                {"subscription_id": swap["subscription_id"]}, sub_update, session=session,
            )
            await self.db.vehicle_swaps.update_one(
                {"swap_id": swap_id, "status": "requested"},
                {"$set": {"status": "completed", "completed_at": self._now()}},
                session=session,
            )

        try:
            async with await self.db.client.start_session() as session:
                async with session.start_transaction():
                    await _commit(session)
        except OperationFailure:
            # Standalone/dev Mongo without a replica set can't run transactions.
            await _commit(None)

        return await self.db.vehicle_swaps.find_one({"swap_id": swap_id}, {"_id": 0})

    async def reject_swap(self, swap_id: str, *, notes: Optional[str] = None) -> dict:
        await self.db.vehicle_swaps.update_one(
            {"swap_id": swap_id, "status": "requested"},
            {"$set": {"status": "rejected", "notes": notes, "completed_at": self._now()}},
        )
        return await self.db.vehicle_swaps.find_one({"swap_id": swap_id}, {"_id": 0})

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
