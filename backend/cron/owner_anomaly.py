"""
Daily owner anomaly detection cron job.
Run via:  python -m cron.owner_anomaly
Or via APScheduler (wired into server.py startup):
  schedule_owner_anomaly_cron(app, db)

For each vehicle owner, asks the AI Nexus (Operations Agent) to surface
anomalies in their last 7 days of booking data, then sends a push
notification if meaningful insights are found.

Typical anomalies detected:
  - "3 of your top 5 vehicles had 0 bookings this week"
  - "Vehicle X has been idle for 14 days"
  - "Average daily earnings down 40% vs prior week"
  - "KTM Duke 390 has 3 pending bookings but 0 completed"
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger("raidex.cron.owner_anomaly")
logging.basicConfig(level=logging.INFO)

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY", "")
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")

OWNER_ANOMALY_SYSTEM = """You are Raidex Fleet Intelligence, an AI analyst watching over vehicle owners' performance.
Your job: given a snapshot of an owner's last 7 days, identify the 1–3 most actionable anomalies.

Rules:
- Be SHORT: ≤ 120 words total.
- Be specific: name the vehicle, cite the number.
- Tone: friendly nudge, not alarming.
- Only surface anomalies that warrant action (idle vehicles, revenue drops >30%, booking spikes needing attention).
- If everything looks healthy, respond with exactly: NO_ANOMALY
- Never mention competitor platforms.
- Format as 1–2 punchy sentences suitable for a push notification body.
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _owner_snapshot(db, owner_id: str, owner_name: str) -> dict:
    """Build a 7-day performance snapshot for one owner."""
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    prev_week_ago = (now - timedelta(days=14)).isoformat()

    vehicles = await db.vehicles.find(
        {"owner_id": owner_id}, {"_id": 0, "vehicle_id": 1, "name": 1, "type": 1, "available": 1}
    ).to_list(50)

    vehicle_ids = [v["vehicle_id"] for v in vehicles]

    # This-week bookings
    this_week = await db.bookings.find(
        {
            "owner_id": owner_id,
            "created_at": {"$gte": week_ago},
            "status": {"$in": ["confirmed", "active", "completed"]},
        },
        {"_id": 0, "vehicle_id": 1, "total_amount": 1, "status": 1},
    ).to_list(500)

    # Prior week bookings
    prior_week = await db.bookings.find(
        {
            "owner_id": owner_id,
            "created_at": {"$gte": prev_week_ago, "$lt": week_ago},
            "status": {"$in": ["confirmed", "active", "completed"]},
        },
        {"_id": 0, "vehicle_id": 1, "total_amount": 1},
    ).to_list(500)

    # Per-vehicle booking counts this week
    vehicle_bookings: dict[str, int] = {v["vehicle_id"]: 0 for v in vehicles}
    this_week_revenue = 0.0
    for b in this_week:
        vehicle_bookings[b["vehicle_id"]] = vehicle_bookings.get(b["vehicle_id"], 0) + 1
        this_week_revenue += b.get("total_amount", 0)

    prior_week_revenue = sum(b.get("total_amount", 0) for b in prior_week)

    # Idle vehicles (0 bookings this week, available)
    idle = [
        v["name"]
        for v in vehicles
        if vehicle_bookings.get(v["vehicle_id"], 0) == 0 and v.get("available", False)
    ]

    return {
        "owner_id": owner_id,
        "owner_name": owner_name,
        "total_vehicles": len(vehicles),
        "vehicles": [
            {"name": v["name"], "type": v["type"], "bookings_this_week": vehicle_bookings.get(v["vehicle_id"], 0)}
            for v in vehicles
        ],
        "this_week_revenue_inr": round(this_week_revenue, 2),
        "prior_week_revenue_inr": round(prior_week_revenue, 2),
        "revenue_change_pct": round(
            ((this_week_revenue - prior_week_revenue) / max(prior_week_revenue, 1)) * 100, 1
        ),
        "idle_vehicles": idle,
        "total_bookings_this_week": len(this_week),
    }


async def _run_anomaly_check(db, owner_id: str, owner_name: str) -> str | None:
    """Return a push notification body string, or None if no anomaly."""
    if not EMERGENT_LLM_KEY:
        logger.warning("EMERGENT_LLM_KEY not set — skipping AI anomaly check")
        return None

    snap = await _owner_snapshot(db, owner_id, owner_name)

    # Fast-path: no vehicles or fresh account
    if snap["total_vehicles"] == 0:
        return None

    prompt = (
        f"Owner: {owner_name}\n"
        f"7-day snapshot:\n{json.dumps(snap, indent=2)}\n\n"
        "Surface the most important anomaly (or NO_ANOMALY)."
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        session_id = f"anomaly_{owner_id}_{datetime.now(timezone.utc).strftime('%Y%m%d')}"
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id,
            system_message=OWNER_ANOMALY_SYSTEM,
        ).with_model(*LLM_MODEL)

        resp = await chat.send_message(UserMessage(text=prompt))
        reply = (resp.text or "").strip()

        if reply.startswith("NO_ANOMALY") or not reply:
            return None

        # Store run for audit / ops visibility
        await db.agent_runs.insert_one({
            "run_id": "run_" + uuid.uuid4().hex[:10],
            "agent": "owner_anomaly_cron",
            "owner_id": owner_id,
            "input": prompt[:500],
            "output": reply[:500],
            "model": f"{LLM_MODEL[0]}/{LLM_MODEL[1]}",
            "created_at": utc_now(),
        })

        return reply

    except Exception as exc:
        logger.exception("LLM anomaly check failed for owner %s: %s", owner_id, exc)
        return None


async def run_owner_anomaly_cron(db=None) -> None:
    """
    Main entry point.
    If db is None (standalone run), creates its own motor client.
    """
    standalone = db is None
    if standalone:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]

    try:
        # Fetch all owners
        owners = await db.users.find(
            {"$or": [{"role": "owner"}, {"roles": "owner"}]},
            {"_id": 0, "user_id": 1, "name": 1},
        ).to_list(1000)

        logger.info("Owner anomaly cron: checking %d owners", len(owners))

        from providers.push_sender import get_push_sender, PushPayload

        for owner in owners:
            owner_id = owner["user_id"]
            owner_name = owner.get("name", "there")

            anomaly_msg = await _run_anomaly_check(db, owner_id, owner_name)
            if not anomaly_msg:
                continue

            # Save in-app notification
            await db.notifications.insert_one({
                "notification_id": "ntf_" + uuid.uuid4().hex[:10],
                "user_id": owner_id,
                "title": "📊 Fleet Insight",
                "body": anomaly_msg,
                "type": "owner_anomaly",
                "read": False,
                "created_at": utc_now(),
            })

            # Push notification
            push = get_push_sender()
            await push.send(PushPayload(
                user_id=owner_id,
                title="📊 Fleet Insight",
                body=anomaly_msg,
                deeplink="raidex://owner",
                data={"screen": "owner", "type": "anomaly"},
            ))

            logger.info("Sent anomaly notification to owner %s: %s", owner_id, anomaly_msg[:80])

        logger.info("Owner anomaly cron complete.")

    finally:
        if standalone:
            client.close()


if __name__ == "__main__":
    asyncio.run(run_owner_anomaly_cron())
