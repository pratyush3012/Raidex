from types import SimpleNamespace
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from features.booking import BookingService
from test_critical_paths import booking_doc
from test_quality_flows import USER, fake_db, vehicle


def service(db):
    return BookingService(db, server.utc_now)


def booking_payload(**overrides):
    data = {
        "vehicle_id": "veh_1",
        "plan": "daily",
        "start_date": "2026-07-01T00:00:00+00:00",
        "end_date": "2026-07-02T00:00:00+00:00",
        "add_ons": [],
    }
    data.update(overrides)
    return server.BookingCreate(**data)


@pytest.mark.asyncio
async def test_booking_service_create_rejects_missing_vehicle_and_unavailable_vehicle(fake_db):
    with pytest.raises(HTTPException) as missing:
        await service(fake_db).create_booking(booking_payload(), USER)
    assert missing.value.status_code == 404

    fake_db.vehicles.docs.append(vehicle(available=False))
    with pytest.raises(HTTPException) as unavailable:
        await service(fake_db).create_booking(booking_payload(), USER)
    assert unavailable.value.status_code == 409


@pytest.mark.asyncio
async def test_booking_service_create_rejects_invalid_ranges_and_conflicts(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    with pytest.raises(HTTPException) as bad_format:
        await service(fake_db).create_booking(booking_payload(start_date="bad"), USER)
    assert bad_format.value.status_code == 400

    with pytest.raises(HTTPException) as reversed_range:
        await service(fake_db).create_booking(booking_payload(end_date="2026-06-30T00:00:00+00:00"), USER)
    assert reversed_range.value.status_code == 400

    fake_db.bookings.docs.append(booking_doc(status="active"))
    with pytest.raises(HTTPException) as conflict:
        await service(fake_db).create_booking(booking_payload(), USER)
    assert conflict.value.status_code == 409


@pytest.mark.asyncio
async def test_booking_service_supports_hourly_weekly_and_monthly_pricing(fake_db):
    fake_db.vehicles.docs.extend([
        vehicle(vehicle_id="hourly", price_per_hour=50),
        vehicle(vehicle_id="weekly", price_per_week=7000),
        vehicle(vehicle_id="monthly", price_per_month=25000),
    ])

    hourly = await service(fake_db).create_booking(booking_payload(vehicle_id="hourly", plan="hourly", end_date="2026-07-01T03:00:00+00:00"), USER)
    weekly = await service(fake_db).create_booking(booking_payload(vehicle_id="weekly", plan="weekly", end_date="2026-07-09T00:00:00+00:00"), USER)
    monthly = await service(fake_db).create_booking(booking_payload(vehicle_id="monthly", plan="monthly", end_date="2026-08-10T00:00:00+00:00"), USER)

    assert hourly["total_amount"] == 150
    assert weekly["total_amount"] == 14000
    assert monthly["total_amount"] == 50000


@pytest.mark.asyncio
async def test_booking_service_cancel_handles_missing_invalid_and_refund(fake_db):
    with pytest.raises(HTTPException) as missing:
        await service(fake_db).cancel_booking("missing", SimpleNamespace(reason="none"), USER)
    assert missing.value.status_code == 404

    fake_db.bookings.docs.append(booking_doc(status="active"))
    with pytest.raises(HTTPException) as invalid_status:
        await service(fake_db).cancel_booking("bkg_1", SimpleNamespace(reason="too late"), USER)
    assert invalid_status.value.status_code == 422

    fake_db.bookings.docs[0].update({"status": "confirmed", "payment_id": "pay_1"})
    fake_db.payments.docs.append({"payment_id": "pay_1", "status": "succeeded", "amount": 1180})
    cancelled = await service(fake_db).cancel_booking("bkg_1", SimpleNamespace(reason=" changed "), USER)
    assert cancelled["refund_due"] == 1180


@pytest.mark.asyncio
async def test_booking_service_extend_rejects_missing_invalid_status_bad_date_and_conflict(fake_db):
    with pytest.raises(HTTPException) as missing:
        await service(fake_db).extend_booking("missing", SimpleNamespace(end_date="2026-07-03T00:00:00+00:00"), USER)
    assert missing.value.status_code == 404

    fake_db.bookings.docs.append(booking_doc(status="cancelled"))
    with pytest.raises(HTTPException) as invalid_status:
        await service(fake_db).extend_booking("bkg_1", SimpleNamespace(end_date="2026-07-03T00:00:00+00:00"), USER)
    assert invalid_status.value.status_code == 422

    fake_db.bookings.docs[0]["status"] = "confirmed"
    with pytest.raises(HTTPException) as bad_date:
        await service(fake_db).extend_booking("bkg_1", SimpleNamespace(end_date="bad"), USER)
    assert bad_date.value.status_code == 400

    fake_db.bookings.docs.append(booking_doc(booking_id="bkg_2", start_date="2026-07-02T12:00:00+00:00", end_date="2026-07-04T00:00:00+00:00"))
    with pytest.raises(HTTPException) as conflict:
        await service(fake_db).extend_booking("bkg_1", SimpleNamespace(end_date="2026-07-03T00:00:00+00:00"), USER)
    assert conflict.value.status_code == 409


@pytest.mark.asyncio
async def test_booking_service_invoice_and_dispute_missing_paths(fake_db):
    with pytest.raises(HTTPException) as missing_invoice:
        await service(fake_db).invoice("missing", False, USER)
    assert missing_invoice.value.status_code == 404

    with pytest.raises(HTTPException) as missing_dispute_booking:
        await service(fake_db).create_dispute(
            "bkg_1",
            server.DisputeCreateRequest(booking_id="bkg_1", category="refund", message="Refund still pending"),
            USER,
        )
    assert missing_dispute_booking.value.status_code == 404
