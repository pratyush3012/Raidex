import pytest

import server
from test_quality_flows import USER, fake_db  # noqa: F401

OWNER = {**USER, "user_id": "usr_owner_1", "email": "owner@example.com", "roles": ["owner"]}
OTHER_OWNER_ID = "usr_owner_2"


def _extension(**overrides):
    base = {
        "extension_id": "ext_1", "booking_id": "bkg_1", "vehicle_id": "veh_1",
        "owner_id": OWNER["user_id"], "user_id": USER["user_id"],
        "old_end_date": "2026-01-01T10:00:00Z", "new_end_date": "2026-01-01T14:00:00Z",
        "extension_hours": 4, "original_hourly_rate": 100.0, "extension_hourly_rate": 150.0,
        "extension_amount": 600.0, "tax": 108.0, "total_payable": 708.0,
        "host_extension_payout": 400.0, "platform_extension_revenue": 200.0,
        "created_at": "2026-01-01T10:00:00Z",
    }
    base.update(overrides)
    return base


def _late_fee(**overrides):
    base = {
        "late_fee_id": "lf_1", "booking_id": "bkg_1", "owner_id": OWNER["user_id"], "user_id": USER["user_id"],
        "scheduled_return": "2026-01-01T10:00:00Z", "actual_return": "2026-01-01T12:00:00Z",
        "billable_hours": 2, "original_hourly_rate": 100.0, "late_fee_multiplier": 2.0,
        "late_fee": 400.0, "host_share": 200.0, "platform_share": 200.0,
        "payment_status": "paid", "created_at": "2026-01-01T12:00:00Z",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_owner_extension_earnings_scopes_to_calling_owner_and_sums_payout(fake_db):
    fake_db.booking_extensions.docs.append(_extension())
    fake_db.booking_extensions.docs.append(_extension(extension_id="ext_2", host_extension_payout=150.0))
    # Another owner's extension must never leak into this owner's totals.
    fake_db.booking_extensions.docs.append(_extension(extension_id="ext_3", owner_id=OTHER_OWNER_ID, host_extension_payout=999.0))

    result = await server.owner_extension_earnings(OWNER)

    assert result["count"] == 2
    assert {item["extension_id"] for item in result["items"]} == {"ext_1", "ext_2"}
    assert result["total_earned"] == pytest.approx(550.0)


@pytest.mark.asyncio
async def test_owner_extension_earnings_requires_owner_role(fake_db):
    with pytest.raises(server.HTTPException) as exc:
        await server.owner_extension_earnings(USER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_owner_late_fee_earnings_only_totals_paid_fees_but_returns_all(fake_db):
    fake_db.late_fees.docs.append(_late_fee())
    fake_db.late_fees.docs.append(_late_fee(late_fee_id="lf_2", payment_status="due", host_share=300.0))
    # Another owner's late fee must never leak into this owner's totals.
    fake_db.late_fees.docs.append(_late_fee(late_fee_id="lf_3", owner_id=OTHER_OWNER_ID, host_share=999.0))

    result = await server.owner_late_fee_earnings(OWNER)

    assert result["count"] == 2
    assert {item["late_fee_id"] for item in result["items"]} == {"lf_1", "lf_2"}
    assert result["total_earned"] == pytest.approx(200.0)
    assert result["total_due"] == pytest.approx(300.0)


@pytest.mark.asyncio
async def test_owner_late_fee_earnings_requires_owner_role(fake_db):
    with pytest.raises(server.HTTPException) as exc:
        await server.owner_late_fee_earnings(USER)
    assert exc.value.status_code == 403
