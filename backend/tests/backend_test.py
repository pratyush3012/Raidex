"""RIDEX backend API tests - covers auth, vehicles, bookings, notifications, KYC, owner stats."""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://ridex-mobility-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TS = int(time.time())
EMAIL = f"qa+ridex_{TS}_{uuid.uuid4().hex[:6]}@example.com"
PASSWORD = "Test1234!"
NAME = "QA Tester"

STATE = {}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def auth_headers():
    return {"Authorization": f"Bearer {STATE['token']}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_register_new_user(self, session):
        r = session.post(f"{API}/auth/register", json={"email": EMAIL, "password": PASSWORD, "name": NAME}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "access_token" in d and d["access_token"]
        u = d["user"]
        assert u["email"] == EMAIL.lower()
        assert u["wallet_balance"] == 500.0
        assert u["ride_miles"] == 250
        assert u["tier"] == "Silver"
        assert u["kyc_status"] == "pending"
        assert "password_hash" not in u
        STATE["token"] = d["access_token"]
        STATE["user_id"] = u["user_id"]

    def test_register_duplicate_email_400(self, session):
        r = session.post(f"{API}/auth/register", json={"email": EMAIL, "password": PASSWORD, "name": NAME}, timeout=20)
        assert r.status_code == 400

    def test_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == EMAIL.lower()

    def test_login_wrong_password_400(self, session):
        r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": "WrongPass!"}, timeout=20)
        assert r.status_code == 400

    def test_me_with_token(self, session):
        r = session.get(f"{API}/auth/me", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        assert r.json()["email"] == EMAIL.lower()

    def test_me_without_token_401(self, session):
        r = session.get(f"{API}/auth/me", timeout=20)
        assert r.status_code == 401


# ---------- Vehicles ----------
class TestVehicles:
    def test_list_all_vehicles(self, session):
        r = session.get(f"{API}/vehicles", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) == 6, f"Expected 6 seeded vehicles, got {len(items)}"
        assert all("vehicle_id" in v for v in items)
        STATE["vehicle_id"] = items[0]["vehicle_id"]

    def test_filter_by_type_car(self, session):
        r = session.get(f"{API}/vehicles?type=car", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0
        assert all(v["type"] == "car" for v in items)

    def test_filter_by_type_bike(self, session):
        r = session.get(f"{API}/vehicles?type=bike", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0
        assert all(v["type"] == "bike" for v in items)

    def test_search_query_tesla(self, session):
        r = session.get(f"{API}/vehicles?q=Tesla", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert any("tesla" in v["name"].lower() for v in items)

    def test_get_vehicle_by_id(self, session):
        r = session.get(f"{API}/vehicles/{STATE['vehicle_id']}", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        v = r.json()
        assert v["vehicle_id"] == STATE["vehicle_id"]
        assert "price_per_day" in v

    def test_get_vehicle_not_found(self, session):
        r = session.get(f"{API}/vehicles/veh_does_not_exist", headers=auth_headers(), timeout=20)
        assert r.status_code == 404

    def test_list_requires_auth(self, session):
        r = session.get(f"{API}/vehicles", timeout=20)
        assert r.status_code == 401


# ---------- Bookings ----------
class TestBookings:
    def test_create_booking(self, session):
        # Get current miles
        me = session.get(f"{API}/auth/me", headers=auth_headers(), timeout=20).json()
        miles_before = me["ride_miles"]

        start = datetime.now(timezone.utc) + timedelta(hours=1)
        end = start + timedelta(days=2)
        payload = {
            "vehicle_id": STATE["vehicle_id"],
            "plan": "daily",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        }
        r = session.post(f"{API}/bookings", headers=auth_headers(), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "confirmed"
        assert b["total_amount"] > 0
        assert b["plan"] == "daily"
        assert b["vehicle_id"] == STATE["vehicle_id"]
        STATE["booking_id"] = b["booking_id"]

        # Verify miles increased
        me2 = session.get(f"{API}/auth/me", headers=auth_headers(), timeout=20).json()
        assert me2["ride_miles"] > miles_before

    def test_list_my_bookings(self, session):
        r = session.get(f"{API}/bookings", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert any(b["booking_id"] == STATE["booking_id"] for b in items)

    def test_start_trip(self, session):
        r = session.post(f"{API}/bookings/{STATE['booking_id']}/start", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "active"

        b = session.get(f"{API}/bookings/{STATE['booking_id']}", headers=auth_headers(), timeout=20).json()
        assert b["status"] == "active"

    def test_end_trip(self, session):
        r = session.post(f"{API}/bookings/{STATE['booking_id']}/end", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "completed"
        assert "miles_earned" in d

        b = session.get(f"{API}/bookings/{STATE['booking_id']}", headers=auth_headers(), timeout=20).json()
        assert b["status"] == "completed"


# ---------- Notifications ----------
class TestNotifications:
    def test_list_notifications_has_booking_confirmed(self, session):
        r = session.get(f"{API}/notifications", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert any(n.get("type") == "booking" for n in items)


# ---------- KYC ----------
class TestKYC:
    def test_kyc_verify(self, session):
        r = session.post(f"{API}/auth/kyc", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        assert r.json()["kyc_status"] == "verified"
        me = session.get(f"{API}/auth/me", headers=auth_headers(), timeout=20).json()
        assert me["kyc_status"] == "verified"


# ---------- Owner stats ----------
class TestOwnerStats:
    def test_owner_stats(self, session):
        r = session.get(f"{API}/owner/stats", headers=auth_headers(), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_earnings", "active_trips", "future_bookings", "utilization", "listings"):
            assert k in d
