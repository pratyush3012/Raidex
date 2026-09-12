import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raidex_platform.commission import CommissionService, DEFAULT_COMMISSION_RATE
from test_quality_flows import fake_db  # noqa: F401 (fixture)


@pytest.mark.asyncio
async def test_default_rate_is_business_target_when_unconfigured(fake_db):
    svc = CommissionService(fake_db)
    rate = await svc.get_rate()
    assert rate == DEFAULT_COMMISSION_RATE == 0.40


@pytest.mark.asyncio
async def test_calculate_splits_gross_deterministically(fake_db):
    svc = CommissionService(fake_db)
    result = await svc.calculate(1000.0)
    assert result["gross_amount"] == 1000.0
    assert result["commission_rate"] == 0.40
    assert result["commission_amount"] == 400.0
    assert result["net_amount"] == 600.0


@pytest.mark.asyncio
async def test_admin_can_change_default_rate(fake_db):
    svc = CommissionService(fake_db)
    updated = await svc.set_config(default_rate=0.25, updated_by="usr_admin", now="2026-01-01T00:00:00Z")
    assert updated["default_rate"] == 0.25
    assert (await svc.get_rate()) == 0.25


@pytest.mark.asyncio
async def test_owner_override_takes_precedence_over_default_and_category(fake_db):
    svc = CommissionService(fake_db)
    await svc.set_config(
        default_rate=0.40,
        category_overrides={"bike": 0.30},
        owner_overrides={"usr_owner_1": 0.20},
        updated_by="usr_admin",
        now="2026-01-01T00:00:00Z",
    )
    assert await svc.get_rate(vehicle_category="bike", owner_id="usr_owner_1") == 0.20
    assert await svc.get_rate(vehicle_category="bike") == 0.30
    assert await svc.get_rate() == 0.40


@pytest.mark.asyncio
async def test_historical_booking_commission_survives_later_config_change(fake_db):
    import server

    fake_db.vehicles.docs.append({
        "vehicle_id": "veh_1", "type": "car", "name": "Nexon EV", "brand": "Tata",
        "image": "https://img", "location": "Delhi", "deposit": 5000,
        "price_per_day": 1000, "available": True, "verification_status": "approved", "owner_id": "usr_owner_1",
    })
    payload = server.BookingCreate(
        vehicle_id="veh_1", plan="daily",
        start_date="2026-07-01T00:00:00+00:00", end_date="2026-07-02T00:00:00+00:00",
    )
    user = {"user_id": "usr_1", "kyc_status": "verified"}
    booking = await server.create_booking(payload, user)
    assert booking["commission_rate"] == 0.40
    assert booking["commission_amount"] == 400.0

    # Now the platform changes its commission rate going forward.
    await CommissionService(fake_db).set_config(default_rate=0.10, updated_by="usr_admin", now=server.utc_now())

    stored = next(b for b in fake_db.bookings.docs if b["booking_id"] == booking["booking_id"])
    assert stored["commission_rate"] == 0.40  # unchanged - historical snapshot
    assert stored["commission_amount"] == 400.0
