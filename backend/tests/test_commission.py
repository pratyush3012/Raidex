import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raidex_platform.commission import CommissionService, DEFAULT_COMMISSION_RATE
from test_critical_paths import FUTURE
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
    """A booking's host/platform split now comes from PricingEngine's
    host_payout_pct (see raidex_platform/pricing_engine.py), not
    CommissionService - that service still backs subscriptions only. The
    invariant this test actually protects - a historical financial record
    must not silently change when the live config changes later - still
    applies, just against the new config source."""
    import server
    from raidex_platform.pricing_engine import PricingConfigService

    fake_db.vehicles.docs.append({
        "vehicle_id": "veh_1", "type": "car", "name": "Nexon EV", "brand": "Tata",
        "image": "https://img", "location": "Delhi", "deposit": 5000,
        "price_per_hour": 100, "price_per_day": 1000, "available": True,
        "verification_status": "approved", "owner_id": "usr_owner_1",
    })
    payload = server.BookingCreate(
        vehicle_id="veh_1", plan="daily",
        start_date=FUTURE.isoformat(), end_date=(FUTURE + timedelta(hours=24)).isoformat(),
    )
    user = {"user_id": "usr_1", "kyc_status": "verified"}
    booking = await server.create_booking(payload, user)
    assert booking["commission_rate"] == 0.20  # 1 - default host_payout_pct (0.80)
    original_commission_amount = booking["commission_amount"]
    assert original_commission_amount > 0

    # Now the platform changes its host/platform split going forward.
    await PricingConfigService(fake_db).set_config({"host_payout_pct": 0.5}, updated_by="usr_admin", now=server.utc_now())

    stored = next(b for b in fake_db.bookings.docs if b["booking_id"] == booking["booking_id"])
    assert stored["commission_rate"] == 0.20  # unchanged - historical snapshot
    assert stored["commission_amount"] == original_commission_amount
