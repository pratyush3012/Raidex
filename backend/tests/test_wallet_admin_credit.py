import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from test_quality_flows import USER, fake_db  # noqa: F401

ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"], "wallet_balance": 0}


@pytest.mark.asyncio
async def test_admin_credit_targets_the_customer_not_the_admin(fake_db):
    fake_db.users.docs.append(dict(USER))
    fake_db.users.docs.append(dict(ADMIN))

    result = await server.topup_wallet(
        server.WalletTopupRequest(target_user_id=USER["user_id"], amount=250, reason="Goodwill credit for delayed pickup"),
        ADMIN,
    )
    assert result["new_balance"] == USER["wallet_balance"] + 250

    admin_doc = next(u for u in fake_db.users.docs if u["user_id"] == ADMIN["user_id"])
    customer_doc = next(u for u in fake_db.users.docs if u["user_id"] == USER["user_id"])
    assert admin_doc["wallet_balance"] == 0  # admin's own wallet must be untouched
    assert customer_doc["wallet_balance"] == USER["wallet_balance"] + 250


@pytest.mark.asyncio
async def test_admin_credit_rejects_non_admin(fake_db):
    fake_db.users.docs.append(dict(USER))
    with pytest.raises(HTTPException) as exc:
        await server.topup_wallet(
            server.WalletTopupRequest(target_user_id=USER["user_id"], amount=100, reason="test"),
            USER,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_credit_rejects_unknown_target(fake_db):
    with pytest.raises(HTTPException) as exc:
        await server.topup_wallet(
            server.WalletTopupRequest(target_user_id="usr_does_not_exist", amount=100, reason="test"),
            ADMIN,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_admin_credit_with_reference_is_idempotent(fake_db):
    fake_db.users.docs.append(dict(USER))
    payload = server.WalletTopupRequest(
        target_user_id=USER["user_id"], amount=100, reason="Duplicate ticket retry", reference="ticket_42",
    )
    first = await server.topup_wallet(payload, ADMIN)
    second = await server.topup_wallet(payload, ADMIN)

    assert first["new_balance"] == USER["wallet_balance"] + 100
    assert second["new_balance"] == first["new_balance"]
    assert second.get("deduped") is True
    # Only one ledger entry should exist for this reference.
    matching = [e for e in fake_db.wallet_ledger.docs if e.get("ref_id") == "ticket_42"]
    assert len(matching) == 1
