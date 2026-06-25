from datetime import datetime, timezone
from typing import Any


class BackgroundJobRegistry:
    def __init__(self):
        self.jobs: dict[str, dict] = {}

    def register(self, name: str, schedule: str, handler_name: str) -> None:
        self.jobs[name] = {"name": name, "schedule": schedule, "handler": handler_name}

    def list_jobs(self) -> list[dict]:
        return list(self.jobs.values())


class JobRunner:
    def __init__(self, db: Any, registry: BackgroundJobRegistry):
        self.db = db
        self.registry = registry

    async def record_run(self, job_name: str, status: str, details: dict | None = None) -> None:
        await self.db.job_runs.insert_one({
            "job_name": job_name,
            "status": status,
            "details": details or {},
            "ran_at": datetime.now(timezone.utc).isoformat(),
        })


def default_job_registry() -> BackgroundJobRegistry:
    registry = BackgroundJobRegistry()
    registry.register("insurance_reminders", "daily", "send_insurance_reminders")
    registry.register("document_expiry_reminders", "daily", "send_document_expiry_reminders")
    registry.register("trip_reminders", "hourly", "send_trip_reminders")
    registry.register("payment_reconciliation", "every_15_minutes", "reconcile_payments")
    registry.register("fraud_scans", "hourly", "scan_fraud_rules")
    registry.register("analytics_aggregation", "hourly", "aggregate_analytics")
    return registry
