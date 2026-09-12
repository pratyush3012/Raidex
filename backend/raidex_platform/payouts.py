# RAIDEX_PAYOUT_SERVICE
# Owner payout accounting. A payout record is created exactly once per
# completed booking (idempotent), using the commission split already
# snapshotted on the booking at creation time - payouts never re-resolve the
# live commission rate, so a later commission-config change can't alter a
# historical payout.
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

PAYOUT_STATUSES = ("pending", "eligible", "processing", "paid", "failed", "cancelled", "disputed")


class PayoutService:
    def __init__(self, db: Any):
        self.db = db

    async def create_payout_for_booking(self, booking: dict) -> dict:
        """Idempotent: a retried trip-completion call (or a concurrent one) must
        not create a second payout for the same booking."""
        existing = await self.db.payouts.find_one({"booking_id": booking["booking_id"]}, {"_id": 0})
        if existing:
            return existing

        gross = round(float(booking.get("total_amount", 0)), 2)
        commission_rate = float(booking.get("commission_rate", 0))
        commission_amount = float(booking.get("commission_amount", 0))
        net_amount = float(booking.get("owner_net_amount", gross - commission_amount))
        now = datetime.now(timezone.utc).isoformat()
        payout = {
            "payout_id": "payout_" + uuid.uuid4().hex[:12],
            "source_type": "booking",
            "owner_id": booking["owner_id"],
            "vehicle_id": booking["vehicle_id"],
            "booking_id": booking["booking_id"],
            "subscription_id": None,
            "payment_id": None,
            "gross_amount": gross,
            "commission_rate": commission_rate,
            "commission_amount": commission_amount,
            "fees": 0.0,
            "net_amount": round(net_amount, 2),
            "currency": "INR",
            "status": "eligible",
            "created_at": now,
            "eligible_at": now,
            "paid_at": None,
            "payment_reference": None,
            "notes": None,
        }
        try:
            await self.db.payouts.insert_one(payout)
        except Exception:
            # A unique index on booking_id (see create_indexes) turns a genuine
            # race into a duplicate-key error here - fall back to the winner's row.
            existing = await self.db.payouts.find_one({"booking_id": booking["booking_id"]}, {"_id": 0})
            if existing:
                return existing
            raise
        return payout

    async def create_payout_for_subscription_payment(self, subscription: dict, *, payment_id: str) -> dict:
        """Owner payout for the revenue captured by one subscription payment
        (initial activation or a future renewal charge). Idempotent per
        `payment_id` - a retried payment-confirm webhook must not create a
        second payout for the same payment. Uses `payment_id` rather than
        `booking_id` as the idempotency key since a subscription has no
        booking to key off; a `booking_id: None` payout intentionally does not
        collide with the booking-payout uniqueness invariant (see the partial
        unique index in `create_indexes`)."""
        existing = await self.db.payouts.find_one(
            {"source_type": "subscription", "payment_id": payment_id}, {"_id": 0},
        )
        if existing:
            return existing

        gross = round(float(subscription.get("total_price", 0)), 2)
        commission_rate = float(subscription.get("commission_rate", 0))
        commission_amount = float(subscription.get("commission_amount", 0))
        net_amount = float(subscription.get("owner_net_amount", gross - commission_amount))
        now = datetime.now(timezone.utc).isoformat()
        payout = {
            "payout_id": "payout_" + uuid.uuid4().hex[:12],
            "source_type": "subscription",
            "owner_id": subscription["owner_id"],
            "vehicle_id": subscription["vehicle_id"],
            "booking_id": None,
            "subscription_id": subscription["subscription_id"],
            "payment_id": payment_id,
            "gross_amount": gross,
            "commission_rate": commission_rate,
            "commission_amount": commission_amount,
            "fees": 0.0,
            "net_amount": round(net_amount, 2),
            "currency": "INR",
            "status": "eligible",
            "created_at": now,
            "eligible_at": now,
            "paid_at": None,
            "payment_reference": None,
            "notes": None,
        }
        try:
            await self.db.payouts.insert_one(payout)
        except Exception:
            existing = await self.db.payouts.find_one(
                {"source_type": "subscription", "payment_id": payment_id}, {"_id": 0},
            )
            if existing:
                return existing
            raise
        return payout

    async def mark_paid(self, payout_id: str, *, payment_reference: str, notes: Optional[str] = None) -> Optional[dict]:
        now = datetime.now(timezone.utc).isoformat()
        await self.db.payouts.update_one(
            {"payout_id": payout_id},
            {"$set": {"status": "paid", "paid_at": now, "payment_reference": payment_reference, "notes": notes}},
        )
        return await self.db.payouts.find_one({"payout_id": payout_id}, {"_id": 0})

    async def mark_failed(self, payout_id: str, *, notes: Optional[str] = None) -> Optional[dict]:
        await self.db.payouts.update_one(
            {"payout_id": payout_id},
            {"$set": {"status": "failed", "notes": notes}},
        )
        return await self.db.payouts.find_one({"payout_id": payout_id}, {"_id": 0})
