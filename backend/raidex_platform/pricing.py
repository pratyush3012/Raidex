from datetime import datetime
from typing import Any


class DynamicPricingEngine:
    def quote(self, vehicle: dict[str, Any], *, start_date: str, end_date: str, demand_index: float = 1.0, supply_index: float = 1.0, festival: bool = False, weather_risk: float = 0.0) -> dict:
        start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        days = max(1, (end - start).days or 1)
        base = float(vehicle.get("price_per_day", 0)) * days
        weekend_multiplier = 1.10 if start.weekday() >= 5 else 1.0
        demand_multiplier = max(0.8, min(1.5, demand_index / max(0.5, supply_index)))
        festival_multiplier = 1.15 if festival else 1.0
        weather_multiplier = 1 + min(0.2, max(0, weather_risk))
        total = round(base * weekend_multiplier * demand_multiplier * festival_multiplier * weather_multiplier, 2)
        return {
            "base": base,
            "days": days,
            "multipliers": {
                "weekend": weekend_multiplier,
                "demand_supply": round(demand_multiplier, 2),
                "festival": festival_multiplier,
                "weather": round(weather_multiplier, 2),
            },
            "total": total,
        }
