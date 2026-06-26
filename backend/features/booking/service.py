# RAIDEX_BOOKING_SERVICE
# Search tags: booking create, booking cancel, booking extend, invoice, GST invoice,
# disputes, availability conflict, booking lifecycle business rules.
import os
import uuid
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException


class BookingService:
    def __init__(self, db: Any, utc_now: Callable[[], str]):
        self.db = db
        self.utc_now = utc_now

    async def create_booking(self, payload: Any, user: dict) -> dict:
        if user.get("kyc_status") != "verified":
            raise HTTPException(status_code=403, detail="KYC verification required before booking")
        veh = await self.db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if not veh.get("available", False):
            raise HTTPException(status_code=409, detail="Vehicle is not available for booking")

        start, end = self._parse_range(payload.start_date, payload.end_date)
        duration = (end - start).total_seconds()
        if duration <= 0:
            raise HTTPException(status_code=400, detail="End date must be after start date")

        conflict = await self.db.bookings.find_one({
            "vehicle_id": payload.vehicle_id,
            "status": {"$in": ["confirmed", "active"]},
            "start_date": {"$lt": payload.end_date},
            "end_date": {"$gt": payload.start_date},
        }, {"_id": 0, "booking_id": 1, "start_date": 1, "end_date": 1})
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"Vehicle is already booked from {conflict['start_date']} to {conflict['end_date']}. Please choose different dates.",
            )

        amount = self._rental_amount(veh, payload.plan, duration)
        booking = {
            "booking_id": "bkg_" + uuid.uuid4().hex[:12],
            "user_id": user["user_id"],
            "vehicle_id": veh["vehicle_id"],
            "owner_id": veh.get("owner_id", "usr_marketplace"),
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
            "status": "pending_payment",
            "created_at": self.utc_now(),
            "odometer_start": None,
            "odometer_end": None,
            "inspection_before": [],
            "inspection_after": [],
            "add_ons": payload.add_ons,
            "payment_id": None,
        }
        await self.db.bookings.insert_one(booking)
        booking.pop("_id", None)
        return booking

    async def cancel_booking(self, booking_id: str, payload: Any, user: dict) -> dict:
        booking = await self.db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking["status"] not in ("pending_payment", "confirmed"):
            raise HTTPException(status_code=422, detail=f"Cannot cancel a {booking['status']} booking")

        refund_due = 0
        if booking.get("payment_id"):
            pay = await self.db.payments.find_one({"payment_id": booking["payment_id"], "status": "succeeded"}, {"_id": 0})
            if pay:
                refund_due = pay["amount"]

        await self.db.bookings.update_one({"booking_id": booking_id}, {"$set": {
            "status": "cancelled",
            "cancel_reason": payload.reason.strip(),
            "cancelled_at": self.utc_now(),
            "refund_due": refund_due,
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
        return {"ok": True, "status": "cancelled", "refund_due": refund_due}

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
