# RAIDEX_SUBSCRIPTIONS
# Real vehicle subscriptions built on top of the existing vehicle/payment/
# commission infrastructure - not a parallel inventory system. A subscription
# allocates one vehicle to one customer for a fixed number of months; while a
# subscription is pending-payment or active, that vehicle cannot also be
# booked hourly/daily/weekly/monthly (and vice versa) - see
# `_has_conflicting_allocation`, which reuses the same `bookings` collection
# the booking engine already writes to.
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException
from pymongo.errors import OperationFailure

DEFAULT_INCLUDED_KM_PER_MONTH = 1000
DEFAULT_EXCESS_KM_RATE = 5.0  # INR/km beyond included_km
DEFAULT_INCLUDED_SWAPS = 1  # free vehicle swaps included per subscription
SUBSCRIPTION_STATUSES = ("pending_payment", "active", "cancelled", "expired")


class SubscriptionService:
    def __init__(self, db: Any, commission_service: Optional[Any] = None):
        self.db = db
        self._commission_service = commission_service

    async def quote(self, vehicle: dict, duration_months: int) -> dict:
        if duration_months < 1 or duration_months > 24:
            raise HTTPException(status_code=400, detail="duration_months must be between 1 and 24")
        monthly_price = float(vehicle["price_per_month"])
        deposit = float(vehicle.get("deposit", 0))
        included_km = DEFAULT_INCLUDED_KM_PER_MONTH * duration_months
        total_price = round(monthly_price * duration_months, 2)
        return {
            "vehicle_id": vehicle["vehicle_id"],
            "duration_months": duration_months,
            "monthly_price": monthly_price,
            "total_price": total_price,
            "deposit": deposit,
            "included_km": included_km,
            "excess_km_rate": DEFAULT_EXCESS_KM_RATE,
            "included_swaps": DEFAULT_INCLUDED_SWAPS,
        }

    async def _has_conflicting_allocation(self, vehicle_id: str, session=None) -> bool:
        existing_sub = await self.db.subscriptions.find_one(
            {"vehicle_id": vehicle_id, "status": {"$in": ["pending_payment", "active"]}}, {"_id": 0}, session=session,
        )
        if existing_sub:
            return True
        conflicting_booking = await self.db.bookings.find_one(
            {"vehicle_id": vehicle_id, "status": {"$in": ["confirmed", "active"]}}, {"_id": 0}, session=session,
        )
        return bool(conflicting_booking)

    async def create_subscription(self, *, user: dict, vehicle: dict, duration_months: int) -> dict:
        if user.get("kyc_status") != "verified":
            raise HTTPException(status_code=403, detail="KYC verification required before subscribing")
        if not vehicle.get("available", False) or vehicle.get("verification_status") != "approved":
            raise HTTPException(status_code=409, detail="Vehicle is not available for subscription")

        q = await self.quote(vehicle, duration_months)
        owner_id = vehicle.get("owner_id", "usr_marketplace")
        commission_split = {"commission_rate": 0.0, "commission_amount": 0.0, "net_amount": q["total_price"]}
        if self._commission_service is not None:
            commission_split = await self._commission_service.calculate(
                q["total_price"], vehicle_category=vehicle.get("type"), owner_id=owner_id,
            )
        now = self._now()
        sub = {
            "subscription_id": "sub_" + uuid.uuid4().hex[:12],
            "user_id": user["user_id"],
            "vehicle_id": vehicle["vehicle_id"],
            "owner_id": owner_id,
            "vehicle_snapshot": {"name": vehicle["name"], "image": vehicle["image"], "type": vehicle["type"]},
            "plan": "monthly",
            "duration_months": duration_months,
            "monthly_price": q["monthly_price"],
            "total_price": q["total_price"],
            "deposit": q["deposit"],
            "commission_rate": commission_split["commission_rate"],
            "commission_amount": commission_split["commission_amount"],
            "owner_net_amount": commission_split["net_amount"],
            "included_km": q["included_km"],
            "used_km": 0.0,
            "last_odometer": None,
            "excess_km_rate": q["excess_km_rate"],
            "excess_amount_due": 0.0,
            "included_swaps": q["included_swaps"],
            "swaps_used": 0,
            "status": "pending_payment",
            "start_date": None,
            "end_date": None,
            "auto_renew": False,
            "payment_id": None,
            "created_at": now,
            "updated_at": now,
            "cancelled_at": None,
            "cancel_reason": None,
        }

        async def _check_conflict_and_insert(session=None) -> None:
            if await self._has_conflicting_allocation(vehicle["vehicle_id"], session=session):
                raise HTTPException(status_code=409, detail="Vehicle is already allocated to another booking or subscription")
            await self.db.subscriptions.insert_one(sub, session=session)

        # Same race-closing pattern as BookingService.create_booking: run the
        # conflict-check + insert atomically so two concurrent requests for the
        # same vehicle can't both pass the check and double-allocate it. Falls
        # back to a best-effort non-atomic path on a standalone MongoDB (no
        # replica set) that doesn't support transactions.
        try:
            async with await self.db.client.start_session() as session:
                async with session.start_transaction():
                    await _check_conflict_and_insert(session)
        except HTTPException:
            raise
        except OperationFailure:
            await _check_conflict_and_insert(None)

        sub.pop("_id", None)
        return sub

    async def activate(self, subscription_id: str, *, payment_id: str) -> Optional[dict]:
        """Idempotent: a retried payment-confirm webhook must not re-activate
        (and re-allocate the vehicle for) an already-active subscription."""
        sub = await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})
        if not sub or sub["status"] != "pending_payment":
            return sub
        now_dt = datetime.now(timezone.utc)
        end_dt = now_dt + timedelta(days=30 * int(sub["duration_months"]))
        await self.db.subscriptions.update_one(
            {"subscription_id": subscription_id, "status": "pending_payment"},
            {"$set": {
                "status": "active",
                "start_date": now_dt.isoformat(),
                "end_date": end_dt.isoformat(),
                "payment_id": payment_id,
                "updated_at": now_dt.isoformat(),
            }},
        )
        await self.db.vehicles.update_one({"vehicle_id": sub["vehicle_id"]}, {"$set": {"available": False}})
        return await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})

    async def record_usage(self, subscription_id: str, *, odometer_reading: float) -> dict:
        """Customer-reported (phone GPS/odometer) mileage usage against the
        subscription's included allowance. Never mutates money directly -
        only computes the excess-mileage amount owed for later billing/renewal
        settlement, mirroring the "advisory, human-settled" pattern used
        elsewhere (damage inspection, AI Nexus)."""
        sub = await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})
        if not sub:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if sub["status"] != "active":
            raise HTTPException(status_code=422, detail=f"Cannot record usage on a {sub['status']} subscription")
        last = sub.get("last_odometer")
        delta = max(0.0, float(odometer_reading) - float(last)) if last is not None else 0.0
        used_km = float(sub.get("used_km", 0)) + delta
        excess_km = max(0.0, used_km - float(sub["included_km"]))
        excess_due = round(excess_km * float(sub["excess_km_rate"]), 2)
        await self.db.subscriptions.update_one(
            {"subscription_id": subscription_id},
            {"$set": {
                "used_km": used_km, "last_odometer": float(odometer_reading),
                "excess_amount_due": excess_due, "updated_at": self._now(),
            }},
        )
        return await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})

    async def renewal_quote(self, subscription: dict, duration_months: Optional[int] = None) -> dict:
        """Price a renewal at the subscription's own locked-in monthly rate
        (not the vehicle's possibly-changed current rate) - renewing at a
        surprise new price would be a bad-faith change of terms mid-contract."""
        months = int(duration_months or subscription["duration_months"])
        if months < 1 or months > 24:
            raise HTTPException(status_code=400, detail="duration_months must be between 1 and 24")
        monthly_price = float(subscription["monthly_price"])
        return {
            "subscription_id": subscription["subscription_id"],
            "duration_months": months,
            "monthly_price": monthly_price,
            "total_price": round(monthly_price * months, 2),
        }

    async def renew(self, subscription_id: str, *, user_id: str, duration_months: Optional[int] = None,
                     payment_id: Optional[str] = None) -> dict:
        sub = await self.db.subscriptions.find_one({"subscription_id": subscription_id, "user_id": user_id}, {"_id": 0})
        if not sub:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if sub["status"] not in ("active", "expired"):
            raise HTTPException(status_code=422, detail=f"Cannot renew a {sub['status']} subscription")
        months = int(duration_months or sub["duration_months"])
        renewal_price = round(float(sub["monthly_price"]) * months, 2)

        # Re-snapshot commission for THIS renewal cycle's amount - it must
        # never silently reuse the original subscription's (possibly
        # different-duration) commission_amount when a payout is created for
        # this cycle's payment.
        commission_split = {"commission_rate": sub.get("commission_rate", 0.0),
                             "commission_amount": sub.get("commission_amount", 0.0),
                             "net_amount": sub.get("owner_net_amount", renewal_price)}
        if self._commission_service is not None:
            commission_split = await self._commission_service.calculate(
                renewal_price, vehicle_category=sub["vehicle_snapshot"].get("type"), owner_id=sub.get("owner_id"),
            )

        base_dt = datetime.now(timezone.utc)
        try:
            current_end = datetime.fromisoformat(sub["end_date"].replace("Z", "+00:00"))
            if current_end > base_dt:
                base_dt = current_end
        except Exception:
            pass
        new_end = base_dt + timedelta(days=30 * months)
        await self.db.subscriptions.update_one(
            {"subscription_id": subscription_id},
            {"$set": {
                "status": "active", "end_date": new_end.isoformat(),
                "used_km": 0.0, "last_odometer": None, "excess_amount_due": 0.0,
                "included_km": DEFAULT_INCLUDED_KM_PER_MONTH * months,
                "total_price": renewal_price,
                "commission_rate": commission_split["commission_rate"],
                "commission_amount": commission_split["commission_amount"],
                "owner_net_amount": commission_split["net_amount"],
                "payment_id": payment_id or sub.get("payment_id"),
                "updated_at": self._now(),
            }},
        )
        await self.db.vehicles.update_one({"vehicle_id": sub["vehicle_id"]}, {"$set": {"available": False}})
        return await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})

    async def cancel(self, subscription_id: str, *, user_id: str, reason: str) -> dict:
        sub = await self.db.subscriptions.find_one({"subscription_id": subscription_id, "user_id": user_id}, {"_id": 0})
        if not sub:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if sub["status"] not in ("pending_payment", "active"):
            raise HTTPException(status_code=422, detail=f"Cannot cancel a {sub['status']} subscription")
        was_active = sub["status"] == "active"
        await self.db.subscriptions.update_one(
            {"subscription_id": subscription_id},
            {"$set": {
                "status": "cancelled", "cancel_reason": reason.strip(),
                "cancelled_at": self._now(), "updated_at": self._now(),
            }},
        )
        if was_active:
            await self.db.vehicles.update_one({"vehicle_id": sub["vehicle_id"]}, {"$set": {"available": True}})
        return await self.db.subscriptions.find_one({"subscription_id": subscription_id}, {"_id": 0})

    async def expire_due_subscriptions(self) -> list[dict]:
        """Background-job entry point: transitions active subscriptions whose
        end_date has passed (and aren't auto-renewing) to 'expired', releasing
        the vehicle back to normal availability. Idempotent - only touches
        subscriptions still in 'active' status."""
        now_iso = self._now()
        due = await self.db.subscriptions.find(
            {"status": "active", "end_date": {"$lte": now_iso}, "auto_renew": False}, {"_id": 0},
        ).to_list(500)
        expired = []
        for sub in due:
            await self.db.subscriptions.update_one(
                {"subscription_id": sub["subscription_id"], "status": "active"},
                {"$set": {"status": "expired", "updated_at": now_iso}},
            )
            await self.db.vehicles.update_one({"vehicle_id": sub["vehicle_id"]}, {"$set": {"available": True}})
            expired.append(sub)
        return expired

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
