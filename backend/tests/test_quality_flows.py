import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


USER = {
    "user_id": "usr_1",
    "email": "rider@example.com",
    "name": "Rider",
    "kyc_status": "verified",
    "wallet_balance": 500,
    "ride_miles": 0,
}


class Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key=None, direction=1, *_args):
        if isinstance(key, str):
            reverse = direction == -1
            self.docs.sort(key=lambda d: d.get(key) or "", reverse=reverse)
        return self

    def limit(self, _limit):
        self.docs = self.docs[:_limit]
        return self

    async def to_list(self, _limit):
        return self.docs


class Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.inserted = []
        self.updated = []

    async def find_one(self, query, projection=None, *_, **__):
        for doc in self.docs:
            if matches(doc, query):
                if projection and all(v == 0 for v in projection.values()):
                    return {k: v for k, v in doc.items() if projection.get(k) != 0}
                return dict(doc)
        return None

    def find(self, query=None, projection=None):
        return Cursor([dict(d) for d in self.docs if matches(d, query or {})])

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.docs.append(doc)

    async def update_one(self, query, update, upsert=False):
        self.updated.append((query, update, upsert))
        doc = next((item for item in self.docs if matches(item, query)), None)
        if doc is None and upsert:
            doc = dict(query)
            self.docs.append(doc)
        if doc is not None:
            apply_update(doc, update)
        return None

    async def delete_one(self, query):
        self.docs = [d for d in self.docs if not matches(d, query)]

    async def count_documents(self, query):
        return len([d for d in self.docs if matches(d, query)])

    async def create_index(self, *_args, **_kwargs):
        return None


def matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(doc, item) for item in expected):
                return False
            continue
        actual = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$lt" in expected and not (actual < expected["$lt"]):
                return False
            if "$gt" in expected and not (actual > expected["$gt"]):
                return False
            if "$lte" in expected and not (actual <= expected["$lte"]):
                return False
            if "$gte" in expected and not (actual >= expected["$gte"]):
                return False
            if "$regex" in expected:
                flags = re.IGNORECASE if "i" in expected.get("$options", "") else 0
                if actual is None or not re.search(expected["$regex"], str(actual), flags):
                    return False
        elif actual != expected:
            return False
    return True


def apply_update(doc, update):
    if "$set" in update:
        doc.update(update["$set"])
    if "$inc" in update:
        for key, value in update["$inc"].items():
            doc[key] = doc.get(key, 0) + value
    if "$setOnInsert" in update:
        for key, value in update["$setOnInsert"].items():
            doc.setdefault(key, value)


class DB:
    def __init__(self):
        self.users = Collection([dict(USER)])
        self.vehicles = Collection()
        self.bookings = Collection()
        self.payments = Collection()
        self.disputes = Collection()
        self.coupons = Collection()
        self.referrals = Collection()
        self.reviews = Collection()
        self.wishlist = Collection()
        self.recently_viewed = Collection()
        self.inspections = Collection()
        self.admin_audit = Collection()
        self.notifications = Collection()
        self.notification_outbox = Collection()
        self.notification_preferences = Collection()
        self.event_log = Collection()
        self.event_failures = Collection()
        self.analytics_events = Collection()
        self.feature_flags = Collection()
        self.audit_log = Collection()
        self.job_runs = Collection()
        self.observability_metrics = Collection()
        self.pricing_quotes = Collection()
        self.kyc_submissions = Collection()
        self.geofence_events = Collection()
        self.gps_tracks = Collection()
        self.media_assets = Collection()
        self.support_messages = Collection()
        self.wallet_ledger = Collection()
        self.ride_miles_ledger = Collection()
        self.device_sessions = Collection()
        self.revoked_tokens = Collection()
        self.user_sessions = Collection()

    async def command(self, *_args, **_kwargs):
        return {"ok": 1}


@pytest.fixture()
def fake_db(monkeypatch):
    db = DB()
    monkeypatch.setattr(server, "db", db)
    return db


def vehicle(**overrides):
    base = {
        "vehicle_id": "veh_1",
        "type": "car",
        "name": "Nexon EV",
        "brand": "Tata",
        "model": "EV",
        "image": "https://img",
        "price_per_hour": 100,
        "price_per_day": 1000,
        "price_per_week": 6000,
        "price_per_month": 20000,
        "deposit": 5000,
        "transmission": "Auto",
        "fuel_type": "EV",
        "seats": 5,
        "rating": 4.8,
        "trips": 10,
        "distance_km": 2,
        "location": "Delhi",
        "latitude": 28.6,
        "longitude": 77.2,
        "host_name": "Host",
        "host_avatar": "https://avatar",
        "available": True,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_booking_requires_verified_kyc(fake_db):
    payload = server.BookingCreate(
        vehicle_id="veh_1",
        plan="daily",
        start_date="2026-07-01T00:00:00+00:00",
        end_date="2026-07-02T00:00:00+00:00",
    )
    with pytest.raises(HTTPException) as exc:
        await server.create_booking(payload, {**USER, "kyc_status": "pending"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_booking_conflict_blocks_double_booking(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    fake_db.bookings.docs.append({
        "booking_id": "bkg_existing",
        "vehicle_id": "veh_1",
        "status": "confirmed",
        "start_date": "2026-07-01T00:00:00+00:00",
        "end_date": "2026-07-03T00:00:00+00:00",
    })
    payload = server.BookingCreate(
        vehicle_id="veh_1",
        plan="daily",
        start_date="2026-07-02T00:00:00+00:00",
        end_date="2026-07-04T00:00:00+00:00",
    )
    with pytest.raises(HTTPException) as exc:
        await server.create_booking(payload, USER)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_booking_invoice_includes_gst_fields(fake_db, monkeypatch):
    monkeypatch.setenv("RAIDEX_GSTIN", "07ABCDE1234F1Z5")
    fake_db.bookings.docs.append({
        "booking_id": "bkg_123",
        "user_id": USER["user_id"],
        "vehicle_snapshot": {"name": "Nexon EV"},
        "plan": "daily",
        "total_amount": 1180,
        "deposit": 5000,
    })
    invoice = await server.booking_invoice("bkg_123", gst=True, user=USER)
    assert invoice["gst_invoice"] is True
    assert invoice["supplier_gstin"] == "07ABCDE1234F1Z5"
    assert invoice["line_items"][1]["amount"] == 180


@pytest.mark.asyncio
async def test_dispute_rejects_booking_id_mismatch(fake_db):
    payload = server.DisputeCreateRequest(booking_id="bkg_other", category="payment", message="Payment failed twice")
    with pytest.raises(HTTPException) as exc:
        await server.create_dispute("bkg_123", payload, USER)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_coupon_validation_caps_percent_discount(fake_db):
    result = await server.validate_coupon(server.CouponValidateRequest(code="RAIDEX10", amount=8000), USER)
    assert result == {"code": "RAIDEX10", "valid": True, "discount": 500, "payable": 7500}


@pytest.mark.asyncio
async def test_referral_rejects_self_referral(fake_db):
    with pytest.raises(HTTPException) as exc:
        await server.create_referral(server.ReferralCreateRequest(referred_email=USER["email"]), USER)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_refresh_token_rejects_expired_session(fake_db):
    fake_db.device_sessions.docs.append({
        "session_id": "ses_1",
        "refresh_token": "rft_expired",
        "revoked": False,
        "user_id": USER["user_id"],
        "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
    })
    with pytest.raises(HTTPException) as exc:
        await server.refresh_token(server.RefreshTokenRequest(refresh_token="rft_expired"), request=type("Req", (), {"headers": {}})())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_wishlist_add_and_remove_vehicle(fake_db):
    fake_db.vehicles.docs.append(vehicle())
    assert await server.add_wishlist("veh_1", USER) == {"ok": True}
    assert fake_db.wishlist.docs[0]["vehicle_snapshot"]["name"] == "Nexon EV"

    assert await server.remove_wishlist("veh_1", USER) == {"ok": True}
    assert fake_db.wishlist.docs == []


@pytest.mark.asyncio
async def test_review_requires_completed_booking(fake_db):
    payload = server.ReviewCreate(booking_id="bkg_1", rating=5, comment="Great car")
    with pytest.raises(HTTPException) as exc:
        await server.create_vehicle_review("veh_1", payload, USER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_completed_trip_review_updates_vehicle_rating(fake_db):
    fake_db.vehicles.docs.append(vehicle(rating=4))
    fake_db.bookings.docs.append({
        "booking_id": "bkg_1",
        "vehicle_id": "veh_1",
        "user_id": USER["user_id"],
        "status": "completed",
    })
    fake_db.reviews.docs.append({"booking_id": "old", "vehicle_id": "veh_1", "rating": 3})

    review = await server.create_vehicle_review(
        "veh_1",
        server.ReviewCreate(booking_id="bkg_1", rating=5, comment="Great car"),
        USER,
    )

    assert review["rating"] == 5
    assert fake_db.vehicles.updated[-1][1]["$set"]["rating"] == 4


class Gateway:
    async def create_order(self, *, amount, currency, meta):
        from providers.payment_gateway import PaymentOrder
        return PaymentOrder(order_id="order_1", amount=amount, currency=currency, provider="mock")

    async def confirm(self, **_kwargs):
        from providers.payment_gateway import PaymentResult
        return PaymentResult(True, "pay_provider_1", "sig_1", None)

    async def refund(self, **kwargs):
        from providers.payment_gateway import RefundResult
        return RefundResult(True, kwargs["amount"], None)


@pytest.mark.asyncio
async def test_payment_create_is_idempotent(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    payload = server.PaymentCreateRequest(amount=1200, purpose="wallet_topup", idempotency_key="idem_1")

    first = await server.payments_create(payload, USER)
    second = await server.payments_create(payload, USER)

    assert first["payment_id"] == second["payment_id"]
    assert len(fake_db.payments.docs) == 1


@pytest.mark.asyncio
async def test_wallet_topup_payment_confirmation_updates_balance(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_payment_gateway", lambda: Gateway())
    fake_db.payments.docs.append({
        "payment_id": "pay_1",
        "user_id": USER["user_id"],
        "booking_id": None,
        "purpose": "wallet_topup",
        "amount": 700,
        "provider": "mock",
        "provider_order_id": "order_1",
        "status": "created",
    })

    updated = await server.payments_confirm("pay_1", server.PaymentConfirmRequest(force_outcome="success"), USER)

    assert updated["status"] == "succeeded"
    assert fake_db.users.docs[0]["wallet_balance"] == 1200


@pytest.mark.asyncio
async def test_trip_lifecycle_requires_inspections(fake_db):
    fake_db.bookings.docs.append({
        "booking_id": "bkg_1",
        "vehicle_id": "veh_1",
        "user_id": USER["user_id"],
        "status": "confirmed",
    })
    with pytest.raises(HTTPException) as exc:
        await server.start_trip("bkg_1", USER)
    assert exc.value.status_code == 422


def test_haversine_distance_is_reasonable():
    distance = server._haversine_m(28.6139, 77.2090, 28.7041, 77.1025)
    assert 14000 < distance < 16000
