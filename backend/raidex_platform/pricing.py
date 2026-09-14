from datetime import date, datetime
from typing import Any

# Fixed-Gregorian-date Indian national holidays only. Movable festivals
# (Diwali, Holi, Eid, ...) shift every year against a lunar/lunisolar
# calendar this codebase has no real data feed for - guessing at those dates
# would be fabricated data, so only the handful of holidays that land on the
# same calendar date every year are treated as "festival" for pricing.
FIXED_INDIAN_HOLIDAYS = {(1, 26), (8, 15), (10, 2)}  # Republic Day, Independence Day, Gandhi Jayanti


def is_festival_date(d: date) -> bool:
    return (d.month, d.day) in FIXED_INDIAN_HOLIDAYS


class DynamicPricingEngine:
    @staticmethod
    def multiplier(*, start: datetime, demand_index: float = 0, supply_index: float = 1, weather_risk: float = 0.0) -> dict:
        """Real-signal pricing multiplier used by actual booking charges (see
        BookingService.price_estimate) - distinct from `quote()` below, which
        is a separate, explicit-input "what if" preview utility with its own
        caller-supplied contract and is left untouched.

        `demand_index`/`supply_index` are expected to be real live counts
        (overlapping confirmed/active bookings for this vehicle type vs.
        currently-available vehicles of that type), not guesses. An absence
        of demand data (demand_index <= 0) stays neutral rather than being
        treated as "zero competition" and silently discounted - only a
        genuine, non-zero demand signal moves the price.
        """
        weekend_multiplier = 1.10 if start.weekday() >= 5 else 1.0
        if demand_index <= 0:
            demand_multiplier = 1.0
        else:
            demand_multiplier = max(0.8, min(1.5, demand_index / max(1, supply_index)))
        festival_multiplier = 1.15 if is_festival_date(start.date()) else 1.0
        weather_multiplier = 1 + min(0.2, max(0, weather_risk))
        combined = weekend_multiplier * demand_multiplier * festival_multiplier * weather_multiplier
        return {
            "weekend": weekend_multiplier,
            "demand_supply": round(demand_multiplier, 2),
            "festival": festival_multiplier,
            "weather": round(weather_multiplier, 2),
            "combined": round(combined, 4),
        }

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
