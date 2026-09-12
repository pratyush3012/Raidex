# RAIDEX_BOOKING_SERVICE
# Search tags: booking create, booking cancel, booking extend, invoice, GST invoice,
# disputes, availability conflict, booking lifecycle business rules.
import os
import time
import uuid
from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure


class BookingService:
    # How long a per-vehicle create-booking lock is held before it is treated
    # as stale and reclaimable. Bounds how long a crashed/hung holder can
    # block a vehicle - no manual cleanup is needed, the next request simply
    # reclaims it once this window lapses.
    VEHICLE_LOCK_TTL_SECONDS = 20

    def __init__(
        self,
        db: Any,
        utc_now: Callable[[], str],
        payment_gateway_factory: Optional[Callable[[], Any]] = None,
        wallet_ledger_appender: Optional[Callable[..., Any]] = None,
        commission_service: Optional[Any] = None,
    ):
        self.db = db
        self.utc_now = utc_now
        self._payment_gateway_factory = payment_gateway_factory
        self._wallet_ledger_appender = wallet_ledger_appender
        self._commission_service = commission_service

    async def _acquire_vehicle_lock(self, vehicle_id: str, holder: str) -> bool:
        """Atomically claim a short-lived per-vehicle lock so two truly
        concurrent create_booking calls for the same vehicle can never both
        pass the conflict check and insert overlapping bookings.

        A MongoDB transaction alone does NOT prevent this: two overlapping
        (but not identical) bookings are two different documents, so there is
        nothing for Mongo's write-conflict detection to catch. Serializing
        booking *creation* per vehicle - via an atomic find_one_and_update
        claim on a dedicated lock document, the same "atomic claim" pattern
        used elsewhere in this codebase (see payment confirmation) - is what
        actually makes the check-then-insert safe under real concurrency.
        """
        now = time.time()
        available = {
            "vehicle_id": vehicle_id,
            "$or": [{"holder": None}, {"expires_at": {"$lt": now}}],
        }
        claim = {"$set": {
            "vehicle_id": vehicle_id,
            "holder": holder,
            "expires_at": now + self.VEHICLE_LOCK_TTL_SECONDS,
        }}

        doc = await self.db.vehicle_locks.find_one_and_update(
            available, claim, return_document=ReturnDocument.AFTER,
        )
        if doc is not None:
            return True

        # No lock row exists yet for this vehicle - create one lazily so the
        # claim above has something to act on next time. If two requests race
        # to create it, the unique index on vehicle_id lets only one insert
        # win; the loser just falls through to the retry below.
        try:
            await self.db.vehicle_locks.update_one(
                {"vehicle_id": vehicle_id},
                {"$setOnInsert": {"vehicle_id": vehicle_id, "holder": None, "expires_at": 0}},
                upsert=True,
            )
        except DuplicateKeyError:
            pass

        doc = await self.db.vehicle_locks.find_one_and_update(
            available, claim, return_document=ReturnDocument.AFTER,
        )
        return doc is not None

    async def _release_vehicle_lock(self, vehicle_id: str, holder: str) -> None:
        # Only clears the lock if we're still the holder, so a slow request
        # can never release a lock that has since expired and been reclaimed
        # by someone else.
        await self.db.vehicle_locks.update_one(
            {"vehicle_id": vehicle_id, "holder": holder},
            {"$set": {"holder": None, "expires_at": 0}},
        )

    async def create_booking(self, payload: Any, user: dict) -> dict:
        if user.get("kyc_status") != "verified":
            raise HTTPException(status_code=403, detail="KYC verification required before booking")
        veh = await self.db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if not veh.get("available", False) or veh.get("verification_status") != "approved":
            raise HTTPException(status_code=409, detail="Vehicle is not available for booking")

        start, end = self._parse_range(payload.start_date, payload.end_date)
        duration = (end - start).total_seconds()
        if duration <= 0:
            raise HTTPException(status_code=400, detail="End date must be after start date")

        amount = self._rental_amount(veh, payload.plan, duration)
        owner_id = veh.get("owner_id", "usr_marketplace")

        # Snapshot the commission split at booking-creation time. This is a durable
        # financial record: if the platform commission config changes later, this
        # booking's own figures must NOT retroactively change.
        commission_split = {"commission_rate": 0.0, "commission_amount": 0.0, "net_amount": amount}
        if self._commission_service is not None:
            commission_split = await self._commission_service.calculate(
                amount, vehicle_category=veh.get("type"), owner_id=owner_id,
            )

        booking = {
            "booking_id": "bkg_" + uuid.uuid4().hex[:12],
            "user_id": user["user_id"],
            "vehicle_id": veh["vehicle_id"],
            "owner_id": owner_id,
            "vehicle_snapshot": {
                "name": veh["name"],
                "image": veh["image"],
                "type": veh["type"],
                "brand": veh["brand"],
                "location": veh["location"],
            },
            "plan": payload.plan,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "total_amount": amount,
            "deposit": veh["deposit"],
            "commission_rate": commission_split["commission_rate"],
            "commission_amount": commission_split["commission_amount"],
            "owner_net_amount": commission_split["net_amount"],
            "status": "pending_payment",
            "created_at": self.utc_now(),
            "odometer_start": None,
            "odometer_end": None,
            "inspection_before": [],
            "inspection_after": [],
            "add_ons": payload.add_ons,
            "payment_id": None,
        }

        async def _check_conflict_and_insert(session=None) -> None:
            conflict = await self.db.bookings.find_one({
                "vehicle_id": payload.vehicle_id,
                "status": {"$in": ["confirmed", "active"]},
                "start_date": {"$lt": payload.end_date},
                "end_date": {"$gt": payload.start_date},
            }, {"_id": 0, "booking_id": 1, "start_date": 1, "end_date": 1}, session=session)
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail=f"Vehicle is already booked from {conflict['start_date']} to {conflict['end_date']}. Please choose different dates.",
                )
            await self.db.bookings.insert_one(booking, session=session)

        # Serialize booking creation for this vehicle: only one concurrent
        # create_booking call for the same vehicle may run the conflict check
        # + insert at a time. This is what actually prevents double-booking
        # under real concurrency - see _acquire_vehicle_lock for why the
        # transaction below, on its own, is not enough.
        lock_holder = uuid.uuid4().hex
        if not await self._acquire_vehicle_lock(payload.vehicle_id, lock_holder):
            raise HTTPException(
                status_code=409,
                detail="Vehicle is currently being booked by another request. Please try again.",
            )
        try:
            # Also run the conflict check + insert inside a transaction, as
            # defense in depth for write conflicts on a single document (e.g. a
            # racing retry with the same booking id). Falls back to a
            # best-effort non-atomic path on a standalone MongoDB (no replica
            # set) that doesn't support transactions - this only happens in
            # local/dev setups without a replica set.
            try:
                async with await self.db.client.start_session() as session:
                    async with session.start_transaction():
                        await _check_conflict_and_insert(session)
            except HTTPException:
                raise
            except OperationFailure:
                await _check_conflict_and_insert(None)
        finally:
            await self._release_vehicle_lock(payload.vehicle_id, lock_holder)

        booking.pop("_id", None)
        return booking

    async def cancel_booking(self, booking_id: str, payload: Any, user: dict) -> dict:
        booking = await self.db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking["status"] not in ("pending_payment", "confirmed"):
            raise HTTPException(status_code=422, detail=f"Cannot cancel a {booking['status']} booking")

        refund_due = 0
        refund_status = None
        pay = None
        if booking.get("payment_id"):
            pay = await self.db.payments.find_one({"payment_id": booking["payment_id"], "status": "succeeded"}, {"_id": 0})
            if pay:
                refund_due = pay["amount"]

        if pay and self._payment_gateway_factory and self._wallet_ledger_appender:
            gateway = self._payment_gateway_factory()
            result = await gateway.refund(provider_payment_id=pay.get("provider_payment_id"), amount=pay["amount"])
            if result.success:
                await self.db.payments.update_one({"payment_id": pay["payment_id"]}, {"$set": {
                    "refund_amount": result.refund_amount,
                    "refund_status": "processed",
                    "status": "refunded",
                    "refunded_at": self.utc_now(),
                    "updated_at": self.utc_now(),
                }})
                await self._wallet_ledger_appender(
                    user["user_id"], result.refund_amount, "refund",
                    payment_id=pay["payment_id"], ref_id=booking_id,
                )
                refund_due = result.refund_amount
                refund_status = "processed"
            else:
                await self.db.payments.update_one({"payment_id": pay["payment_id"]}, {"$set": {"refund_status": "failed"}})
                refund_status = "failed"

        await self.db.bookings.update_one({"booking_id": booking_id}, {"$set": {
            "status": "cancelled",
            "cancel_reason": payload.reason.strip(),
            "cancelled_at": self.utc_now(),
            "refund_due": refund_due,
            "refund_status": refund_status,
        }})
        await self.db.admin_audit.insert_one({
            "audit_id": "aud_" + uuid.uuid4().hex[:10],
            "admin_id": user["user_id"],
            "action": "booking.cancel",
            "target_type": "booking",
            "target_id": booking_id,
            "before_state": {"status": booking["status"]},
            "after_state": {"status": "cancelled", "refund_due": refund_due},
            "created_at": self.utc_now(),
        })
        return {"ok": True, "status": "cancelled", "refund_due": refund_due, "refund_status": refund_status}

    async def extend_booking(self, booking_id: str, payload: Any, user: dict) -> dict:
        booking = await self.db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking["status"] not in ("confirmed", "active"):
            raise HTTPException(status_code=422, detail=f"Cannot extend a {booking['status']} booking")
        try:
            old_end = datetime.fromisoformat(booking["end_date"].replace("Z", "+00:00"))
            new_end = datetime.fromisoformat(payload.end_date.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format")
        if new_end <= old_end:
            raise HTTPException(status_code=400, detail="New end date must be after current end date")

        conflict = await self.db.bookings.find_one({
            "vehicle_id": booking["vehicle_id"],
            "booking_id": {"$ne": booking_id},
            "status": {"$in": ["confirmed", "active"]},
            "start_date": {"$lt": payload.end_date},
            "end_date": {"$gt": booking["end_date"]},
        }, {"_id": 0, "booking_id": 1})
        if conflict:
            raise HTTPException(status_code=409, detail="Vehicle is already booked during the requested extension")

        vehicle = await self.db.vehicles.find_one({"vehicle_id": booking["vehicle_id"]}, {"_id": 0})
        extra_seconds = (new_end - old_end).total_seconds()
        extra_amount = round((vehicle.get("price_per_day", 0) / 86400) * extra_seconds, 2)
        await self.db.bookings.update_one({"booking_id": booking_id}, {"$set": {
            "end_date": payload.end_date,
            "extension_amount_due": extra_amount,
            "updated_at": self.utc_now(),
        }})
        return {"ok": True, "booking_id": booking_id, "end_date": payload.end_date, "extension_amount_due": extra_amount}

    async def invoice(self, booking_id: str, gst: bool, user: dict) -> dict:
        booking = await self.db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        taxable = round(float(booking["total_amount"]) / 1.18, 2)
        tax = round(float(booking["total_amount"]) - taxable, 2)
        return {
            "invoice_id": "inv_" + booking_id.replace("bkg_", ""),
            "booking_id": booking_id,
            "issued_at": self.utc_now(),
            "customer": {"name": user["name"], "email": user["email"]},
            "vehicle": booking["vehicle_snapshot"],
            "line_items": [
                {"description": f"Raidex rental - {booking['plan']}", "amount": taxable},
                {"description": "GST 18%" if gst else "Taxes", "amount": tax},
                {"description": "Refundable deposit", "amount": booking["deposit"]},
            ],
            "total": round(float(booking["total_amount"]) + float(booking["deposit"]), 2),
            "gst_invoice": gst,
            "supplier_gstin": os.getenv("RAIDEX_GSTIN", None) if gst else None,
        }

    async def create_dispute(self, booking_id: str, payload: Any, user: dict) -> dict:
        if payload.booking_id != booking_id:
            raise HTTPException(status_code=400, detail="Booking id mismatch")
        booking = await self.db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        dispute = {
            "dispute_id": "dsp_" + uuid.uuid4().hex[:12],
            "booking_id": booking_id,
            "user_id": user["user_id"],
            "category": payload.category,
            "message": payload.message.strip(),
            "status": "open",
            "created_at": self.utc_now(),
            "updated_at": self.utc_now(),
        }
        await self.db.disputes.insert_one(dispute)
        dispute.pop("_id", None)
        return dispute

    @staticmethod
    def _parse_range(start_date: str, end_date: str) -> tuple[datetime, datetime]:
        try:
            return (
                datetime.fromisoformat(start_date.replace("Z", "+00:00")),
                datetime.fromisoformat(end_date.replace("Z", "+00:00")),
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format")

    @staticmethod
    def _rental_amount(vehicle: dict, plan: str, duration_seconds: float) -> float:
        if plan == "hourly":
            units = max(1, int(duration_seconds / 3600))
            return vehicle["price_per_hour"] * units
        if plan == "daily":
            units = max(1, int(duration_seconds / 86400) + (1 if duration_seconds % 86400 else 0))
            return vehicle["price_per_day"] * units
        if plan == "weekly":
            units = max(1, int(duration_seconds / (86400 * 7)) + (1 if duration_seconds % (86400 * 7) else 0))
            return vehicle["price_per_week"] * units
        units = max(1, int(duration_seconds / (86400 * 30)) + (1 if duration_seconds % (86400 * 30) else 0))
        return vehicle["price_per_month"] * units
