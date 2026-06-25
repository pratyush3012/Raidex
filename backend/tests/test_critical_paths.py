from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import server
from providers.kyc_provider import KYCResult
from test_quality_flows import DB, USER, Gateway, fake_db, vehicle


ADMIN = {**USER, "user_id": "admin_1", "email": "admin@example.com", "role": "admin"}


def booking_doc(**overrides):
    doc = {
        "booking_id": "bkg_1",
        "user_id": USER["user_id"],
        "vehicle_id": "veh_1",
        "owner_id": "owner_1",
        "vehicle_snapshot": {"name": "Nexon EV", "image": "https://img", "type": "car", "brand": "Tata", "location": "Delhi"},
        "plan": "daily",
        "start_date": "2026-07-01T00:00:00+00:00",
        "end_date": "2026-07-02T00:00:00+00:00",
        "total_amount": 1180,
        "deposit": 5000,
        "status": "confirmed",
        "payment_id": None,
        "created_at": server.utc_now(),
    }
    doc.update(overrides)
    return doc


def test_route_rejects_missing_auth(fake_db):
    client = TestClient(server.app, raise_server_exceptions=False)
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/bookings", json={}).status_code == 401
    assert client.post("/api/admin/vehicles/veh_1/approve").status_code == 401


def test_route_validation_failure_returns_422(fake_db):
    token = server.create_token(USER["user_id"], USER["email"])
    client = TestClient(server.app, raise_server_exceptions=False)
    res = client.post(
        "/api/bookings",
        json={"vehicle_id": "veh_1", "plan": "yearly", "start_date": "bad", "end_date": "bad"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_auth_success_failure_validation_unauthorized_and_network(fake_db, monkeypatch):
    client = TestClient(server.app, raise_server_exceptions=False)
    created = client.post("/api/auth/register", json={"email": "new@example.com", "password": "secret1", "name": "New User"})
    assert created.status_code == 200
    assert created.json()["user"]["email"] == "new@example.com"

    login = client.post("/api/auth/login", json={"email": "new@example.com", "password": "secret1"})
    assert login.status_code == 200
    assert login.json()["user"]["email"] == "new@example.com"

    wrong_password = client.post("/api/auth/login", json={"email": "new@example.com", "password": "wrong1"})
    assert wrong_password.status_code == 400

    bad_payload = client.post("/api/auth/register", json={"email": "not-email", "password": "123", "name": ""})
    assert bad_payload.status_code == 422

    with pytest.raises(HTTPException) as missing_auth:
        await server.get_current_user(None)
    assert missing_auth.value.status_code == 401

    async def provider_down(*_args, **_kwargs):
        raise RuntimeError("oauth provider down")

    class DownClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        get = provider_down

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: DownClient())
    assert client.post("/api/auth/google/session", json={"session_id": "sid_down"}).status_code == 500


@pytest.mark.asyncio
async def test_kyc_success_failure_validation_unauthorized_and_provider_failure(fake_db, monkeypatch):
    payload = server.KYCSubmitRequest(
        aadhaar_front="https://cdn/a-front.jpg",
        aadhaar_back="https://cdn/a-back.jpg",
        aadhaar_last4="1234",
        dl_front="https://cdn/dl-front.jpg",
        dl_back="https://cdn/dl-back.jpg",
        dl_number="DL1234567",
        face_selfie="https://cdn/selfie.jpg",
    )
    monkeypatch.setattr(server.asyncio, "create_task", lambda coro: coro.close())
    submitted = await server.kyc_submit(payload, USER)
    assert submitted["status"] == "processing"
    assert fake_db.users.docs[0]["kyc_status"] == "submitted"

    fake_db.kyc_submissions.docs[0]["status"] = "verified"
    assert (await server.kyc_status({**USER, "kyc_status": "verified"}))["kyc_status"] == "verified"

    with pytest.raises(ValidationError):
        server.KYCSubmitRequest(aadhaar_front="", aadhaar_back="", aadhaar_last4="", dl_front="", dl_back="", dl_number="", face_selfie="")

    class FailingKYC:
        name = "failing"

        async def verify(self, _submission):
            raise RuntimeError("kyc provider down")

    monkeypatch.setattr(server, "get_kyc_provider", lambda: FailingKYC())
    await server._run_kyc_verification(fake_db.kyc_submissions.docs[0]["kyc_id"], USER["user_id"], fake_db.kyc_submissions.docs[0])
    assert fake_db.kyc_submissions.docs[0]["status"] == "rejected"


@pytest.mark.asyncio
async def test_vehicle_discovery_success_failure_validation_and_unauthorized(fake_db):
    fake_db.vehicles.docs.extend([
        vehicle(vehicle_id="veh_1", name="Nexon EV", price_per_day=1000, distance_km=2, rating=4.8, fuel_type="EV"),
        vehicle(vehicle_id="veh_2", type="bike", name="Duke 390", price_per_day=1400, distance_km=8, rating=4.4, fuel_type="Petrol"),
    ])
    found = await server.list_vehicles(q="Nexon", max_price=1200, max_distance=5, sort="price", user=USER)
    assert [v["vehicle_id"] for v in found] == ["veh_1"]
    assert found[0]["trust_score"] >= 70

    with pytest.raises(HTTPException) as missing:
        await server.get_vehicle("veh_missing", USER)
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as bad_dates:
        await server.vehicle_availability("veh_1", "2026-07-02T00:00:00+00:00", "2026-07-01T00:00:00+00:00", USER)
    assert bad_dates.value.status_code == 400


@pytest.mark.asyncio
async def test_booking_create_extension_cancellation_invoice_and_dispute_edges(fake_db):
    fake_db.vehicles.docs.append(vehicle(price_per_day=1200))
    created = await server.create_booking(server.BookingCreate(
        vehicle_id="veh_1", plan="daily",
        start_date="2026-07-01T00:00:00+00:00",
        end_date="2026-07-02T00:00:00+00:00",
    ), USER)
    assert created["status"] == "pending_payment"

    booking_id = created["booking_id"]
    fake_db.bookings.docs[0]["status"] = "confirmed"
    extended = await server.extend_booking(booking_id, server.BookingExtendRequest(end_date="2026-07-03T00:00:00+00:00"), USER)
    assert extended["extension_amount_due"] == 1200

    with pytest.raises(HTTPException) as bad_extend:
        await server.extend_booking(booking_id, server.BookingExtendRequest(end_date="2026-07-01T00:00:00+00:00"), USER)
    assert bad_extend.value.status_code == 400

    invoice = await server.booking_invoice(booking_id, gst=False, user=USER)
    gst_invoice = await server.booking_invoice(booking_id, gst=True, user=USER)
    assert invoice["gst_invoice"] is False
    assert gst_invoice["gst_invoice"] is True

    dispute = await server.create_dispute(booking_id, server.DisputeCreateRequest(booking_id=booking_id, category="refund", message="Refund has not arrived"), USER)
    assert dispute["status"] == "open"

    cancelled = await server.cancel_booking(booking_id, server.BookingCancelRequest(reason="Plan changed"), USER)
    assert cancelled["status"] == "cancelled"

    with pytest.raises(HTTPException) as cancel_again:
        await server.cancel_booking(booking_id, server.BookingCancelRequest(reason="again"), USER)
    assert cancel_again.value.status_code == 422


@pytest.mark.asyncio
async def test_payment_success_failure_validation_unauthorized_and_gateway_failure(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.bookings.docs.append(booking_doc(status="pending_payment"))
    payment = await server.payments_create(server.PaymentCreateRequest(booking_id="bkg_1", amount=1180, purpose="booking", idempotency_key="paykey"), USER)
    assert payment["status"] == "created"

    confirmed = await server.payments_confirm(payment["payment_id"], server.PaymentConfirmRequest(force_outcome="success"), USER)
    assert confirmed["status"] == "succeeded"
    assert fake_db.bookings.docs[0]["status"] == "confirmed"

    with pytest.raises(HTTPException) as invalid_amount:
        await server.payments_create(server.PaymentCreateRequest(amount=0, purpose="wallet_topup"), USER)
    assert invalid_amount.value.status_code == 400

    with pytest.raises(HTTPException) as not_owner:
        await server.payments_get(payment["payment_id"], {**USER, "user_id": "other"})
    assert not_owner.value.status_code == 404

    class DownGateway(Gateway):
        async def create_order(self, *, amount, currency, meta):
            raise RuntimeError("payment gateway down")

    monkeypatch.setattr(server, "get_payment_gateway", lambda: DownGateway())
    with pytest.raises(RuntimeError):
        await server.payments_create(server.PaymentCreateRequest(amount=500, purpose="wallet_topup"), USER)


@pytest.mark.asyncio
async def test_reviews_wishlist_referrals_and_coupons_edges(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    fake_db.bookings.docs.append(booking_doc(status="completed"))
    review = await server.create_vehicle_review("veh_1", server.ReviewCreate(booking_id="bkg_1", rating=5, comment="Clean and easy"), USER)
    assert review["rating"] == 5

    with pytest.raises(HTTPException) as duplicate_review:
        await server.create_vehicle_review("veh_1", server.ReviewCreate(booking_id="bkg_1", rating=4, comment="Again"), USER)
    assert duplicate_review.value.status_code == 409

    await server.add_wishlist("veh_1", USER)
    assert (await server.get_wishlist(USER))[0]["vehicle_id"] == "veh_1"
    await server.remove_wishlist("veh_1", USER)
    assert await server.get_wishlist(USER) == []

    referral = await server.create_referral(server.ReferralCreateRequest(referred_email="friend@example.com"), USER)
    assert referral["status"] == "invited"
    with pytest.raises(HTTPException):
        await server.create_referral(server.ReferralCreateRequest(referred_email=USER["email"]), USER)

    assert (await server.validate_coupon(server.CouponValidateRequest(code="FIRST100", amount=250)))["payable"] == 150
    with pytest.raises(HTTPException) as bad_coupon:
        await server.validate_coupon(server.CouponValidateRequest(code="NOPE", amount=250), USER)
    assert bad_coupon.value.status_code == 404


@pytest.mark.asyncio
async def test_admin_approval_actions_success_failure_validation_and_unauthorized(fake_db):
    fake_db.users.docs.append(ADMIN)
    fake_db.vehicles.docs.append(vehicle(verification_status="pending", available=False))
    fake_db.kyc_submissions.docs.append({"kyc_id": "kyc_1", "user_id": USER["user_id"], "status": "submitted", "submitted_at": server.utc_now()})
    fake_db.disputes.docs.append({"dispute_id": "dsp_1", "status": "open", "created_at": server.utc_now()})

    assert (await server.admin_approve_vehicle("veh_1", ADMIN))["ok"] is True
    assert fake_db.vehicles.docs[0]["verification_status"] == "approved"

    assert (await server.admin_approve_kyc("kyc_1", ADMIN))["ok"] is True
    assert fake_db.users.docs[0]["kyc_status"] == "verified"

    updated = await server.admin_update_dispute("dsp_1", {"status": "resolved", "resolution": "Refund released"}, ADMIN)
    assert updated["status"] == "resolved"

    with pytest.raises(HTTPException) as not_admin:
        await server.admin_approve_vehicle("veh_1", USER)
    assert not_admin.value.status_code == 403

    with pytest.raises(HTTPException) as bad_status:
        await server.admin_update_dispute("dsp_1", {"status": "done"}, ADMIN)
    assert bad_status.value.status_code == 400

    with pytest.raises(HTTPException) as missing_kyc:
        await server.admin_approve_kyc("missing", ADMIN)
    assert missing_kyc.value.status_code == 404
