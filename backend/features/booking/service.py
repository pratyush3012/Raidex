# RAIDEX_BOOKING_SERVICE
# Search tags: booking create, booking cancel, booking extend, invoice, GST invoice,
# disputes, availability conflict, booking lifecycle business rules.
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

from raidex_platform.pricing_engine import PricingConfigService, PricingEngine, derive_default_rate_range


class BookingService:
    # How long a per-vehicle create-booking lock is held before it is treated
    # as stale and reclaimable. Bounds how long a crashed/hung holder can
    # block a vehicle - no manual cleanup is needed, the next request simply
    # reclaims it once this window lapses.
    VEHICLE_LOCK_TTL_SECONDS = 20

    # No next-minute pickups: gives owners/ops real time to prep the vehicle.
    # This is the single source of truth for the rule - the client (see
    # `/config`'s `min_booking_lead_hours`) reads it from here rather than
    # hardcoding it, and it is enforced again below regardless of what any
    # client sends, since client-side validation alone is not trustworthy.
    MIN_BOOKING_LEAD_HOURS = int(os.getenv("MIN_BOOKING_LEAD_HOURS", "2"))

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

    async def _ensure_rate_range(self, vehicle: dict) -> dict:
        """Lazily backfill min_hourly_rate/max_hourly_rate the first time a
        vehicle is priced, rather than requiring a one-off migration script
        that could be forgotten. Persisted once so an admin can review/edit
        the derived range afterward via the pricing admin endpoints - this
        only fires for vehicles nobody has configured a real range for yet."""
        if vehicle.get("min_hourly_rate") is not None and vehicle.get("max_hourly_rate") is not None:
            return vehicle
        min_rate, max_rate = derive_default_rate_range(vehicle.get("price_per_hour", 0))
        await self.db.vehicles.update_one(
            {"vehicle_id": vehicle["vehicle_id"]},
            {"$set": {"min_hourly_rate": min_rate, "max_hourly_rate": max_rate}},
        )
        vehicle = dict(vehicle)
        vehicle["min_hourly_rate"] = min_rate
        vehicle["max_hourly_rate"] = max_rate
        return vehicle

    async def create_booking(self, payload: Any, user: dict) -> dict:
        if user.get("kyc_status") != "verified":
            raise HTTPException(status_code=403, detail="KYC verification required before booking")
        veh = await self.db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if not veh.get("available", False) or veh.get("verification_status") != "approved":
            raise HTTPException(status_code=409, detail="Vehicle is not available for booking")
        veh = await self._ensure_rate_range(veh)

        start, end = self._parse_range(payload.start_date, payload.end_date)
        duration_seconds = (end - start).total_seconds()
        if duration_seconds <= 0:
            raise HTTPException(status_code=400, detail="End date must be after start date")
        duration_hours = duration_seconds / 3600

        config_service = PricingConfigService(self.db)
        config = await config_service.get_config()
        min_notice_hours = float(config.get("min_notice_hours", self.MIN_BOOKING_LEAD_HOURS))
        earliest_start = datetime.now(timezone.utc) + timedelta(hours=min_notice_hours)
        if start < earliest_start:
            raise HTTPException(
                status_code=400,
                detail=f"Pickup must be at least {min_notice_hours:g} hours from now",
            )
        min_booking_hours = await config_service.min_booking_hours(veh.get("type", "car"))
        if duration_hours + 1e-9 < min_booking_hours:
            raise HTTPException(
                status_code=400,
                detail=f"Minimum booking duration for this vehicle is {min_booking_hours:g} hours",
            )

        lead_time_hours = max(0.0, (start - datetime.now(timezone.utc)).total_seconds() / 3600)
        estimate = PricingEngine.calculate_booking_price(
            vehicle=veh, duration_hours=duration_hours, lead_time_hours=lead_time_hours,
            min_booking_hours=min_booking_hours, config=config,
        )

        add_ons_pricing = config.get("add_ons_pricing") or {}
        add_on_total = round(sum(float(add_ons_pricing.get(k, 0)) for k in (payload.add_ons or [])), 2)
        total_payable = round(estimate["total_payable"] + add_on_total, 2)
        owner_id = veh.get("owner_id", "usr_marketplace")

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
            # total_amount stays base-rental-only (unchanged historical
            # meaning) - PayoutService, RideMiles-earned and the invoice
            # generator all key off this as "the rentable revenue", not fees/
            # tax/add-ons. See pricing_breakdown for the full itemization.
            "total_amount": estimate["rental_subtotal"],
            "platform_fee": estimate["platform_fee"],
            "tax": estimate["tax"],
            "add_on_total": add_on_total,
            "total_payable": total_payable,
            "pricing_breakdown": estimate,
            "pricing_rule_version": estimate["pricing_rule_version"],
            "deposit": veh["deposit"],
            # RaideX's 80/20 host/platform split of the BASE RENTAL ONLY (never
            # tax/platform fee/deposit) - reusing the existing commission_rate/
            # commission_amount/owner_net_amount field names so PayoutService
            # and every existing owner-earnings reader keep working unchanged;
            # the numbers now come from PricingEngine, not CommissionService
            # (that service still backs subscriptions, a separate product line
            # this pricing spec doesn't cover).
            "commission_rate": round(1 - estimate["host_payout_pct"], 4),
            "commission_amount": estimate["platform_commission"],
            "owner_net_amount": estimate["host_payout"],
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

    async def confirm_paid_booking(self, booking: dict, payment_id: str) -> bool:
        """Flip a paid booking to 'confirmed' - but only if the vehicle is
        still actually free for these dates.

        Payment capture happens well after create_booking's conflict check
        and lock have already released, so without re-checking here a
        vehicle can be legitimately double-booked: two `pending_payment`
        bookings for overlapping dates both pass create_booking's conflict
        check (neither is 'confirmed' yet), then both pay successfully and
        both would naively get confirmed. Re-acquiring the same per-vehicle
        lock also serializes this against a concurrent create_booking call.

        Returns True once confirmed. Returns False if a conflicting
        confirmed/active booking claimed the vehicle first - in that case
        this booking is cancelled and its payment refunded automatically;
        the caller is responsible for notifying the user of the failure.
        """
        booking_id = booking["booking_id"]
        vehicle_id = booking["vehicle_id"]
        lock_holder = uuid.uuid4().hex
        if not await self._acquire_vehicle_lock(vehicle_id, lock_holder):
            # A booking-affecting operation is already in flight for this
            # vehicle (e.g. another confirm or a fresh create_booking) -
            # treat as a conflict rather than block indefinitely; the
            # payment is refunded and the user can retry.
            await self._fail_booking_after_paid_conflict(booking, payment_id)
            return False
        try:
            conflict = await self.db.bookings.find_one({
                "vehicle_id": vehicle_id,
                "booking_id": {"$ne": booking_id},
                "status": {"$in": ["confirmed", "active"]},
                "start_date": {"$lt": booking["end_date"]},
                "end_date": {"$gt": booking["start_date"]},
            }, {"_id": 0, "booking_id": 1})
            if conflict:
                await self._fail_booking_after_paid_conflict(booking, payment_id)
                return False
            await self.db.bookings.update_one({"booking_id": booking_id}, {"$set": {"status": "confirmed"}})
            return True
        finally:
            await self._release_vehicle_lock(vehicle_id, lock_holder)

    async def _fail_booking_after_paid_conflict(self, booking: dict, payment_id: str) -> None:
        await self.db.bookings.update_one({"booking_id": booking["booking_id"]}, {"$set": {
            "status": "cancelled",
            "cancel_reason": "Vehicle was booked by another rider before this payment could be confirmed",
            "cancelled_at": self.utc_now(),
        }})
        if not (self._payment_gateway_factory and self._wallet_ledger_appender):
            return
        pay = await self.db.payments.find_one({"payment_id": payment_id}, {"_id": 0})
        if not pay or pay.get("status") != "succeeded":
            return
        gateway = self._payment_gateway_factory()
        result = await gateway.refund(provider_payment_id=pay.get("provider_payment_id"), amount=pay["amount"])
        if result.success:
            await self.db.payments.update_one({"payment_id": payment_id}, {"$set": {
                "refund_amount": result.refund_amount,
                "refund_status": "processed",
                "status": "refunded",
                "refunded_at": self.utc_now(),
                "updated_at": self.utc_now(),
            }})
            await self._wallet_ledger_appender(
                booking["user_id"], result.refund_amount, "refund",
                payment_id=payment_id, ref_id=booking["booking_id"],
            )
        else:
            await self.db.payments.update_one({"payment_id": payment_id}, {"$set": {"refund_status": "failed"}})

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
        """Extensions are priced and paid for immediately (not left as a
        vague "amount_due" nobody actually collects, which is what this
        method did before): the customer is charged the vehicle's MAX_RATE
        for the added time (short-notice rental, not the original discounted
        rate), the host is paid the booking's ORIGINAL rate, and RaideX keeps
        the difference - see PricingEngine.calculate_extension_price.

        Collection uses the existing wallet ledger (debit customer / credit
        host), the same audited mechanism refunds already use in this file,
        rather than a new Razorpay-integrated flow - that would mean adding
        new branches to the payment-confirmation dispatch that both the
        webhook and the manual-confirm route share, which is exactly the kind
        of shared, security-sensitive code this codebase's own audits flag as
        risky to touch without very deliberate, isolated review. Requires
        `wallet_ledger_appender` to be supplied to this service (see the
        `/bookings/{id}/extend` route)."""
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

        # Availability: the extension must not run into another confirmed/
        # active booking of the same vehicle (spec: check next booking,
        # buffer time - this codebase has no separate buffer-time config, so
        # the check is a direct overlap test against the extended window).
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
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        vehicle = await self._ensure_rate_range(vehicle)

        extension_hours = (new_end - old_end).total_seconds() / 3600
        original_rate = (booking.get("pricing_breakdown") or {}).get("calculated_hourly_rate")
        if original_rate is None:
            # Pre-pricing-engine historical booking with no snapshotted rate -
            # fall back to its own effective average hourly rate rather than
            # guessing at MAX_RATE (which would silently overcharge the host
            # on the extension's host-payout leg).
            old_start = datetime.fromisoformat(booking["start_date"].replace("Z", "+00:00"))
            original_duration_hours = max(1 / 60, (old_end - old_start).total_seconds() / 3600)
            original_rate = round(float(booking["total_amount"]) / original_duration_hours, 2)

        config = await PricingConfigService(self.db).get_config()
        calc = PricingEngine.calculate_extension_price(
            original_hourly_rate=original_rate, max_hourly_rate=vehicle["max_hourly_rate"],
            extension_hours=extension_hours, config=config,
        )

        if not self._wallet_ledger_appender:
            raise HTTPException(status_code=500, detail="Extension payment is not available right now")
        fresh_user = await self.db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
        wallet_balance = float((fresh_user or {}).get("wallet_balance", 0))
        if wallet_balance + 1e-9 < calc["total_payable"]:
            raise HTTPException(
                status_code=402,
                detail=f"Insufficient wallet balance for this extension (need ₹{calc['total_payable']:.2f}, have ₹{wallet_balance:.2f}). Top up your wallet and try again.",
            )

        extension_id = "ext_" + uuid.uuid4().hex[:12]
        await self._wallet_ledger_appender(user["user_id"], -calc["total_payable"], "extension_charge", ref_id=extension_id)
        await self._wallet_ledger_appender(booking["owner_id"], calc["host_extension_payout"], "extension_host_payout", ref_id=extension_id)

        extension_record = {
            "extension_id": extension_id,
            "booking_id": booking_id,
            "vehicle_id": booking["vehicle_id"],
            "owner_id": booking["owner_id"],
            "user_id": user["user_id"],
            "old_end_date": booking["end_date"],
            "new_end_date": payload.end_date,
            **calc,
            "platform_extension_revenue": calc["platform_extension_revenue"],
            "created_at": self.utc_now(),
        }
        await self.db.booking_extensions.insert_one(extension_record)
        await self.db.financial_ledger.insert_many([
            {"ledger_id": "fl_" + uuid.uuid4().hex[:12], "booking_id": booking_id, "event_type": "EXTENSION_CREATED",
             "amount": calc["extension_amount"], "party": "user", "created_at": self.utc_now(), "meta": {"extension_id": extension_id}},
            {"ledger_id": "fl_" + uuid.uuid4().hex[:12], "booking_id": booking_id, "event_type": "EXTENSION_PAYMENT",
             "amount": calc["total_payable"], "party": "user", "created_at": self.utc_now(), "meta": {"extension_id": extension_id}},
            {"ledger_id": "fl_" + uuid.uuid4().hex[:12], "booking_id": booking_id, "event_type": "EXTENSION_HOST_PAYOUT",
             "amount": calc["host_extension_payout"], "party": "host", "created_at": self.utc_now(), "meta": {"extension_id": extension_id}},
        ])

        await self.db.bookings.update_one({"booking_id": booking_id}, {"$set": {
            "end_date": payload.end_date,
            "updated_at": self.utc_now(),
        }, "$push": {"extension_ids": extension_id}})
        extension_record.pop("_id", None)
        return {"ok": True, "booking_id": booking_id, "end_date": payload.end_date, "extension": extension_record}

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

    async def price_estimate(self, vehicle: dict, plan: str, start_date: str, end_date: str) -> dict:
        """Preview-only counterpart to create_booking's real pricing: calls the
        exact same PricingEngine.calculate_booking_price used there, so a
        preview can never structurally drift from what a real booking would
        charge. Unlike create_booking, this does NOT enforce the minimum-
        notice/minimum-duration business rules as hard failures - it reports
        them (`meets_minimum_duration`, `meets_minimum_notice`) so the booking
        screen can explain an invalid selection instead of the preview call
        itself erroring out while the user is still mid-edit.

        `plan` is accepted for signature/call-site compatibility (still stored
        on the booking as a label) but no longer branches the rate math -
        every plan now resolves to the same hourly-rate x duration-hours model
        driven by the vehicle's admin-configured min/max rate range."""
        start, end = self._parse_range(start_date, end_date)
        duration_seconds = (end - start).total_seconds()
        duration_hours = max(0.0, duration_seconds / 3600)
        vehicle = await self._ensure_rate_range(vehicle)
        config_service = PricingConfigService(self.db)
        config = await config_service.get_config()
        min_booking_hours = await config_service.min_booking_hours(vehicle.get("type", "car"))
        min_notice_hours = float(config.get("min_notice_hours", self.MIN_BOOKING_LEAD_HOURS))
        lead_time_hours = max(0.0, (start - datetime.now(timezone.utc)).total_seconds() / 3600)
        estimate = PricingEngine.calculate_booking_price(
            vehicle=vehicle, duration_hours=duration_hours, lead_time_hours=lead_time_hours,
            min_booking_hours=min_booking_hours, config=config,
        )
        estimate["min_booking_hours"] = min_booking_hours
        estimate["min_notice_hours"] = min_notice_hours
        estimate["meets_minimum_duration"] = duration_hours + 1e-9 >= min_booking_hours
        estimate["meets_minimum_notice"] = lead_time_hours + 1e-9 >= min_notice_hours
        return estimate

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
