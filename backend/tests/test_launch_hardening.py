"""
Regression tests for the launch-readiness P0 fixes:
- P0-2: owner cannot self-approve a vehicle by flipping `available` via PATCH
        before admin verification.
- P0-4: production boot fails if PAYMENT_PROVIDER=razorpay but
        RAZORPAY_WEBHOOK_SECRET is unset.
- P0-5: production boot fails if ALLOWED_ORIGINS contains a wildcard "*".
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
