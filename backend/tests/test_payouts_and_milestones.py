import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from raidex_platform.commission import CommissionService
from raidex_platform.payouts import PayoutService
from raidex_platform.service_milestones import ServiceMilestoneService
from test_quality_flows import USER, fake_db, vehicle  # noqa: F401

OWNER_ID = "usr_owner_1"
ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}


def _completed_booking(**overrides):
    base = {
        "booking_id": "bkg_1", "user_id": USER["user_id"], "vehicle_id": "veh_1",
        "owner_id": OWNER_ID, "total_amount": 1000.0,
        "commission_rate": 0.40, "commission_amount": 400.0, "owner_net_amount": 600.0,
        "status": "completed",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_create_payout_for_booking_uses_snapshotted_commission(fake_db):
    payout = await PayoutService(fake_db).create_payout_for_booking(_completed_booking())
    assert payout["gross_amount"] == 1000.0
    assert payout["commission_amount"] == 400.0
    assert payout["net_amount"] == 600.0
    assert payout["status"] == "eligible"


@pytest.mark.asyncio
async def test_create_payout_is_idempotent_for_retried_completion(fake_db):
    svc = PayoutService(fake_db)
    first = await svc.create_payout_for_booking(_completed_booking())
    second = await svc.create_payout_for_booking(_completed_booking())
    assert first["payout_id"] == second["payout_id"]
    assert len(fake_db.payouts.docs) == 1


def _subscription(**overrides):
    base = {
        "subscription_id": "sub_1", "owner_id": OWNER_ID, "vehicle_id": "veh_1",
        "total_price": 20000.0, "commission_rate": 0.40, "commission_amount": 8000.0,
        "owner_net_amount": 12000.0,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_create_payout_for_subscription_payment_uses_snapshotted_commission(fake_db):
    payout = await PayoutService(fake_db).create_payout_for_subscription_payment(_subscription(), payment_id="pay_1")
    assert payout["source_type"] == "subscription"
    assert payout["booking_id"] is None
    assert payout["gross_amount"] == 20000.0
    assert payout["commission_amount"] == 8000.0
    assert payout["net_amount"] == 12000.0


@pytest.mark.asyncio
async def test_create_payout_for_subscription_payment_is_idempotent_per_payment(fake_db):
    svc = PayoutService(fake_db)
    first = await svc.create_payout_for_subscription_payment(_subscription(), payment_id="pay_1")
    second = await svc.create_payout_for_subscription_payment(_subscription(), payment_id="pay_1")
    assert first["payout_id"] == second["payout_id"]
    assert len(fake_db.payouts.docs) == 1

    # A different payment (e.g. a future renewal charge) is a genuinely new payout.
    third = await svc.create_payout_for_subscription_payment(_subscription(), payment_id="pay_2")
    assert third["payout_id"] != first["payout_id"]
    assert len(fake_db.payouts.docs) == 2


@pytest.mark.asyncio
async def test_booking_and_subscription_payouts_do_not_collide_on_booking_id(fake_db):
    """Both payout kinds coexist in the same collection with booking_id=None
    for subscription payouts - this must never trip the booking_id uniqueness
    invariant (see the partial index in server.create_indexes)."""
    svc = PayoutService(fake_db)
    await svc.create_payout_for_subscription_payment(_subscription(), payment_id="pay_1")
    await svc.create_payout_for_subscription_payment(_subscription(subscription_id="sub_2"), payment_id="pay_2")
    await svc.create_payout_for_booking(_completed_booking())
    assert len(fake_db.payouts.docs) == 3


@pytest.mark.asyncio
async def test_admin_mark_payout_paid_is_idempotent_and_audited(fake_db):
    await PayoutService(fake_db).create_payout_for_booking(_completed_booking())
    payout = fake_db.payouts.docs[0]

    result = await server.admin_mark_payout_paid(
        payout["payout_id"], server.PayoutMarkPaidRequest(payment_reference="txn_123"), ADMIN,
    )
    assert result["status"] == "paid"
    assert result["payment_reference"] == "txn_123"
    assert any(a["action"] == "payout.mark_paid" for a in fake_db.audit_log.docs)

    # Marking paid again must not error or duplicate audit weirdly - it's a no-op.
    again = await server.admin_mark_payout_paid(
        payout["payout_id"], server.PayoutMarkPaidRequest(payment_reference="txn_999"), ADMIN,
    )
    assert again["payment_reference"] == "txn_123"  # unchanged, first reference wins


@pytest.mark.asyncio
async def test_milestone_crossing_awards_benefit_exactly_once(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id=OWNER_ID, lifetime_km=9990))
    svc = ServiceMilestoneService(fake_db)

    # Crosses 10,000 km threshold.
    fake_db.vehicles.docs[0]["lifetime_km"] = 10050
    first = await svc.check_and_award("veh_1")
    assert len(first) == 1
    assert first[0]["milestone_km"] == 10000

    # A retried call at the same mileage must not re-award.
    second = await svc.check_and_award("veh_1")
    assert second == []
    assert len(fake_db.service_benefits.docs) == 1


@pytest.mark.asyncio
async def test_milestone_thresholds_are_configurable(fake_db):
    svc = ServiceMilestoneService(fake_db)
    await svc.set_thresholds([100, 200], updated_by="usr_admin")
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id=OWNER_ID, lifetime_km=150))
    events = await svc.check_and_award("veh_1")
    assert [e["milestone_km"] for e in events] == [100]


@pytest.mark.asyncio
async def test_end_trip_creates_payout_and_returns_it(fake_db, monkeypatch):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id=OWNER_ID, price_per_day=1000))
    fake_db.bookings.docs.append({
        "booking_id": "bkg_1", "user_id": USER["user_id"], "vehicle_id": "veh_1", "owner_id": OWNER_ID,
        "status": "active", "odometer_start": 100, "total_amount": 1000.0,
        "commission_rate": 0.40, "commission_amount": 400.0, "owner_net_amount": 600.0,
    })
    fake_db.inspections.docs.append({
        "inspection_id": "insp_1", "booking_id": "bkg_1", "phase": "after", "odometer_value": 350,
    })

    result = await server.end_trip("bkg_1", USER)
    assert result["status"] == "completed"
    assert result["miles_earned"] == 250
    assert "payout_id" in result

    payout = fake_db.payouts.docs[0]
    assert payout["booking_id"] == "bkg_1"
    assert payout["net_amount"] == 600.0
