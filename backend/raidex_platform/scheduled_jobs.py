# RAIDEX_SCHEDULED_JOB_HANDLERS
# Real implementations for every job name registered in `jobs.default_job_registry()`.
# Each handler is idempotent-safe to re-run (reminders only re-notify once per day via
# a dedup key on the notification, never mutate financial state) and records its own
# outcome through `JobRunner.record_run` so a broken handler is visible in `job_runs`
# instead of silently no-oping (the failure mode this replaces, see owner_anomaly cron).
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from raidex_platform.notifications import NotificationService
from raidex_platform.analytics import AnalyticsEngine
from raidex_platform.jobs import JobRunner
from raidex_platform.subscriptions import SubscriptionService
from providers.push_sender import get_push_sender, PushPayload


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _dedup_notify(db, notifier: NotificationService, *, user_id: str, title: str, body: str,
                         ntype: str, dedup_key: str) -> bool:
    """Send at most one notification per dedup_key per day. Returns True if sent."""
    today = _now().strftime("%Y%m%d")
    key = f"{dedup_key}:{today}"
    existing = await db.job_notification_dedup.find_one({"key": key})
    if existing:
        return False
    await db.job_notification_dedup.insert_one({"key": key, "created_at": _iso(_now())})
    await notifier.notify(user_id=user_id, title=title, body=body, ntype=ntype)
    return True


async def send_insurance_reminders(db, runner: JobRunner) -> dict:
    notifier = NotificationService(db)
    horizon = _iso(_now() + timedelta(days=7))
    today = _iso(_now())
    vehicles = await db.vehicles.find(
        {"insurance_expiry": {"$ne": None, "$lte": horizon}},
        {"_id": 0, "vehicle_id": 1, "owner_id": 1, "name": 1, "insurance_expiry": 1},
    ).to_list(2000)
    sent = 0
    for v in vehicles:
        expiry = v.get("insurance_expiry")
        if not expiry:
            continue
        status = "expired" if expiry < today else "expiring soon"
        ok = await _dedup_notify(
            db, notifier, user_id=v["owner_id"],
            title="Insurance renewal needed",
            body=f"{v.get('name', 'Your vehicle')}'s insurance is {status} ({expiry}). Renew to keep it bookable.",
            ntype="document_expiry",
            dedup_key=f"insurance:{v['vehicle_id']}",
        )
        sent += int(ok)
    await runner.record_run("insurance_reminders", "success", {"checked": len(vehicles), "notified": sent})
    return {"checked": len(vehicles), "notified": sent}


async def send_document_expiry_reminders(db, runner: JobRunner) -> dict:
    notifier = NotificationService(db)
    horizon = _iso(_now() + timedelta(days=7))
    today = _iso(_now())
    fields = [("puc_expiry", "Pollution certificate"), ("rc_expiry", "RC")]
    sent = 0
    checked = 0
    for field, label in fields:
        vehicles = await db.vehicles.find(
            {field: {"$ne": None, "$lte": horizon}},
            {"_id": 0, "vehicle_id": 1, "owner_id": 1, "name": 1, field: 1},
        ).to_list(2000)
        checked += len(vehicles)
        for v in vehicles:
            expiry = v.get(field)
            if not expiry:
                continue
            status = "expired" if expiry < today else "expiring soon"
            ok = await _dedup_notify(
                db, notifier, user_id=v["owner_id"],
                title=f"{label} renewal needed",
                body=f"{v.get('name', 'Your vehicle')}'s {label.lower()} is {status} ({expiry}).",
                ntype="document_expiry",
                dedup_key=f"{field}:{v['vehicle_id']}",
            )
            sent += int(ok)
    await runner.record_run("document_expiry_reminders", "success", {"checked": checked, "notified": sent})
    return {"checked": checked, "notified": sent}


async def send_trip_reminders(db, runner: JobRunner) -> dict:
    """Reminds customers of confirmed bookings starting in the next hour."""
    notifier = NotificationService(db)
    soon = _iso(_now() + timedelta(hours=1))
    now = _iso(_now())
    bookings = await db.bookings.find(
        {"status": "confirmed", "start_date": {"$gte": now, "$lte": soon}},
        {"_id": 0, "booking_id": 1, "user_id": 1, "vehicle_id": 1, "start_date": 1},
    ).to_list(2000)
    sent = 0
    for b in bookings:
        ok = await _dedup_notify(
            db, notifier, user_id=b["user_id"],
            title="Trip starting soon",
            body=f"Your booking {b['booking_id']} starts at {b['start_date']}. Don't forget the before-trip inspection.",
            ntype="trip_reminder",
            dedup_key=f"trip:{b['booking_id']}",
        )
        sent += int(ok)
    await runner.record_run("trip_reminders", "success", {"checked": len(bookings), "notified": sent})
    return {"checked": len(bookings), "notified": sent}


async def reconcile_payments(db, runner: JobRunner) -> dict:
    """Flags payments stuck in a non-terminal state for longer than expected -
    read-only/reporting, mirrors the ledger reconciliation's no-auto-mutate rule."""
    stale_before = _iso(_now() - timedelta(hours=2))
    stuck = await db.payments.find(
        {"status": {"$in": ["created", "pending"]}, "created_at": {"$lte": stale_before}},
        {"_id": 0, "payment_id": 1, "booking_id": 1, "status": 1, "created_at": 1},
    ).to_list(500)
    for p in stuck:
        await db.payment_reconciliation_flags.update_one(
            {"payment_id": p["payment_id"]},
            {"$set": {**p, "flagged_at": _iso(_now())}},
            upsert=True,
        )
    await runner.record_run("payment_reconciliation", "success", {"stuck_payments": len(stuck)})
    return {"stuck_payments": len(stuck)}


async def _count_by_user(db, collection_name: str, query: dict, threshold: int) -> dict[str, int]:
    """Plain find()+count in Python rather than a Mongo aggregation pipeline -
    keeps this portable across the real Motor driver and the in-memory fake
    Mongo used in tests, which doesn't implement `.aggregate()`."""
    docs = await getattr(db, collection_name).find(query, {"_id": 0, "user_id": 1}).to_list(5000)
    counts: dict[str, int] = {}
    for d in docs:
        uid = d.get("user_id")
        if uid:
            counts[uid] = counts.get(uid, 0) + 1
    return {uid: c for uid, c in counts.items() if c >= threshold}


async def scan_fraud_rules(db, runner: JobRunner) -> dict:
    """Simple rule-based fraud signals - reporting only, never auto-bans/refunds."""
    window = _iso(_now() - timedelta(hours=24))
    flags = []

    # Rule 1: same user, >=3 cancelled bookings in 24h (possible booking abuse)
    cancels = await _count_by_user(db, "bookings", {"status": "cancelled", "created_at": {"$gte": window}}, 3)
    for user_id, count in cancels.items():
        flags.append({"rule": "excessive_cancellations", "user_id": user_id, "count": count})

    # Rule 2: same user, >=3 failed payments in 24h (possible card testing)
    failures = await _count_by_user(db, "payments", {"status": "failed", "created_at": {"$gte": window}}, 3)
    for user_id, count in failures.items():
        flags.append({"rule": "excessive_failed_payments", "user_id": user_id, "count": count})

    for f in flags:
        await db.fraud_flags.insert_one({**f, "created_at": _iso(_now()), "status": "open"})

    await runner.record_run("fraud_scans", "success", {"flags_raised": len(flags)})
    return {"flags_raised": len(flags)}


async def aggregate_analytics(db, runner: JobRunner) -> dict:
    snapshot = await AnalyticsEngine(db).admin_dashboard()
    await db.analytics_snapshots.insert_one({"taken_at": _iso(_now()), **snapshot})
    await runner.record_run("analytics_aggregation", "success", {"snapshot_taken": True})
    return snapshot


async def expire_subscriptions(db, runner: JobRunner) -> dict:
    notifier = NotificationService(db)
    expired = await SubscriptionService(db).expire_due_subscriptions()
    for sub in expired:
        await notifier.notify(
            user_id=sub["user_id"], title="Subscription expired",
            body=f"Your {sub['vehicle_snapshot']['name']} subscription has expired. Renew any time to keep the vehicle.",
            ntype="subscription",
        )
    await runner.record_run("subscription_expiry", "success", {"expired": len(expired)})
    return {"expired": len(expired)}


async def drain_notification_outbox(db, runner: JobRunner, push_sender: Any | None = None) -> dict:
    """Delivers every due 'push'-channel row in `notification_outbox` to the
    user's registered device tokens (see RAIDEX_FINAL_PRODUCTION_AUDIT P1-4:
    `NotificationService.notify()` writes an outbox row per channel, but
    nothing ever drained the 'push' rows through `providers/push_sender.py`,
    so every in-app notification silently became push-notification-less).

    A token that a send attempt rejects is treated as stale/invalid and
    pruned from `push_tokens` immediately so it is never retried forever,
    without affecting delivery to the same user's other tokens. A user with
    no registered token is not an error - their in-app notification row
    (already written by `notify()`) stands on its own and the outbox row is
    marked 'skipped_no_token'.
    """
    sender = push_sender or get_push_sender()
    now = _iso(_now())
    rows = await db.notification_outbox.find(
        {"channel": "push", "status": "queued", "next_attempt_at": {"$lte": now}}
    ).to_list(500)

    sent = skipped = failed = 0

    for row in rows:
        notification = await db.notifications.find_one(
            {"notification_id": row["notification_id"]}, {"_id": 0}
        )
        if not notification:
            await db.notification_outbox.update_one(
                {"outbox_id": row["outbox_id"]},
                {"$set": {"status": "failed", "last_error": "notification_not_found"}},
            )
            failed += 1
            continue

        token_docs = await db.push_tokens.find(
            {"user_id": row["user_id"]}, {"_id": 0, "token": 1}
        ).to_list(20)

        if not token_docs:
            await db.notification_outbox.update_one(
                {"outbox_id": row["outbox_id"]},
                {"$set": {"status": "skipped_no_token"}},
            )
            skipped += 1
            continue

        payload = PushPayload(user_id=row["user_id"], title=notification["title"], body=notification["body"])
        delivered = False
        for doc in token_docs:
            token = doc["token"]
            try:
                ok = await sender.send_to_token(token, payload)
            except Exception:
                ok = False
            if ok:
                delivered = True
            else:
                # Stale/invalid token - prune so it's never retried forever,
                # without touching this user's other (possibly valid) tokens.
                await db.push_tokens.delete_one({"user_id": row["user_id"], "token": token})

        await db.notification_outbox.update_one(
            {"outbox_id": row["outbox_id"]},
            {"$set": {
                "status": "sent" if delivered else "failed",
                "attempts": int(row.get("attempts", 0)) + 1,
            }},
        )
        if delivered:
            sent += 1
        else:
            failed += 1

    await runner.record_run("notification_outbox_drain", "success", {"sent": sent, "skipped": skipped, "failed": failed})
    return {"sent": sent, "skipped": skipped, "failed": failed}


HANDLERS = {
    "send_insurance_reminders": send_insurance_reminders,
    "send_document_expiry_reminders": send_document_expiry_reminders,
    "send_trip_reminders": send_trip_reminders,
    "reconcile_payments": reconcile_payments,
    "scan_fraud_rules": scan_fraud_rules,
    "aggregate_analytics": aggregate_analytics,
    "expire_subscriptions": expire_subscriptions,
    "drain_notification_outbox": drain_notification_outbox,
}


async def run_job(db, runner: JobRunner, handler_name: str) -> dict:
    handler = HANDLERS.get(handler_name)
    if handler is None:
        await runner.record_run(handler_name, "failed", {"error": "no handler registered"})
        raise RuntimeError(f"No handler registered for job '{handler_name}'")
    try:
        return await handler(db, runner)
    except Exception as exc:  # pragma: no cover - defensive, exercised via tests per-handler
        await runner.record_run(handler_name, "failed", {"error": str(exc)})
        raise
