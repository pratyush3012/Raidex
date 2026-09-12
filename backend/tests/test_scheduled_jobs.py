import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raidex_platform.jobs import JobRunner, default_job_registry
from raidex_platform import scheduled_jobs as jobs
from raidex_platform.notifications import NotificationService
from test_quality_flows import fake_db, vehicle  # noqa: F401


def _iso(dt):
    return dt.isoformat()


@pytest.mark.asyncio
async def test_insurance_reminders_notifies_once_per_day_per_vehicle(fake_db):
    soon = _iso(datetime.now(timezone.utc) + timedelta(days=3))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id="usr_owner", insurance_expiry=soon))
    runner = JobRunner(fake_db, default_job_registry())

    result = await jobs.send_insurance_reminders(fake_db, runner)
    assert result["notified"] == 1
    assert len(fake_db.notifications.docs) == 1

    # A retried/second run today must not double-notify.
    result_again = await jobs.send_insurance_reminders(fake_db, runner)
    assert result_again["notified"] == 0
    assert len(fake_db.notifications.docs) == 1


@pytest.mark.asyncio
async def test_document_expiry_reminders_covers_puc_and_rc(fake_db):
    soon = _iso(datetime.now(timezone.utc) + timedelta(days=1))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id="usr_owner", puc_expiry=soon, rc_expiry=soon))
    runner = JobRunner(fake_db, default_job_registry())

    result = await jobs.send_document_expiry_reminders(fake_db, runner)
    assert result["notified"] == 2  # one for PUC, one for RC


@pytest.mark.asyncio
async def test_trip_reminders_notifies_customer_of_imminent_booking(fake_db):
    soon = _iso(datetime.now(timezone.utc) + timedelta(minutes=30))
    fake_db.bookings.docs.append({
        "booking_id": "bkg_1", "user_id": "usr_1", "vehicle_id": "veh_1",
        "status": "confirmed", "start_date": soon,
    })
    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.send_trip_reminders(fake_db, runner)
    assert result["notified"] == 1


@pytest.mark.asyncio
async def test_reconcile_payments_flags_stuck_payments(fake_db):
    stale = _iso(datetime.now(timezone.utc) - timedelta(hours=5))
    fake_db.payments.docs.append({"payment_id": "pay_1", "booking_id": "bkg_1", "status": "created", "created_at": stale})
    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.reconcile_payments(fake_db, runner)
    assert result["stuck_payments"] == 1
    assert fake_db.payment_reconciliation_flags.docs[0]["payment_id"] == "pay_1"


@pytest.mark.asyncio
async def test_scan_fraud_rules_flags_excessive_cancellations(fake_db):
    recent = _iso(datetime.now(timezone.utc) - timedelta(hours=1))
    for i in range(3):
        fake_db.bookings.docs.append({"booking_id": f"bkg_{i}", "user_id": "usr_bad", "status": "cancelled", "created_at": recent})
    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.scan_fraud_rules(fake_db, runner)
    assert result["flags_raised"] == 1
    assert fake_db.fraud_flags.docs[0]["rule"] == "excessive_cancellations"


@pytest.mark.asyncio
async def test_aggregate_analytics_writes_a_snapshot(fake_db):
    runner = JobRunner(fake_db, default_job_registry())
    await jobs.aggregate_analytics(fake_db, runner)
    assert len(fake_db.analytics_snapshots.docs) == 1


@pytest.mark.asyncio
async def test_expire_subscriptions_notifies_affected_users(fake_db):
    past = _iso(datetime.now(timezone.utc) - timedelta(days=1))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", available=False))
    fake_db.subscriptions.docs.append({
        "subscription_id": "sub_1", "user_id": "usr_1", "vehicle_id": "veh_1",
        "vehicle_snapshot": {"name": "Nexon EV"}, "status": "active",
        "end_date": past, "auto_renew": False,
    })
    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.expire_subscriptions(fake_db, runner)
    assert result["expired"] == 1
    assert fake_db.subscriptions.docs[0]["status"] == "expired"
    assert fake_db.vehicles.docs[0]["available"] is True
    assert any(n["type"] == "subscription" for n in fake_db.notifications.docs)


@pytest.mark.asyncio
async def test_drain_notification_outbox_delivers_to_registered_token(fake_db):
    """A queued push-channel outbox row reaches the user's registered device
    token via the push sender (RAIDEX_FINAL_PRODUCTION_AUDIT P1-4)."""
    fake_db.push_tokens.docs.append({"user_id": "usr_1", "token": "tok_good"})
    await NotificationService(fake_db).notify(
        user_id="usr_1", title="Booking Confirmed", body="Your trip is ready", ntype="booking",
    )

    delivered = []

    class FakeSender:
        async def send_to_token(self, token, payload):
            delivered.append((token, payload.title, payload.body))
            return True

    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.drain_notification_outbox(fake_db, runner, push_sender=FakeSender())

    assert result == {"sent": 1, "skipped": 0, "failed": 0}
    assert delivered == [("tok_good", "Booking Confirmed", "Your trip is ready")]
    push_row = next(r for r in fake_db.notification_outbox.docs if r["channel"] == "push")
    assert push_row["status"] == "sent"


@pytest.mark.asyncio
async def test_drain_notification_outbox_prunes_invalid_token_without_blocking_others(fake_db):
    """One dead token must not stop delivery to the same user's other tokens,
    nor crash the drain job - and the dead token gets pruned so it is never
    retried forever."""
    fake_db.push_tokens.docs.append({"user_id": "usr_1", "token": "tok_dead"})
    fake_db.push_tokens.docs.append({"user_id": "usr_1", "token": "tok_alive"})
    await NotificationService(fake_db).notify(
        user_id="usr_1", title="Payment Failed", body="Your card was declined", ntype="payment",
    )

    class FlakySender:
        async def send_to_token(self, token, payload):
            if token == "tok_dead":
                return False
            return True

    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.drain_notification_outbox(fake_db, runner, push_sender=FlakySender())

    assert result == {"sent": 1, "skipped": 0, "failed": 0}
    assert {d["token"] for d in fake_db.push_tokens.docs} == {"tok_alive"}
    push_row = next(r for r in fake_db.notification_outbox.docs if r["channel"] == "push")
    assert push_row["status"] == "sent"


@pytest.mark.asyncio
async def test_drain_notification_outbox_skips_user_with_no_token_without_erroring(fake_db):
    """A user with zero registered push tokens must not error the drain job -
    the in-app notification row (written by notify() regardless) stands on
    its own."""
    await NotificationService(fake_db).notify(
        user_id="usr_1", title="KYC Approved", body="You're verified", ntype="KYCApproved",
    )
    assert len(fake_db.notifications.docs) == 1

    class ShouldNotBeCalledSender:
        async def send_to_token(self, token, payload):
            raise AssertionError("send_to_token should not be called with no registered tokens")

    runner = JobRunner(fake_db, default_job_registry())
    result = await jobs.drain_notification_outbox(fake_db, runner, push_sender=ShouldNotBeCalledSender())

    assert result == {"sent": 0, "skipped": 1, "failed": 0}
    push_row = next(r for r in fake_db.notification_outbox.docs if r["channel"] == "push")
    assert push_row["status"] == "skipped_no_token"


@pytest.mark.asyncio
async def test_run_job_records_failure_for_unregistered_handler(fake_db):
    runner = JobRunner(fake_db, default_job_registry())
    with pytest.raises(RuntimeError):
        await jobs.run_job(fake_db, runner, "not_a_real_handler")
    assert fake_db.job_runs.docs[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_every_registered_job_has_a_real_handler():
    """Guards against the exact failure mode this module fixes: a job
    registered as metadata with no code behind it (see jobs.default_job_registry)."""
    registry = default_job_registry()
    for job in registry.list_jobs():
        assert job["handler"] in jobs.HANDLERS, f"No handler wired for job '{job['name']}'"
