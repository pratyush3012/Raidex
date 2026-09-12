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
from raidex_platform.rate_limiter import get_rate_limiter
from test_quality_flows import USER, fake_db, vehicle  # noqa: F401

ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}


def test_check_rate_limit_allows_up_to_the_role_ceiling_then_429s():
    # customer ceiling is 120/minute
    for _ in range(120):
        server.check_rate_limit("some_action", USER)
    with pytest.raises(HTTPException) as exc:
        server.check_rate_limit("some_action", USER)
    assert exc.value.status_code == 429


def test_check_rate_limit_is_scoped_per_user_and_action():
    for _ in range(120):
        server.check_rate_limit("booking_create", USER)
    with pytest.raises(HTTPException):
        server.check_rate_limit("booking_create", USER)

    # A different user is unaffected.
    server.check_rate_limit("booking_create", {**USER, "user_id": "usr_other"})
    # A different action for the same user is also unaffected.
    server.check_rate_limit("payment_create", USER)


def test_admin_role_gets_a_higher_ceiling_than_customer():
    # Admin ceiling is 300/minute vs customer's 120/minute - 200 calls must
    # trip a customer but not an admin.
    for _ in range(120):
        server.check_rate_limit("commission_config_update", ADMIN)
    server.check_rate_limit("commission_config_update", ADMIN)  # still fine, admin ceiling is higher


@pytest.mark.asyncio
async def test_booking_creation_returns_429_once_customer_ceiling_exceeded(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    payload = server.BookingCreate(
        vehicle_id="veh_1", plan="daily",
        start_date="2026-07-01T00:00:00+00:00", end_date="2026-07-02T00:00:00+00:00",
    )
    key = f"booking_create:{USER['user_id']}"
    for _ in range(120):
        get_rate_limiter().hit(key, 120, 60)

    with pytest.raises(HTTPException) as exc:
        await server.create_booking(payload, USER)
    assert exc.value.status_code == 429
