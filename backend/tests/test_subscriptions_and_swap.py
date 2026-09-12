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
from raidex_platform.commission import CommissionService
from raidex_platform.subscriptions import SubscriptionService
from raidex_platform.vehicle_swap import VehicleSwapService
from test_quality_flows import USER, Gateway, fake_db, vehicle  # noqa: F401

OWNER_ID = "usr_owner_1"


def _enable_flag(fake_db, flag: str, **extra):
    fake_db.feature_flags.docs.append({"flag": flag, "enabled": True, **extra})


# ---------------------------------------------------------------- SubscriptionService

@pytest.mark.asyncio
async def test_quote_computes_total_and_included_km(fake_db):
    svc = SubscriptionService(fake_db)
    q = await svc.quote(vehicle(price_per_month=9000), duration_months=3)
    assert q["total_price"] == 27000
    assert q["included_km"] == 3000  # 1000km/month default
    assert q["excess_km_rate"] > 0


@pytest.mark.asyncio
async def test_create_subscription_rejects_unavailable_vehicle(fake_db):
    svc = SubscriptionService(fake_db)
    with pytest.raises(HTTPException) as exc:
        await svc.create_subscription(user=USER, vehicle=vehicle(available=False), duration_months=1)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_create_subscription_rejects_when_vehicle_already_booked(fake_db):
    fake_db.bookings.docs.append({"vehicle_id": "veh_1", "status": "confirmed", "booking_id": "bkg_1"})
    svc = SubscriptionService(fake_db)
    with pytest.raises(HTTPException) as exc:
        await svc.create_subscription(user=USER, vehicle=vehicle(), duration_months=1)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_create_subscription_snapshots_commission_and_stays_pending(fake_db):
    fake_db.platform_config.docs.append({"config_id": "commission", "default_rate": 0.40})
    svc = SubscriptionService(fake_db, commission_service=CommissionService(fake_db))
    sub = await svc.create_subscription(
        user=USER, vehicle=vehicle(owner_id=OWNER_ID, price_per_month=10000), duration_months=2,
    )
    assert sub["status"] == "pending_payment"
    assert sub["total_price"] == 20000
    assert sub["commission_amount"] == 8000
    assert sub["owner_net_amount"] == 12000


@pytest.mark.asyncio
async def test_activate_is_idempotent_and_marks_vehicle_unavailable(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    svc = SubscriptionService(fake_db)
    sub = await svc.create_subscription(user=USER, vehicle=vehicle(), duration_months=1)

    first = await svc.activate(sub["subscription_id"], payment_id="pay_1")
    assert first["status"] == "active"
    assert fake_db.vehicles.docs[0]["available"] is False

    # A retried payment-confirm webhook must not re-activate or double-charge state.
    second = await svc.activate(sub["subscription_id"], payment_id="pay_2")
    assert second["payment_id"] == "pay_1"


@pytest.mark.asyncio
async def test_record_usage_computes_excess_amount_due(fake_db):
    svc = SubscriptionService(fake_db)
    sub = await svc.create_subscription(user=USER, vehicle=vehicle(), duration_months=1)  # included_km = 1000
    await svc.activate(sub["subscription_id"], payment_id="pay_1")

    await svc.record_usage(sub["subscription_id"], odometer_reading=500)  # baseline, no delta yet
    updated = await svc.record_usage(sub["subscription_id"], odometer_reading=1700)  # +1200 km used
    assert updated["used_km"] == 1200
    assert updated["excess_amount_due"] == round(200 * 5.0, 2)  # 200km over the 1000km allowance


@pytest.mark.asyncio
async def test_cancel_releases_vehicle_and_rejects_double_cancel(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    svc = SubscriptionService(fake_db)
    sub = await svc.create_subscription(user=USER, vehicle=fake_db.vehicles.docs[0], duration_months=1)
    await svc.activate(sub["subscription_id"], payment_id="pay_1")

    cancelled = await svc.cancel(sub["subscription_id"], user_id=USER["user_id"], reason="No longer needed")
    assert cancelled["status"] == "cancelled"
    assert fake_db.vehicles.docs[0]["available"] is True

    with pytest.raises(HTTPException) as exc:
        await svc.cancel(sub["subscription_id"], user_id=USER["user_id"], reason="again")
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_renewal_quote_endpoint_requires_active_or_expired_subscription(fake_db):
    fake_db.subscriptions.docs.append({
        "subscription_id": "sub_1", "user_id": USER["user_id"], "status": "pending_payment",
        "monthly_price": 10000, "duration_months": 1,
    })
    with pytest.raises(HTTPException) as exc:
        await server.subscription_renewal_quote("sub_1", None, USER)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_renewal_quote_uses_the_subscriptions_locked_in_rate(fake_db):
    fake_db.subscriptions.docs.append({
        "subscription_id": "sub_1", "user_id": USER["user_id"], "status": "active",
        "monthly_price": 10000, "duration_months": 1,
    })
    quote = await server.subscription_renewal_quote("sub_1", 3, USER)
    assert quote["total_price"] == 30000


@pytest.mark.asyncio
async def test_payments_create_rejects_underpaying_a_renewal(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.subscriptions.docs.append({
        "subscription_id": "sub_1", "user_id": USER["user_id"], "status": "active",
        "monthly_price": 10000, "duration_months": 1,
    })
    with pytest.raises(HTTPException) as exc:
        await server.payments_create(
            server.PaymentCreateRequest(subscription_id="sub_1", amount=1, purpose="subscription_renewal"), USER,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_renewal_payment_confirm_extends_subscription_and_creates_a_payout(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.platform_config.docs.append({"config_id": "commission", "default_rate": 0.40})
    fake_db.vehicles.docs.append(vehicle(owner_id=OWNER_ID, available=False))
    fake_db.subscriptions.docs.append({
        "subscription_id": "sub_1", "user_id": USER["user_id"], "owner_id": OWNER_ID, "vehicle_id": "veh_1",
        "vehicle_snapshot": {"name": "Nexon EV", "type": "car"}, "status": "active",
        "monthly_price": 10000, "duration_months": 1, "total_price": 10000,
        "commission_rate": 0.40, "commission_amount": 4000, "owner_net_amount": 6000,
        "end_date": "2026-01-01T00:00:00+00:00", "included_km": 1000, "used_km": 800,
    })

    quote = await server.subscription_renewal_quote("sub_1", None, USER)
    payment = await server.payments_create(
        server.PaymentCreateRequest(subscription_id="sub_1", amount=quote["total_price"], purpose="subscription_renewal"),
        USER,
    )
    confirmed = await server.payments_confirm(payment["payment_id"], server.PaymentConfirmRequest(force_outcome="success"), USER)
    assert confirmed["status"] == "succeeded"

    updated = await fake_db.subscriptions.find_one({"subscription_id": "sub_1"}, {"_id": 0})
    assert updated["end_date"] > "2026-01-01T00:00:00+00:00"
    assert updated["used_km"] == 0.0  # reset for the new cycle

    payout = await fake_db.payouts.find_one({"payment_id": payment["payment_id"]}, {"_id": 0})
    assert payout is not None
    assert payout["source_type"] == "subscription"
    assert payout["gross_amount"] == 10000
    assert payout["net_amount"] == 6000


@pytest.mark.asyncio
async def test_renew_extends_end_date_and_resets_usage(fake_db):
    svc = SubscriptionService(fake_db)
    sub = await svc.create_subscription(user=USER, vehicle=vehicle(), duration_months=1)
    active = await svc.activate(sub["subscription_id"], payment_id="pay_1")
    await svc.record_usage(sub["subscription_id"], odometer_reading=100)
    await svc.record_usage(sub["subscription_id"], odometer_reading=600)

    renewed = await svc.renew(sub["subscription_id"], user_id=USER["user_id"])
    assert renewed["end_date"] > active["end_date"]
    assert renewed["used_km"] == 0.0


# ---------------------------------------------------------------- payments -> subscription activation

@pytest.mark.asyncio
async def test_payments_confirm_activates_subscription(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.vehicles.docs.append(vehicle())
    _enable_flag(fake_db, "subscriptions")

    sub = await server.create_subscription(server.SubscriptionCreateRequest(vehicle_id="veh_1", duration_months=1), USER)
    payment = await server.payments_create(
        server.PaymentCreateRequest(subscription_id=sub["subscription_id"], amount=sub["total_price"], purpose="subscription"),
        USER,
    )
    confirmed = await server.payments_confirm(payment["payment_id"], server.PaymentConfirmRequest(force_outcome="success"), USER)
    assert confirmed["status"] == "succeeded"

    stored = await fake_db.subscriptions.find_one({"subscription_id": sub["subscription_id"]}, {"_id": 0})
    assert stored["status"] == "active"
    assert fake_db.vehicles.docs[0]["available"] is False


@pytest.mark.asyncio
async def test_payments_confirm_creates_a_payout_for_the_owner(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.platform_config.docs.append({"config_id": "commission", "default_rate": 0.40})
    fake_db.vehicles.docs.append(vehicle(owner_id=OWNER_ID, price_per_month=10000))
    _enable_flag(fake_db, "subscriptions")

    sub = await server.create_subscription(server.SubscriptionCreateRequest(vehicle_id="veh_1", duration_months=1), USER)
    payment = await server.payments_create(
        server.PaymentCreateRequest(subscription_id=sub["subscription_id"], amount=sub["total_price"], purpose="subscription"),
        USER,
    )
    await server.payments_confirm(payment["payment_id"], server.PaymentConfirmRequest(force_outcome="success"), USER)

    payout = await fake_db.payouts.find_one({"payment_id": payment["payment_id"]}, {"_id": 0})
    assert payout is not None
    assert payout["source_type"] == "subscription"
    assert payout["owner_id"] == OWNER_ID
    assert payout["gross_amount"] == 10000
    assert payout["commission_amount"] == 4000
    assert payout["net_amount"] == 6000

    # A retried confirm/webhook must not create a second payout for the same payment.
    again = await server.payments_confirm(payment["payment_id"], server.PaymentConfirmRequest(force_outcome="success"), USER)
    assert again["status"] == "succeeded"
    assert len([p for p in fake_db.payouts.docs if p["payment_id"] == payment["payment_id"]]) == 1


@pytest.mark.asyncio
async def test_payments_create_rejects_underpaying_a_subscription(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.vehicles.docs.append(vehicle())
    _enable_flag(fake_db, "subscriptions")
    sub = await server.create_subscription(server.SubscriptionCreateRequest(vehicle_id="veh_1", duration_months=1), USER)

    with pytest.raises(HTTPException) as exc:
        await server.payments_create(
            server.PaymentCreateRequest(subscription_id=sub["subscription_id"], amount=1, purpose="subscription"), USER,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_subscription_creation_blocked_when_feature_flag_disabled(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    with pytest.raises(HTTPException) as exc:
        await server.create_subscription(server.SubscriptionCreateRequest(vehicle_id="veh_1", duration_months=1), USER)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------- VehicleSwapService

def _active_subscription(**overrides):
    base = {
        "subscription_id": "sub_1", "user_id": USER["user_id"], "vehicle_id": "veh_old", "owner_id": OWNER_ID,
        "vehicle_snapshot": {"name": "Old Car", "type": "car"}, "monthly_price": 10000,
        "status": "active", "included_swaps": 1, "swaps_used": 0,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_quote_fee_is_free_within_included_swaps_same_category(fake_db):
    sub = _active_subscription()
    new_vehicle = vehicle(vehicle_id="veh_new", type="car", price_per_month=10000)
    quote = VehicleSwapService(fake_db).quote_fee(
        old_monthly_price=sub["monthly_price"], old_category=sub["vehicle_snapshot"]["type"],
        new_vehicle=new_vehicle, subscription=sub,
    )
    assert quote["fee_amount"] == 0.0
    assert quote["included_swap"] is True


@pytest.mark.asyncio
async def test_quote_fee_charges_upgrade_difference_across_categories(fake_db):
    sub = _active_subscription()
    new_vehicle = vehicle(vehicle_id="veh_new", type="suv", price_per_month=15000)
    quote = VehicleSwapService(fake_db).quote_fee(
        old_monthly_price=sub["monthly_price"], old_category=sub["vehicle_snapshot"]["type"],
        new_vehicle=new_vehicle, subscription=sub,
    )
    assert quote["fee_amount"] == 5000.0


@pytest.mark.asyncio
async def test_create_swap_auto_completes_and_transfers_vehicle_allocation(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_old", available=False))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_new", available=True))
    fake_db.subscriptions.docs.append(_active_subscription())

    swap_service = VehicleSwapService(fake_db)
    sub = fake_db.subscriptions.docs[0]
    new_vehicle = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_new")

    swap = await swap_service.create_swap(subscription=sub, new_vehicle=new_vehicle, user_id=USER["user_id"])
    assert swap["status"] == "completed"

    old_vehicle = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_old")
    assert old_vehicle["available"] is True
    assert new_vehicle["available"] is False

    updated_sub = await fake_db.subscriptions.find_one({"subscription_id": "sub_1"}, {"_id": 0})
    assert updated_sub["vehicle_id"] == "veh_new"
    assert updated_sub["swaps_used"] == 1


@pytest.mark.asyncio
async def test_create_swap_rejects_target_vehicle_already_allocated(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_old", available=False))
    new_vehicle = vehicle(vehicle_id="veh_new", available=True)
    fake_db.vehicles.docs.append(new_vehicle)
    fake_db.bookings.docs.append({"vehicle_id": "veh_new", "status": "active", "booking_id": "bkg_1"})
    sub = _active_subscription()

    with pytest.raises(HTTPException) as exc:
        await VehicleSwapService(fake_db).create_swap(subscription=sub, new_vehicle=new_vehicle, user_id=USER["user_id"])
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_complete_swap_is_idempotent(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_old", available=False))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_new", available=True))
    fake_db.subscriptions.docs.append(_active_subscription())
    swap_service = VehicleSwapService(fake_db)
    sub = fake_db.subscriptions.docs[0]
    new_vehicle = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_new")

    swap = await swap_service.create_swap(subscription=sub, new_vehicle=new_vehicle, user_id=USER["user_id"])
    again = await swap_service.complete_swap(swap["swap_id"])
    assert again == swap
    # swaps_used must not have been incremented twice
    updated_sub = await fake_db.subscriptions.find_one({"subscription_id": "sub_1"}, {"_id": 0})
    assert updated_sub["swaps_used"] == 1


@pytest.mark.asyncio
async def test_complete_swap_rejects_if_new_vehicle_lost_availability_meanwhile(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_old", available=False))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_new", available=True))
    fake_db.subscriptions.docs.append(_active_subscription())
    swap_service = VehicleSwapService(fake_db)
    sub = fake_db.subscriptions.docs[0]
    new_vehicle = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_new")

    # Simulate the vehicle being claimed by something else between the
    # eligibility check and the commit (e.g. a racing booking/swap).
    swap = await swap_service.create_swap(subscription=sub, new_vehicle=dict(new_vehicle), user_id=USER["user_id"], auto_complete=False)
    new_vehicle["available"] = False

    with pytest.raises(HTTPException) as exc:
        await swap_service.complete_swap(swap["swap_id"])
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_swap_requires_approval_when_flag_enabled(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_old", available=False))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_new", available=True))
    fake_db.subscriptions.docs.append(_active_subscription())
    _enable_flag(fake_db, "vehicle_swap")
    _enable_flag(fake_db, "vehicle_swap_requires_approval")

    swap = await server.create_swap(
        "sub_1", server.SwapCreateRequest(new_vehicle_id="veh_new"), USER,
    )
    assert swap["status"] == "requested"
    # Vehicle allocation must not change until an admin approves the swap.
    old_vehicle = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_old")
    assert old_vehicle["available"] is False

    admin = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}
    approved = await server.admin_approve_swap(swap["swap_id"], admin)
    assert approved["status"] == "completed"
