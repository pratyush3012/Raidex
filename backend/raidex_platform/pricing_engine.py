# RAIDEX_PRICING_ENGINE
# Search tags: hourly rate range, duration curve, lead-time curve, platform
# fee, tax, host payout, extension pricing, late fee, early check-in.
#
# Single authoritative source of truth for what RaideX charges a customer and
# pays a host. Nothing else in the codebase should compute a rental rate,
# platform fee, tax split, or host payout independently - always go through
# PricingEngine / PricingConfigService, the same way commission resolution
# already goes exclusively through CommissionService (see commission.py,
# whose config-document + versioning pattern this module deliberately
# mirrors).
#
# Money handling: this codebase's existing financial code (CommissionService,
# BookingService._rental_amount, invoice generation, etc.) uses plain floats
# rounded to 2 decimal places at each computed boundary, not Decimal - kept
# consistent with that existing architecture here rather than introducing a
# second numeric convention that would need constant conversion at every call
# site shared with the rest of the app.
import math
from datetime import datetime
from typing import Any, Optional

CONFIG_ID = "pricing"

DEFAULT_CONFIG: dict[str, Any] = {
    "config_id": CONFIG_ID,
    "version": 1,
    # Minimum bookable duration per vehicle category, in hours. Spec: cars = 6.
    # Bikes aren't specified by the business rules given, so a shorter, clearly
    # distinct default is used - admin-editable like everything else here.
    "min_booking_hours": {"car": 6, "bike": 1},
    "min_notice_hours": 2,
    # Duration curve: at min_booking_hours, the rate sits at MAX_RATE; at
    # long_duration_threshold_hours (and beyond), it reaches MIN_RATE. Linear
    # interpolation in between, clamped outside.
    "duration_curve": {"long_duration_threshold_hours": 48},
    # Lead-time curve: at exactly min_notice_hours' notice, rate sits at
    # MAX_RATE (shortest allowed notice = highest price); at
    # max_discount_lead_hours' notice or beyond, rate reaches MIN_RATE.
    "lead_time_curve": {"max_discount_lead_hours": 168},
    # How duration vs lead-time factors combine into one final position on the
    # MIN_RATE..MAX_RATE axis - both weights should sum to 1.0.
    "factor_weights": {"duration": 0.6, "lead_time": 0.4},
    "platform_fee_pct": 0.10,
    "host_payout_pct": 0.80,
    "tax": {"enabled": True, "rate": 0.18, "inclusive": False},
    "early_checkin_grace_minutes": 30,
    "late_fee_multiplier": 2.0,
    "late_fee_split": {"host": 0.5, "platform": 0.5},
    "early_checkin_split": {"host": 0.5, "platform": 0.5},
    "price_lock_minutes": 10,
    "rounding_decimals": 2,
    # Add-on prices (helmet/insurance/delivery) were previously computed only
    # client-side and never actually charged - moved here so create_booking
    # can price them server-authoritatively like everything else.
    "add_ons_pricing": {"helmet": 50, "insurance": 199, "delivery": 299},
    "updated_at": None,
    "updated_by": None,
}


def derive_default_rate_range(price_per_hour: float) -> tuple[float, float]:
    """First-time backfill for a vehicle that has no admin-set
    min_hourly_rate/max_hourly_rate yet: treat its existing, already-published
    price_per_hour as the top of a real range rather than fabricating an
    unrelated number, and derive a minimum a fixed 25% below it. This is a
    starting point an admin is expected to review/adjust via the pricing
    admin endpoints - not a substitute for real admin configuration."""
    max_rate = _round(price_per_hour)
    min_rate = _round(price_per_hour * 0.75)
    return min_rate, max_rate


def _round(x: float, decimals: int = 2) -> float:
    return round(float(x), decimals)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


class PricingConfigService:
    """Admin-configurable pricing rules, versioned exactly like
    CommissionService's platform_config document. A version bump on every
    change is what lets historical bookings snapshot which rule-set priced
    them (see PricingEngine.calculate_booking_price's `pricing_rule_version`
    output) without ever being recalculated under today's rules."""

    def __init__(self, db: Any):
        self.db = db

    async def get_config(self) -> dict:
        if self.db is None:
            return dict(DEFAULT_CONFIG)
        doc = await self.db.pricing_config.find_one({"config_id": CONFIG_ID}, {"_id": 0})
        if not doc:
            return dict(DEFAULT_CONFIG)
        merged = dict(DEFAULT_CONFIG)
        merged.update(doc)
        return merged

    async def set_config(self, updates: dict, *, updated_by: str, now: str) -> dict:
        current = await self.get_config()
        # Shallow-merge top-level keys only, so a partial update (e.g. just
        # {"platform_fee_pct": 0.12}) can never silently wipe unrelated
        # sibling settings (e.g. tax config) the caller didn't intend to touch.
        next_config = dict(current)
        for key, value in updates.items():
            if key in ("config_id", "version"):
                continue
            next_config[key] = value
        next_config["version"] = int(current.get("version", 1)) + 1
        next_config["updated_at"] = now
        next_config["updated_by"] = updated_by
        next_config["config_id"] = CONFIG_ID
        await self.db.pricing_config.update_one({"config_id": CONFIG_ID}, {"$set": next_config}, upsert=True)
        return next_config

    async def min_booking_hours(self, vehicle_type: str) -> float:
        config = await self.get_config()
        table = config.get("min_booking_hours") or {}
        return float(table.get(vehicle_type, table.get("car", 6)))


class PricingEngine:
    """Pure, deterministic pricing calculations given a vehicle, a date range,
    and a resolved config document. No DB access here - callers (BookingService,
    the price-preview route, extension/late-fee/early-checkin handlers) own
    fetching the vehicle and live demand context; this class only computes."""

    @staticmethod
    def duration_factor(duration_hours: float, min_booking_hours: float, config: dict) -> float:
        """0.0 at the minimum bookable duration (→ MAX_RATE), 1.0 at or beyond
        the configured long-duration threshold (→ MIN_RATE), linear between."""
        threshold = float(config["duration_curve"]["long_duration_threshold_hours"])
        if threshold <= min_booking_hours:
            return 1.0 if duration_hours > min_booking_hours else 0.0
        return _clamp01((duration_hours - min_booking_hours) / (threshold - min_booking_hours))

    @staticmethod
    def lead_time_factor(lead_time_hours: float, min_notice_hours: float, config: dict) -> float:
        """0.0 at the minimum notice (→ MAX_RATE, shortest allowed lead time =
        priciest), 1.0 at or beyond the configured max-discount lead time (→
        MIN_RATE), linear between."""
        threshold = float(config["lead_time_curve"]["max_discount_lead_hours"])
        if threshold <= min_notice_hours:
            return 1.0 if lead_time_hours > min_notice_hours else 0.0
        return _clamp01((lead_time_hours - min_notice_hours) / (threshold - min_notice_hours))

    @classmethod
    def calculate_rate(
        cls, *, min_rate: float, max_rate: float, duration_hours: float, lead_time_hours: float,
        min_booking_hours: float, min_notice_hours: float, config: dict,
    ) -> dict:
        d_factor = cls.duration_factor(duration_hours, min_booking_hours, config)
        l_factor = cls.lead_time_factor(lead_time_hours, min_notice_hours, config)
        weights = config.get("factor_weights") or {"duration": 0.6, "lead_time": 0.4}
        w_duration = float(weights.get("duration", 0.6))
        w_lead = float(weights.get("lead_time", 0.4))
        total_weight = w_duration + w_lead or 1.0
        combined_factor = _clamp01((d_factor * w_duration + l_factor * w_lead) / total_weight)
        rate = max_rate - combined_factor * (max_rate - min_rate)
        rate = max(min_rate, min(max_rate, rate))
        return {
            "duration_factor": round(d_factor, 4),
            "lead_time_factor": round(l_factor, 4),
            "combined_factor": round(combined_factor, 4),
            "hourly_rate": _round(rate, int(config.get("rounding_decimals", 2))),
        }

    @staticmethod
    def calculate_tax(taxable_amount: float, config: dict) -> dict:
        tax_cfg = config.get("tax") or {"enabled": True, "rate": 0.18, "inclusive": False}
        if not tax_cfg.get("enabled", True):
            return {"rate": 0.0, "amount": 0.0, "inclusive": False}
        rate = float(tax_cfg.get("rate", 0.18))
        if tax_cfg.get("inclusive"):
            # taxable_amount already includes tax - back it out rather than
            # adding it a second time on top.
            amount = _round(taxable_amount - (taxable_amount / (1 + rate)))
        else:
            amount = _round(taxable_amount * rate)
        return {"rate": rate, "amount": amount, "inclusive": bool(tax_cfg.get("inclusive"))}

    @classmethod
    def calculate_booking_price(
        cls, *, vehicle: dict, duration_hours: float, lead_time_hours: float,
        min_booking_hours: float, config: dict,
    ) -> dict:
        min_rate = float(vehicle["min_hourly_rate"])
        max_rate = float(vehicle["max_hourly_rate"])
        min_notice_hours = float(config.get("min_notice_hours", 2))
        rate_calc = cls.calculate_rate(
            min_rate=min_rate, max_rate=max_rate, duration_hours=duration_hours,
            lead_time_hours=lead_time_hours, min_booking_hours=min_booking_hours,
            min_notice_hours=min_notice_hours, config=config,
        )
        hourly_rate = rate_calc["hourly_rate"]
        rental_subtotal = _round(hourly_rate * duration_hours)
        platform_fee = _round(rental_subtotal * float(config.get("platform_fee_pct", 0.10)))
        tax_calc = cls.calculate_tax(rental_subtotal + platform_fee, config)
        host_payout_pct = float(config.get("host_payout_pct", 0.80))
        host_payout = _round(rental_subtotal * host_payout_pct)
        platform_commission = _round(rental_subtotal - host_payout)
        deposit = float(vehicle.get("deposit", 0))
        total_payable = _round(rental_subtotal + platform_fee + tax_calc["amount"])
        return {
            "vehicle_id": vehicle.get("vehicle_id"),
            "currency": "INR",
            "duration_hours": round(duration_hours, 2),
            "lead_time_hours": round(lead_time_hours, 2),
            "rate_range": {"min": min_rate, "max": max_rate},
            "calculated_hourly_rate": hourly_rate,
            "duration_factor": rate_calc["duration_factor"],
            "lead_time_factor": rate_calc["lead_time_factor"],
            "combined_factor": rate_calc["combined_factor"],
            "rental_subtotal": rental_subtotal,
            "platform_fee": platform_fee,
            "platform_fee_pct": float(config.get("platform_fee_pct", 0.10)),
            "tax": tax_calc["amount"],
            "tax_rate": tax_calc["rate"],
            "discount": 0.0,
            "security_deposit": deposit,
            "total_payable": total_payable,
            "host_payout": host_payout,
            "host_payout_pct": host_payout_pct,
            "platform_commission": platform_commission,
            "pricing_rule_version": int(config.get("version", 1)),
        }

    @staticmethod
    def calculate_extension_price(*, original_hourly_rate: float, max_hourly_rate: float, extension_hours: float, config: dict) -> dict:
        """Extensions are short-notice by nature: the customer pays the
        vehicle's MAX_RATE for the extra time (never the original booking's
        discounted rate), but the host is paid at the ORIGINAL booking rate -
        RaideX keeps the difference as the platform's extension margin."""
        customer_amount = _round(max_hourly_rate * extension_hours)
        host_amount = _round(original_hourly_rate * extension_hours)
        platform_amount = _round(customer_amount - host_amount)
        tax_calc = PricingEngine.calculate_tax(customer_amount, config)
        return {
            "extension_hours": round(extension_hours, 2),
            "original_hourly_rate": original_hourly_rate,
            "extension_hourly_rate": max_hourly_rate,
            "extension_amount": customer_amount,
            "tax": tax_calc["amount"],
            "total_payable": _round(customer_amount + tax_calc["amount"]),
            "host_extension_payout": host_amount,
            "platform_extension_revenue": platform_amount,
        }

    @staticmethod
    def billable_late_hours(scheduled_end: datetime, actual_end: datetime) -> int:
        late_seconds = (actual_end - scheduled_end).total_seconds()
        if late_seconds <= 0:
            return 0
        return math.ceil(late_seconds / 3600)

    @classmethod
    def calculate_late_fee(cls, *, original_hourly_rate: float, scheduled_end: datetime, actual_end: datetime, config: dict) -> dict:
        billable_hours = cls.billable_late_hours(scheduled_end, actual_end)
        if billable_hours <= 0:
            return {"billable_hours": 0, "late_fee": 0.0, "host_share": 0.0, "platform_share": 0.0}
        multiplier = float(config.get("late_fee_multiplier", 2.0))
        late_fee = _round(original_hourly_rate * multiplier * billable_hours)
        split = config.get("late_fee_split") or {"host": 0.5, "platform": 0.5}
        host_share = _round(late_fee * float(split.get("host", 0.5)))
        platform_share = _round(late_fee - host_share)
        return {
            "billable_hours": billable_hours,
            "original_hourly_rate": original_hourly_rate,
            "late_fee_multiplier": multiplier,
            "late_fee": late_fee,
            "host_share": host_share,
            "platform_share": platform_share,
        }

    @classmethod
    def calculate_early_checkin(
        cls, *, original_hourly_rate: float, scheduled_start: datetime, actual_start: datetime, config: dict,
    ) -> dict:
        """Returns billable_hours=0 (free) when the early start falls inside
        the configured grace window, otherwise the ceil-rounded early hours
        charged at the ORIGINAL booking rate (never MAX_RATE - this is the
        customer's own already-booked time moved earlier, not new short-notice
        demand), split 50/50 with the host by default."""
        early_seconds = (scheduled_start - actual_start).total_seconds()
        if early_seconds <= 0:
            return {"is_early": False, "billable_hours": 0, "within_grace": True, "charge": 0.0, "host_share": 0.0, "platform_share": 0.0}
        grace_seconds = float(config.get("early_checkin_grace_minutes", 30)) * 60
        if early_seconds <= grace_seconds:
            return {"is_early": True, "billable_hours": 0, "within_grace": True, "charge": 0.0, "host_share": 0.0, "platform_share": 0.0}
        billable_hours = math.ceil(early_seconds / 3600)
        charge = _round(original_hourly_rate * billable_hours)
        split = config.get("early_checkin_split") or {"host": 0.5, "platform": 0.5}
        host_share = _round(charge * float(split.get("host", 0.5)))
        platform_share = _round(charge - host_share)
        return {
            "is_early": True,
            "billable_hours": billable_hours,
            "within_grace": False,
            "original_hourly_rate": original_hourly_rate,
            "charge": charge,
            "host_share": host_share,
            "platform_share": platform_share,
        }
