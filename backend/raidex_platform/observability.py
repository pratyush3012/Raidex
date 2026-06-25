from datetime import datetime, timezone
from typing import Any


class ObservabilityMetrics:
    def __init__(self, db: Any | None = None):
        self.db = db

    async def record_latency(self, *, metric: str, elapsed_ms: int, tags: dict | None = None) -> None:
        if self.db is None or not hasattr(self.db, "observability_metrics"):
            return
        await self.db.observability_metrics.insert_one({
            "metric": metric,
            "elapsed_ms": elapsed_ms,
            "tags": tags or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    async def dashboard(self) -> dict:
        if self.db is None or not hasattr(self.db, "observability_metrics"):
            return {"metrics": []}
        rows = await self.db.observability_metrics.find({}, {"_id": 0}).limit(500).to_list(500)
        return {"metrics": rows}
