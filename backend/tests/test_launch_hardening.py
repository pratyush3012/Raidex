"""
Regression tests for the launch-readiness P0/P1 fixes:
- P0-2: owner cannot self-approve a vehicle by flipping `available` via PATCH
        before admin verification.
- P0-4: production boot fails if PAYMENT_PROVIDER=razorpay but
        RAZORPAY_WEBHOOK_SECRET is unset.
- P0-5: production boot fails if ALLOWED_ORIGINS contains a wildcard "*".
- P1-3: a Nexus support thread can only be read by its owner or an admin.
- P2: a "deposit"-purpose payment is floor-checked against the booking's
      deposit amount, not its full rental total.
"""
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)

import pytest
from fastapi.testclient import TestClient

import server
from test_quality_flows import USER, fake_db, vehicle


OWNER = {**USER, "user_id": "usr_owner_1", "email": "owner@example.com", "roles": ["owner"]}


def _client():
    return TestClient(server.app, raise_server_exceptions=False)


def _auth(user_id: str, email: str):
    token = server.create_token(user_id, email)
    return {"Authorization": f"Bearer {token}"}


def test_owner_cannot_make_unapproved_vehicle_available(fake_db):
    fake_db.users.docs.append(OWNER)
    fake_db.vehicles.docs.append(vehicle(
        vehicle_id="veh_pending", owner_id=OWNER["user_id"],
        available=False, verification_status="pending",
    ))
    client = _client()
    res = client.patch(
        "/api/owner/vehicles/veh_pending",
        json={"available": True},
        headers=_auth(OWNER["user_id"], OWNER["email"]),
    )
    assert res.status_code == 400
    stored = next(v for v in fake_db.vehicles.docs if v["vehicle_id"] == "veh_pending")
    assert stored["available"] is False


def test_owner_can_make_approved_vehicle_available(fake_db):
    fake_db.users.docs.append(OWNER)
    fake_db.vehicles.docs.append(vehicle(
        vehicle_id="veh_approved", owner_id=OWNER["user_id"],
        available=False, verification_status="approved",
    ))
    client = _client()
    res = client.patch(
        "/api/owner/vehicles/veh_approved",
        json={"available": True},
        headers=_auth(OWNER["user_id"], OWNER["email"]),
    )
    assert res.status_code == 200
    assert res.json()["available"] is True


def test_owner_cannot_patch_another_owners_vehicle(fake_db):
    fake_db.users.docs.append(OWNER)
    fake_db.vehicles.docs.append(vehicle(
        vehicle_id="veh_other", owner_id="usr_someone_else",
        available=False, verification_status="approved",
    ))
    client = _client()
    res = client.patch(
        "/api/owner/vehicles/veh_other",
        json={"available": True},
        headers=_auth(OWNER["user_id"], OWNER["email"]),
    )
    assert res.status_code == 404


def _reload_validate_env(monkeypatch, **env):
    for key in ("ENV", "ALLOWED_ORIGINS", "PAYMENT_PROVIDER", "RAZORPAY_WEBHOOK_SECRET",
                "KYC_PROVIDER", "SMS_PROVIDER", "MONGO_URL", "DB_NAME"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "raidex_test")
    monkeypatch.setenv("KYC_PROVIDER", "karza")
    monkeypatch.setenv("SMS_PROVIDER", "msg91")
    monkeypatch.setenv("PAYMENT_PROVIDER", "razorpay")
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.raidex.io")
    monkeypatch.setenv("ENV", "production")
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


def test_validate_env_rejects_wildcard_cors_in_production(monkeypatch):
    _reload_validate_env(monkeypatch, ALLOWED_ORIGINS="*")
    with pytest.raises(RuntimeError, match="wildcard"):
        server._validate_env()


def test_validate_env_rejects_missing_webhook_secret_in_production(monkeypatch):
    _reload_validate_env(monkeypatch, RAZORPAY_WEBHOOK_SECRET=None)
    with pytest.raises(RuntimeError, match="RAZORPAY_WEBHOOK_SECRET"):
        server._validate_env()


def test_validate_env_rejects_mock_sms_in_production(monkeypatch):
    _reload_validate_env(monkeypatch, SMS_PROVIDER="mock")
    with pytest.raises(RuntimeError, match="SMS_PROVIDER"):
        server._validate_env()


def test_validate_env_passes_with_safe_production_config(monkeypatch):
    _reload_validate_env(monkeypatch)
    server._validate_env()


OTHER_USER = {**USER, "user_id": "usr_2", "email": "other@example.com"}
ADMIN = {**USER, "user_id": "usr_admin_1", "email": "admin@example.com", "roles": ["admin"]}


def test_nexus_thread_owner_can_read_own_thread(fake_db):
    fake_db.users.docs.append(USER)
    fake_db.support_threads.docs.append({"thread_id": "thr_1", "user_id": USER["user_id"]})
    fake_db.support_messages.docs.append({"thread_id": "thr_1", "role": "user", "content": "hi", "created_at": server.utc_now()})
    client = _client()
    res = client.get("/api/nexus/threads/thr_1", headers=_auth(USER["user_id"], USER["email"]))
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_nexus_thread_rejects_other_users(fake_db):
    fake_db.users.docs.append(USER)
    fake_db.users.docs.append(OTHER_USER)
    fake_db.support_threads.docs.append({"thread_id": "thr_1", "user_id": USER["user_id"]})
    client = _client()
    res = client.get("/api/nexus/threads/thr_1", headers=_auth(OTHER_USER["user_id"], OTHER_USER["email"]))
    assert res.status_code == 404


def test_nexus_thread_allows_admin(fake_db):
    fake_db.users.docs.append(USER)
    fake_db.users.docs.append(ADMIN)
    fake_db.support_threads.docs.append({"thread_id": "thr_1", "user_id": USER["user_id"]})
    client = _client()
    res = client.get("/api/nexus/threads/thr_1", headers=_auth(ADMIN["user_id"], ADMIN["email"]))
    assert res.status_code == 200


def test_nexus_thread_missing_returns_404(fake_db):
    fake_db.users.docs.append(USER)
    client = _client()
    res = client.get("/api/nexus/threads/thr_missing", headers=_auth(USER["user_id"], USER["email"]))
    assert res.status_code == 404


def _approved_booking_doc(**overrides):
    doc = {
        "booking_id": "bkg_deposit_1",
        "user_id": USER["user_id"],
        "vehicle_id": "veh_1",
        "owner_id": "usr_owner_1",
        "vehicle_snapshot": {"name": "Nexon EV", "image": "https://img", "type": "car", "brand": "Tata", "location": "Delhi"},
        "plan": "daily",
        "start_date": "2026-07-01T00:00:00+00:00",
        "end_date": "2026-07-02T00:00:00+00:00",
        "total_amount": 1000,
        "deposit": 5000,
        "status": "pending_payment",
        "payment_id": None,
        "created_at": server.utc_now(),
    }
    doc.update(overrides)
    return doc


def test_deposit_payment_floor_checks_deposit_not_total(fake_db):
    fake_db.users.docs.append(USER)
    fake_db.bookings.docs.append(_approved_booking_doc())
    client = _client()
    underpaid = client.post(
        "/api/payments/create",
        json={"booking_id": "bkg_deposit_1", "amount": 4999, "purpose": "deposit"},
        headers=_auth(USER["user_id"], USER["email"]),
    )
    assert underpaid.status_code == 400

    correct = client.post(
        "/api/payments/create",
        json={"booking_id": "bkg_deposit_1", "amount": 5000, "purpose": "deposit"},
        headers=_auth(USER["user_id"], USER["email"]),
    )
    assert correct.status_code == 200


def test_booking_payment_floor_still_checks_total_amount(fake_db):
    fake_db.users.docs.append(USER)
    fake_db.bookings.docs.append(_approved_booking_doc(booking_id="bkg_deposit_2"))
    client = _client()
    # 500 is below the booking's total_amount (1000) - a plain "booking" purpose
    # payment must still be floor-checked against total_amount, not the deposit.
    underpaid = client.post(
        "/api/payments/create",
        json={"booking_id": "bkg_deposit_2", "amount": 500, "purpose": "booking"},
        headers=_auth(USER["user_id"], USER["email"]),
    )
    assert underpaid.status_code == 400

    correct = client.post(
        "/api/payments/create",
        json={"booking_id": "bkg_deposit_2", "amount": 1000, "purpose": "booking"},
        headers=_auth(USER["user_id"], USER["email"]),
    )
    assert correct.status_code == 200
