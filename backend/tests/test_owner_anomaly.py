import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from providers.ai_provider import AIProvider, StubAIProvider, get_ai_provider, reset_ai_provider
from cron import owner_anomaly
from test_quality_flows import fake_db, vehicle  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_ai_provider_singleton(monkeypatch):
    reset_ai_provider()
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    yield
    reset_ai_provider()


class FakeRealProvider(AIProvider):
    name = "fake_real"

    def __init__(self, reply: str):
        self.reply = reply

    async def chat(self, *, system, history, message):
        return self.reply


@pytest.mark.asyncio
async def test_anomaly_check_skips_cleanly_when_no_ai_provider_configured(fake_db):
    # This replaces the old emergentintegrations ImportError-swallowed-forever
    # failure mode: with no real provider configured, the job must skip
    # visibly (no crash, no fabricated anomaly) rather than silently no-op.
    assert get_ai_provider().name == "stub"
    result = await owner_anomaly._run_anomaly_check(fake_db, "usr_owner", "Owner")
    assert result is None


@pytest.mark.asyncio
async def test_anomaly_check_surfaces_a_real_anomaly_and_logs_the_run(fake_db, monkeypatch):
    monkeypatch.setattr(owner_anomaly, "get_ai_provider", lambda: FakeRealProvider("Vehicle X has been idle for 14 days."))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id="usr_owner"))

    result = await owner_anomaly._run_anomaly_check(fake_db, "usr_owner", "Owner")
    assert result == "Vehicle X has been idle for 14 days."
    assert len(fake_db.agent_runs.docs) == 1
    assert fake_db.agent_runs.docs[0]["model"] == "fake_real"
    assert fake_db.agent_runs.docs[0]["error"] is None


@pytest.mark.asyncio
async def test_anomaly_check_returns_none_on_no_anomaly_reply(fake_db, monkeypatch):
    monkeypatch.setattr(owner_anomaly, "get_ai_provider", lambda: FakeRealProvider("NO_ANOMALY"))
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id="usr_owner"))

    result = await owner_anomaly._run_anomaly_check(fake_db, "usr_owner", "Owner")
    assert result is None


@pytest.mark.asyncio
async def test_run_owner_anomaly_cron_notifies_owners_with_real_anomalies(fake_db, monkeypatch):
    monkeypatch.setattr(owner_anomaly, "get_ai_provider", lambda: FakeRealProvider("Revenue down 40% this week."))
    fake_db.users.docs.append({"user_id": "usr_owner", "name": "Owner", "role": "owner", "roles": ["owner"]})
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", owner_id="usr_owner"))

    await owner_anomaly.run_owner_anomaly_cron(fake_db)

    assert any(n["type"] == "owner_anomaly" for n in fake_db.notifications.docs)
