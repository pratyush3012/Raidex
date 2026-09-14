from types import SimpleNamespace
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from features.booking import BookingService
from test_critical_paths import FUTURE, booking_doc
from test_quality_flows import USER, fake_db, vehicle


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def service(db):
    return BookingService(db, server.utc_now)


def booking_payload(**overrides):
    data = {
        "vehicle_id": "veh_1",
        "plan": "daily",
        "start_date": _iso(FUTURE),
        "end_date": _iso(FUTURE + timedelta(days=1)),
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
        await service(fake_db).create_booking(booking_payload(end_date=_iso(FUTURE - timedelta(days=1))), USER)
    assert reversed_range.value.status_code == 400

    fake_db.bookings.docs.append(booking_doc(status="active"))
    with pytest.raises(HTTPException) as conflict:
        await service(fake_db).create_booking(booking_payload(), USER)
    assert conflict.value.status_code == 409


@pytest.mark.asyncio
async def test_booking_service_create_serializes_concurrent_overlapping_requests(fake_db):
    """Two genuinely concurrent create_booking calls (run via asyncio.gather,
    not sequentially) for overlapping date ranges on the SAME vehicle must
    never both succeed. A MongoDB transaction around the conflict-check-then-
    insert does NOT protect against this on its own: overlapping-but-distinct
    bookings are separate documents, so Mongo's write-conflict detection has
    nothing to catch - the fix is the per-vehicle lock in
    BookingService._acquire_vehicle_lock. This test exercises real
    interleaving (the fake DB's collection methods each contain a genuine
    `await asyncio.sleep(0)`, simulating network latency) so it would catch a
    regression back to relying on the transaction alone."""
    fake_db.vehicles.docs.append(vehicle())
    svc = service(fake_db)

    async def attempt(start_date, end_date):
        try:
            booking = await svc.create_booking(
                booking_payload(start_date=start_date, end_date=end_date), USER,
            )
            return ("ok", booking)
        except HTTPException as exc:
            return ("error", exc.status_code)

    results = await asyncio.gather(
        attempt(_iso(FUTURE), _iso(FUTURE + timedelta(days=2))),
        attempt(_iso(FUTURE + timedelta(days=1)), _iso(FUTURE + timedelta(days=3))),
    )

    outcomes = [outcome for outcome, _ in results]
    assert outcomes.count("ok") == 1, f"expected exactly one successful booking, got {results}"
    assert outcomes.count("error") == 1, f"expected exactly one rejected request, got {results}"
    rejected_status = next(status for outcome, status in results if outcome == "error")
    assert rejected_status == 409

    # No silent double-booking: only one booking document actually landed.
    assert len(fake_db.bookings.docs) == 1


@pytest.mark.asyncio
async def test_booking_service_prices_short_and_long_bookings_within_vehicle_range(fake_db):
    """The pricing model is no longer "plan picks a flat rate table" - every
    booking (regardless of the `plan` label, kept only for display) is priced
    by PricingEngine from the vehicle's admin-configured min/max hourly rate
    and how long/how far in advance the trip is. A short (near-minimum-
    duration) booking should land near MAX_RATE; a long one should land at or
    near MIN_RATE; the rate must never leave [min, max] either way."""
    fake_db.vehicles.docs.extend([
        vehicle(vehicle_id="short", min_hourly_rate=80.0, max_hourly_rate=110.0),
        vehicle(vehicle_id="long", min_hourly_rate=80.0, max_hourly_rate=110.0),
    ])

    # Exactly the minimum bookable duration for a car (6h) AND short notice
    # (just past the 2h minimum) - both factors should push toward MAX_RATE.
    # `FUTURE` (30 days out) is deliberately NOT used here: at that much lead
    # time the lead-time factor alone would push toward MIN_RATE regardless
    # of how short the duration is, which is correct engine behavior but
    # would confound this specific assertion.
    short_start = datetime.now(timezone.utc) + timedelta(hours=3)
    short = await service(fake_db).create_booking(
        booking_payload(vehicle_id="short", plan="hourly", start_date=_iso(short_start), end_date=_iso(short_start + timedelta(hours=6))), USER,
    )
    # Well past the default long-duration AND long-lead-time thresholds -
    # both factors should push toward MIN_RATE.
    long = await service(fake_db).create_booking(
        booking_payload(vehicle_id="long", plan="daily", end_date=_iso(FUTURE + timedelta(hours=72))), USER,
    )

    assert short["pricing_breakdown"]["calculated_hourly_rate"] == pytest.approx(110.0, abs=1.0)
    assert short["total_amount"] == pytest.approx(short["pricing_breakdown"]["calculated_hourly_rate"] * 6, abs=1.0)

    assert long["pricing_breakdown"]["calculated_hourly_rate"] == pytest.approx(80.0, abs=0.5)
    assert long["total_amount"] == pytest.approx(80.0 * 72, abs=5.0)

    for booking in (short, long):
        rate = booking["pricing_breakdown"]["calculated_hourly_rate"]
        assert 80.0 <= rate <= 110.0


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

    fake_db.bookings.docs.append(booking_doc(
        booking_id="bkg_2",
        start_date=_iso(FUTURE + timedelta(days=2)),
        end_date=_iso(FUTURE + timedelta(days=4)),
    ))
    with pytest.raises(HTTPException) as conflict:
        await service(fake_db).extend_booking("bkg_1", SimpleNamespace(end_date=_iso(FUTURE + timedelta(days=3))), USER)
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
