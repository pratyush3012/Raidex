import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from test_quality_flows import USER, fake_db  # noqa: F401

OTHER_USER = {**USER, "user_id": "usr_other"}


@pytest.mark.asyncio
async def test_wallet_ledger_history_returns_only_the_caller_own_entries(fake_db):
    fake_db.wallet_ledger.docs.extend([
        {"user_id": USER["user_id"], "delta": 100.0, "reason": "topup", "created_at": "2026-01-01T00:00:00+00:00"},
        {"user_id": USER["user_id"], "delta": -20.0, "reason": "refund", "created_at": "2026-01-02T00:00:00+00:00"},
        {"user_id": "usr_other", "delta": 500.0, "reason": "topup", "created_at": "2026-01-01T00:00:00+00:00"},
    ])
    history = await server.wallet_ledger_history(USER)
    assert len(history) == 2
    assert all(h["user_id"] == USER["user_id"] for h in history)


@pytest.mark.asyncio
async def test_ride_miles_ledger_history_returns_only_the_caller_own_entries(fake_db):
    fake_db.ride_miles_ledger.docs.extend([
        {"user_id": USER["user_id"], "delta": 50, "reason": "booking", "created_at": "2026-01-01T00:00:00+00:00"},
        {"user_id": "usr_other", "delta": 250, "reason": "booking", "created_at": "2026-01-01T00:00:00+00:00"},
    ])
    history = await server.ride_miles_ledger_history(USER)
    assert len(history) == 1
    assert history[0]["user_id"] == USER["user_id"]
