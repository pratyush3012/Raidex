from datetime import datetime, timezone
from typing import Any


class AnalyticsEngine:
    def __init__(self, db: Any):
        self.db = db

    async def track_event(self, name: str, payload: dict, user_id: str | None = None) -> None:
        await self.db.analytics_events.insert_one({
            "name": name,
            "user_id": user_id,
            "payload": payload,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    async def handle_domain_event(self, event) -> None:
        await self.track_event(event.name, event.payload, event.user_id)

    async def admin_dashboard(self) -> dict:
        users = await self.db.users.count_documents({})
        bookings = await self.db.bookings.count_documents({})
        cancelled = await self.db.bookings.count_documents({"status": "cancelled"})
        succeeded = await self.db.payments.find({"status": "succeeded"}, {"amount": 1, "_id": 0}).to_list(5000)
        vehicles = await self.db.vehicles.find({}, {"vehicle_id": 1, "trips": 1, "location": 1, "_id": 0}).to_list(5000)
        revenue = round(sum(float(p.get("amount", 0)) for p in succeeded), 2)
        return {
            "daily_active_users": users,
            "monthly_active_users": users,
            "bookings": bookings,
            "cancellations": cancelled,
            "average_booking_value": round(revenue / max(1, len(succeeded)), 2),
            "revenue": revenue,
            "vehicle_utilization": sorted(
                [{"vehicle_id": v.get("vehicle_id"), "trips": v.get("trips", 0), "city": v.get("location")} for v in vehicles],
                key=lambda item: item["trips"],
                reverse=True,
            )[:20],
        }
