import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raidex_platform.audit import AuditLogger
from raidex_platform.analytics import AnalyticsEngine
from raidex_platform.events import DomainEvent, EventBus
from raidex_platform.feature_flags import FeatureFlagService
from raidex_platform.jobs import JobRunner, default_job_registry
from raidex_platform.notifications import NotificationService
from raidex_platform.observability import ObservabilityMetrics
from raidex_platform.pricing import DynamicPricingEngine
from raidex_platform.rate_limits import rate_limit_for_role
from raidex_platform.recommendations import RecommendationEngine
from test_quality_flows import USER, fake_db, vehicle
from fastapi.testclient import TestClient
import server


@pytest.mark.asyncio
async def test_event_bus_publishes_to_multiple_subscribers_and_records_failures(fake_db):
    bus = EventBus(fake_db)
    seen = []

    async def first(event):
        seen.append(("first", event.name))

    def second(event):
        seen.append(("second", event.payload["booking_id"]))

    def failing(_event):
        raise RuntimeError("subscriber down")

    bus.subscribe("BookingCreated", first)
    bus.subscribe("BookingCreated", second)
    bus.subscribe("BookingCreated", failing)

    event = await bus.publish(DomainEvent("BookingCreated", {"booking_id": "bkg_1"}, USER["user_id"]))

    assert event.event_id.startswith("evt_")
    assert seen == [("first", "BookingCreated"), ("second", "bkg_1")]
    assert fake_db.event_log.docs[0]["name"] == "BookingCreated"
    assert fake_db.event_failures.docs[0]["status"] == "subscriber_failed"


@pytest.mark.asyncio
async def test_notification_service_records_history_outbox_and_retries(fake_db):
    svc = NotificationService(fake_db)
    note = await svc.notify(user_id=USER["user_id"], title="Booking Confirmed", body="Your trip is ready", ntype="booking")

    assert note["notification_id"].startswith("ntf_")
    assert len(fake_db.notifications.docs) == 1
    assert {item["channel"] for item in fake_db.notification_outbox.docs} == {"in_app", "push"}

    fake_db.notification_outbox.docs[0]["status"] = "failed"
    assert await svc.retry_failed() == 1
    assert fake_db.notification_outbox.docs[0]["status"] == "queued"
    assert fake_db.notification_outbox.docs[0]["attempts"] == 1


@pytest.mark.asyncio
async def test_notification_push_subscriber_is_future_ready(fake_db):
    sent = []

    class Push:
        async def send(self, payload):
            sent.append(payload.title)
            return True

    await NotificationService(fake_db, Push()).send_push_for_event(
        DomainEvent("PaymentCompleted", {"title": "Paid", "body": "Payment done"}, USER["user_id"])
    )
    await NotificationService(fake_db, Push()).send_push_for_event(
        DomainEvent("System", {"title": "No user"}, None)
    )
    assert sent == ["Paid"]


@pytest.mark.asyncio
async def test_analytics_engine_tracks_events_and_dashboard(fake_db):
    fake_db.payments.docs.append({"status": "succeeded", "amount": 1500})
    fake_db.bookings.docs.append({"booking_id": "bkg_1", "status": "cancelled"})
    fake_db.vehicles.docs.append(vehicle(trips=12, location="Delhi"))

    engine = AnalyticsEngine(fake_db)
    await engine.handle_domain_event(DomainEvent("CouponRedeemed", {"code": "FIRST100"}, USER["user_id"]))
    dashboard = await engine.admin_dashboard()

    assert fake_db.analytics_events.docs[0]["name"] == "CouponRedeemed"
    assert dashboard["average_booking_value"] == 1500
    assert dashboard["vehicle_utilization"][0]["trips"] == 12


@pytest.mark.asyncio
async def test_recommendation_engine_scores_location_budget_and_wishlist(fake_db):
    fake_db.vehicles.docs.extend([
        vehicle(vehicle_id="veh_budget", location="Delhi", price_per_day=900, rating=4.9),
        vehicle(vehicle_id="veh_expensive", location="Mumbai", price_per_day=4000, rating=4.1),
    ])
    fake_db.wishlist.docs.append({"user_id": USER["user_id"], "vehicle_id": "veh_budget"})

    recs = await RecommendationEngine(fake_db).recommend(USER, location="Delhi", budget=1200, duration_days=2)

    assert recs[0]["vehicle_id"] == "veh_budget"
    assert recs[0]["best_match_score"] > recs[1]["best_match_score"]


def test_dynamic_pricing_returns_transparent_breakdown():
    quote = DynamicPricingEngine().quote(
        {"price_per_day": 1000},
        start_date="2026-07-04T00:00:00+00:00",
        end_date="2026-07-06T00:00:00+00:00",
        demand_index=1.4,
        supply_index=1.0,
        festival=True,
        weather_risk=0.1,
    )

    assert quote["base"] == 2000
    assert quote["total"] > quote["base"]
    assert set(quote["multipliers"]) == {"weekend", "demand_supply", "festival", "weather"}


@pytest.mark.asyncio
async def test_feature_flags_support_roles_internal_and_percentage(fake_db):
    fake_db.feature_flags.docs.append({"flag": "dynamic_pricing", "enabled": True, "roles": ["admin"], "percentage": 100})
    svc = FeatureFlagService(fake_db)

    assert await svc.enabled("dynamic_pricing", {**USER, "role": "admin"}) is True
    assert await svc.enabled("dynamic_pricing", {**USER, "role": "customer"}) is False

    fake_db.feature_flags.docs.append({"flag": "internal_ai", "enabled": True, "internal_only": True})
    assert await svc.enabled("internal_ai", {**USER, "email": "dev@raidex.internal"}) is True
    assert await svc.enabled("internal_ai", USER) is False
    assert await svc.enabled("missing_flag", USER) is False

    fake_db.feature_flags.docs.append({"flag": "owner_only", "enabled": True, "roles": ["owner"], "percentage": 0})
    assert await svc.enabled("owner_only", {**USER, "role": "owner"}) is False


@pytest.mark.asyncio
async def test_audit_logger_and_job_observability_primitives(fake_db):
    audit = await AuditLogger(fake_db).log(
        actor_id="admin_1",
        action="vehicle.approve",
        target_type="vehicle",
        target_id="veh_1",
        before={"verification_status": "pending"},
        after={"verification_status": "approved"},
    )
    assert audit["immutable"] is True
    assert fake_db.audit_log.docs[0]["action"] == "vehicle.approve"

    registry = default_job_registry()
    assert "payment_reconciliation" in {job["name"] for job in registry.list_jobs()}
    await JobRunner(fake_db, registry).record_run("payment_reconciliation", "success", {"checked": 12})
    assert fake_db.job_runs.docs[0]["status"] == "success"

    metrics = ObservabilityMetrics(fake_db)
    await metrics.record_latency(metric="api.latency", elapsed_ms=42, tags={"route": "/api/bookings"})
    assert (await metrics.dashboard())["metrics"][0]["elapsed_ms"] == 42

    null_metrics = ObservabilityMetrics(None)
    await null_metrics.record_latency(metric="api.latency", elapsed_ms=1)
    assert await null_metrics.dashboard() == {"metrics": []}


def test_rate_limit_policy_is_role_aware():
    assert rate_limit_for_role(None) == "30/minute"
    assert rate_limit_for_role("customer") == "120/minute"
    assert rate_limit_for_role("owner") == "180/minute"
    assert rate_limit_for_role("admin") == "300/minute"


def test_api_v1_version_rewrite_maintains_backward_compatibility(fake_db):
    client = TestClient(server.app, raise_server_exceptions=False)
    assert client.get("/api/v1/health").status_code == 200
