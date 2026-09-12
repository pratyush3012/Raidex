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
from providers.ai_provider import reset_ai_provider
from providers.gps_provider import reset_gps_provider
from test_quality_flows import USER, fake_db  # noqa: F401

ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}


@pytest.fixture(autouse=True)
def _reset_singletons(monkeypatch):
    reset_ai_provider()
    reset_gps_provider()
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    yield
    reset_ai_provider()
    reset_gps_provider()


@pytest.mark.asyncio
async def test_system_health_is_admin_only(fake_db):
    with pytest.raises(HTTPException) as exc:
        await server.admin_system_health(USER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_system_health_reports_provider_status_without_crashing(fake_db):
    # This endpoint previously referenced an undefined `EMERGENT_LLM_KEY` name
    # (a NameError on every real request) once the emergentintegrations
    # dependency was removed - this guards against that regression.
    health = await server.admin_system_health(ADMIN)
    assert health["database"] == "connected"
    assert health["gps_provider"] == "phone_gps"
    assert health["llm_configured"] is False  # no AI provider configured in tests
