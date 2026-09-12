import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from raidex_platform.reconciliation import LedgerReconciliationService
from test_quality_flows import fake_db  # noqa: F401

ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}


@pytest.mark.asyncio
async def test_reports_healthy_when_ledger_matches_cached_balance(fake_db):
    fake_db.users.docs.clear()  # fake_db seeds a default USER doc - not relevant to this check
    fake_db.users.docs.append({"user_id": "usr_recon_1", "wallet_balance": 150.0, "ride_miles": 50})
    fake_db.wallet_ledger.docs.extend([
        {"user_id": "usr_recon_1", "delta": 100.0}, {"user_id": "usr_recon_1", "delta": 50.0},
    ])
    fake_db.ride_miles_ledger.docs.extend([
        {"user_id": "usr_recon_1", "delta": 30}, {"user_id": "usr_recon_1", "delta": 20},
    ])
    report = await LedgerReconciliationService(fake_db).full_report()
    assert report["status"] == "healthy"
    assert report["wallet"]["issue_count"] == 0
    assert report["ride_miles"]["issue_count"] == 0


@pytest.mark.asyncio
async def test_detects_wallet_balance_mismatch(fake_db):
    fake_db.users.docs.clear()
    fake_db.users.docs.append({"user_id": "usr_recon_1", "wallet_balance": 999.0, "ride_miles": 0})
    fake_db.wallet_ledger.docs.append({"user_id": "usr_recon_1", "delta": 100.0})
    report = await LedgerReconciliationService(fake_db).reconcile_wallets()
    assert report["status"] == "mismatch"
    assert report["issues"][0]["cached_balance"] == 999.0
    assert report["issues"][0]["ledger_sum"] == 100.0


@pytest.mark.asyncio
async def test_detects_negative_balance(fake_db):
    fake_db.users.docs.clear()
    fake_db.users.docs.append({"user_id": "usr_recon_1", "wallet_balance": -50.0, "ride_miles": 0})
    fake_db.wallet_ledger.docs.append({"user_id": "usr_recon_1", "delta": -50.0})
    report = await LedgerReconciliationService(fake_db).reconcile_wallets()
    assert any(i["issue"] == "negative_balance" for i in report["issues"])


@pytest.mark.asyncio
async def test_admin_endpoint_requires_admin_role(fake_db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await server.admin_reconciliation({"user_id": "usr_recon_1", "role": "customer", "roles": ["customer"]})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_endpoint_returns_full_report(fake_db):
    fake_db.users.docs.clear()
    fake_db.users.docs.append({"user_id": "usr_recon_1", "wallet_balance": 0, "ride_miles": 0})
    report = await server.admin_reconciliation(ADMIN)
    assert report["status"] == "healthy"
