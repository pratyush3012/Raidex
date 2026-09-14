import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from raidex_platform.pricing_engine import DEFAULT_CONFIG, PricingEngine, derive_default_rate_range


def cfg(**overrides):
    merged = dict(DEFAULT_CONFIG)
    merged.update(overrides)
    return merged


# ---------- Rate range / duration + lead-time curve ----------

def test_rate_never_leaves_vehicle_min_max_across_wide_input_range():
    config = cfg()
    for duration_hours in (0, 1, 6, 6.01, 24, 48, 48.01, 500):
        for lead_time_hours in (0, 1, 2, 2.01, 100, 168, 168.01, 5000):
            calc = PricingEngine.calculate_rate(
                min_rate=80, max_rate=110, duration_hours=duration_hours, lead_time_hours=lead_time_hours,
                min_booking_hours=6, min_notice_hours=2, config=config,
            )
            assert 80 <= calc["hourly_rate"] <= 110


def test_minimum_duration_and_notice_price_at_max_rate():
    config = cfg()
    calc = PricingEngine.calculate_rate(
        min_rate=80, max_rate=110, duration_hours=6, lead_time_hours=2,
        min_booking_hours=6, min_notice_hours=2, config=config,
    )
    assert calc["duration_factor"] == 0
    assert calc["lead_time_factor"] == 0
    assert calc["hourly_rate"] == 110


def test_long_duration_and_lead_time_price_at_min_rate():
    config = cfg()
    calc = PricingEngine.calculate_rate(
        min_rate=80, max_rate=110, duration_hours=48, lead_time_hours=168,
        min_booking_hours=6, min_notice_hours=2, config=config,
    )
    assert calc["duration_factor"] == 1
    assert calc["lead_time_factor"] == 1
    assert calc["hourly_rate"] == 80


def test_derive_default_rate_range_uses_existing_price_as_the_ceiling():
    min_rate, max_rate = derive_default_rate_range(100)
    assert max_rate == 100
    assert min_rate == 75


# ---------- Extension pricing ----------

def test_extension_charges_customer_max_rate_but_pays_host_original_rate():
    config = cfg(tax={"enabled": False, "rate": 0, "inclusive": False})
    calc = PricingEngine.calculate_extension_price(
        original_hourly_rate=86, max_hourly_rate=110, extension_hours=3, config=config,
    )
    assert calc["extension_amount"] == 330  # 110 * 3, NOT 86 * 3
    assert calc["host_extension_payout"] == 258  # 86 * 3 - the ORIGINAL rate
    assert calc["platform_extension_revenue"] == pytest.approx(72, abs=0.01)


# ---------- Late fee ----------

@pytest.mark.parametrize("late_minutes,expected_billable_hours", [
    (1, 1), (30, 1), (59, 1), (61, 2), (120, 2), (121, 3),
])
def test_any_positive_late_duration_bills_at_least_one_ceil_rounded_hour(late_minutes, expected_billable_hours):
    scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
    actual = scheduled + timedelta(minutes=late_minutes)
    assert PricingEngine.billable_late_hours(scheduled, actual) == expected_billable_hours


def test_on_time_or_early_return_has_no_late_fee():
    scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert PricingEngine.billable_late_hours(scheduled, scheduled) == 0
    assert PricingEngine.billable_late_hours(scheduled, scheduled - timedelta(minutes=5)) == 0


def test_late_fee_is_original_rate_times_two_split_50_50():
    scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
    actual = scheduled + timedelta(minutes=1)
    calc = PricingEngine.calculate_late_fee(original_hourly_rate=86, scheduled_end=scheduled, actual_end=actual, config=cfg())
    assert calc["billable_hours"] == 1
    assert calc["late_fee"] == 172  # 86 * 2 * 1
    assert calc["host_share"] == 86
    assert calc["platform_share"] == 86


# ---------- Early check-in ----------

def test_early_checkin_within_grace_is_free():
    scheduled = datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc)
    for early_minutes in (0, 15, 30):
        actual = scheduled - timedelta(minutes=early_minutes)
        calc = PricingEngine.calculate_early_checkin(original_hourly_rate=86, scheduled_start=scheduled, actual_start=actual, config=cfg())
        assert calc["billable_hours"] == 0
        assert calc["charge"] == 0


def test_early_checkin_beyond_grace_charges_original_rate_split_50_50():
    scheduled = datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc)
    actual = scheduled - timedelta(hours=1)  # 31+ minutes beyond the 30-minute grace
    calc = PricingEngine.calculate_early_checkin(original_hourly_rate=86, scheduled_start=scheduled, actual_start=actual, config=cfg())
    assert calc["is_early"] is True
    assert calc["within_grace"] is False
    assert calc["billable_hours"] == 1
    assert calc["charge"] == 86  # ORIGINAL rate, never MAX_RATE
    assert calc["host_share"] == 43
    assert calc["platform_share"] == 43


def test_starting_at_or_after_scheduled_time_is_not_early():
    scheduled = datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc)
    calc = PricingEngine.calculate_early_checkin(original_hourly_rate=86, scheduled_start=scheduled, actual_start=scheduled, config=cfg())
    assert calc["is_early"] is False


# ---------- Tax ----------

def test_tax_disabled_yields_zero():
    result = PricingEngine.calculate_tax(1000, cfg(tax={"enabled": False, "rate": 0.18, "inclusive": False}))
    assert result["amount"] == 0


def test_tax_exclusive_adds_on_top():
    result = PricingEngine.calculate_tax(1000, cfg(tax={"enabled": True, "rate": 0.18, "inclusive": False}))
    assert result["amount"] == 180


def test_tax_inclusive_backs_out_rather_than_double_charging():
    result = PricingEngine.calculate_tax(1180, cfg(tax={"enabled": True, "rate": 0.18, "inclusive": True}))
    assert result["amount"] == pytest.approx(180, abs=0.01)


# ---------- Full booking price breakdown ----------

def test_full_booking_price_matches_spec_worked_example():
    """WagonR-style example from the spec: 12h booking landing at a rate
    between the vehicle's min/max, with an 80/20 host/platform split of the
    base rental only (never fees/tax/deposit)."""
    vehicle = {"vehicle_id": "veh_1", "min_hourly_rate": 80, "max_hourly_rate": 110, "deposit": 3000}
    config = cfg()
    result = PricingEngine.calculate_booking_price(
        vehicle=vehicle, duration_hours=12, lead_time_hours=2, min_booking_hours=6, config=config,
    )
    assert 80 <= result["calculated_hourly_rate"] <= 110
    assert result["rental_subtotal"] == round(result["calculated_hourly_rate"] * 12, 2)
    assert result["platform_fee"] == round(result["rental_subtotal"] * 0.10, 2)
    assert result["host_payout"] == round(result["rental_subtotal"] * 0.80, 2)
    assert result["platform_commission"] == round(result["rental_subtotal"] - result["host_payout"], 2)
    # host_payout + platform_commission must reconcile back to the full base rental
    assert round(result["host_payout"] + result["platform_commission"], 2) == result["rental_subtotal"]
    assert result["total_payable"] == round(result["rental_subtotal"] + result["platform_fee"] + result["tax"], 2)
    assert result["security_deposit"] == 3000
