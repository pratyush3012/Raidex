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
from providers.ai_provider import StubAIProvider, get_ai_provider, reset_ai_provider
from test_quality_flows import USER, fake_db  # noqa: F401

ADMIN = {"user_id": "usr_admin", "email": "admin@raidex.io", "name": "Admin", "role": "admin", "roles": ["admin"]}


@pytest.fixture(autouse=True)
def _reset_ai_provider_singleton(monkeypatch):
    reset_ai_provider()
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    yield
    reset_ai_provider()


@pytest.mark.asyncio
async def test_stub_provider_is_selected_when_unconfigured():
    provider = get_ai_provider()
    assert isinstance(provider, StubAIProvider)
    assert provider.name == "stub"


@pytest.mark.asyncio
async def test_support_chat_replies_honestly_without_hallucinating(fake_db):
    result = await server.nexus_support(server.NexusChat(message="Do you have a subscription plan?"), USER)
    assert "thread_id" in result
    assert "not configured" in result["reply"].lower() or "human" in result["reply"].lower()
    # It must not claim the feature exists just because the user asked about it.
    assert "subscription" not in result["reply"].lower() or "not configured" in result["reply"].lower()


@pytest.mark.asyncio
async def test_support_system_prompt_omits_unreleased_features_by_default(fake_db):
    prompt = await server._support_system_prompt()
    assert "subscription" not in prompt.lower()
    assert "vehicle swap" not in prompt.lower()


@pytest.mark.asyncio
async def test_ops_and_finance_require_admin(fake_db):
    with pytest.raises(HTTPException) as exc:
        await server.nexus_ops(server.NexusChat(message="How many active trips?"), USER)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc2:
        await server.nexus_finance(server.NexusChat(message="What's our revenue?"), USER)
    assert exc2.value.status_code == 403


@pytest.mark.asyncio
async def test_finance_agent_works_for_admin(fake_db):
    result = await server.nexus_finance(server.NexusChat(message="Summarize revenue"), ADMIN)
    assert "thread_id" in result
    assert isinstance(result["reply"], str) and result["reply"]


@pytest.mark.asyncio
async def test_provider_failure_never_leaks_raw_exception_to_client(fake_db, monkeypatch):
    class BoomProvider:
        name = "boom"

        async def chat(self, **_kwargs):
            raise RuntimeError("super secret internal stack trace detail")

    monkeypatch.setattr(server, "get_ai_provider", lambda: BoomProvider())
    with pytest.raises(HTTPException) as exc:
        await server.nexus_support(server.NexusChat(message="hello"), USER)
    assert exc.value.status_code == 503
    assert "super secret" not in exc.value.detail

    run = fake_db.agent_runs.docs[-1]
    assert "super secret internal stack trace detail" in run["error"]  # still logged server-side


@pytest.mark.asyncio
async def test_nexus_health_reports_active_provider(fake_db):
    health = await server.nexus_health(ADMIN)
    assert health["provider"] == "stub"
    assert health["is_real_provider"] is False


@pytest.mark.asyncio
async def test_nexus_health_requires_admin(fake_db):
    with pytest.raises(HTTPException) as exc:
        await server.nexus_health(USER)
    assert exc.value.status_code == 403
