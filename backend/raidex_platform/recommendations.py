from typing import Any


class RecommendationEngine:
    def __init__(self, db: Any):
        self.db = db

    async def recommend(self, user: dict, *, location: str | None = None, budget: float | None = None, duration_days: int = 1) -> list[dict]:
        vehicles = await self.db.vehicles.find({"available": True}, {"_id": 0}).to_list(200)
        wishlist = await self.db.wishlist.find({"user_id": user["user_id"]}, {"vehicle_id": 1, "_id": 0}).to_list(100)
        wished_ids = {w["vehicle_id"] for w in wishlist}
        scored = []
        for vehicle in vehicles:
            score = 50
            if location and location.lower() in str(vehicle.get("location", "")).lower():
                score += 15
            if budget and float(vehicle.get("price_per_day", 0)) <= budget:
                score += 15
            if vehicle.get("vehicle_id") in wished_ids:
                score += 10
            score += min(10, int(float(vehicle.get("rating", 0)) * 2))
            if duration_days >= 7 and vehicle.get("price_per_week"):
                score += 5
            item = dict(vehicle)
            item["best_match_score"] = min(99, score)
            scored.append(item)
        return sorted(scored, key=lambda item: item["best_match_score"], reverse=True)[:20]
