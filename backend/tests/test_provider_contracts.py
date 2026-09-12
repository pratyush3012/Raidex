import asyncio
import random

import pytest

from providers.damage_inspector import InspectionInput, StubInspector
from providers.kyc_provider import KYCSubmission, StubKYCProvider
from providers.sms_provider import (
    MockSMSProvider,
    MSG91Provider,
    get_sms_provider,
    reset_sms_provider,
)


def run(coro):
    return asyncio.run(coro)


async def noop_sleep(*_args, **_kwargs):
    return None


def kyc_submission(**overrides):
    base = {
        "aadhaar_front": "front",
        "aadhaar_back": "back",
        "aadhaar_last4": "1234",
        "dl_front": "dl_front",
        "dl_back": "dl_back",
        "dl_number": "DL123456",
        "dl_expiry": "2030-01-01",
        "face_selfie": "selfie",
    }
    base.update(overrides)
    return KYCSubmission(**base)


def test_stub_kyc_verifies_complete_submission(monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", noop_sleep)
    result = run(StubKYCProvider().verify(kyc_submission()))
    assert result.status == "verified"
    assert result.provider == "stub"


def test_stub_kyc_rejects_missing_docs(monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", noop_sleep)
    result = run(StubKYCProvider().verify(kyc_submission(aadhaar_front="")))
    assert result.status == "rejected"
    assert "Missing" in result.rejection_reason


def test_stub_kyc_rejects_short_dl(monkeypatch):
    monkeypatch.setattr(asyncio, "sleep", noop_sleep)
    result = run(StubKYCProvider().verify(kyc_submission(dl_number="DL1")))
    assert result.status == "rejected"
    assert "DL number" in result.rejection_reason


@pytest.mark.asyncio
async def test_stub_damage_inspector_flags_reported_damage(monkeypatch):
    monkeypatch.setattr(random, "uniform", lambda *_args: 0.05)
    previous = InspectionInput(photos=["a"] * 6, video=None, odometer=100, fuel_level="full")
    current = InspectionInput(
        photos=["a"] * 6,
        video=None,
        odometer=140,
        fuel_level="half",
        notes="new dent and scratch",
        previous_input=previous,
    )

    result = await StubInspector().score(current)

    assert result.ai_score > 0.25
    assert result.findings[0]["label"] == "user-reported damage"
    assert result.comparison["km_traveled"] == 40
    assert result.comparison["verdict"] == "review_required"


# ── SMS provider ─────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_sms_singleton():
    reset_sms_provider()
    yield
    reset_sms_provider()


def test_mock_sms_provider_is_deterministic_and_never_hits_network():
    provider = MockSMSProvider()
    result = run(provider.send_otp("+919876543210", "123456"))
    assert provider.is_mock is True
    assert result.sent is True
    assert result.provider == "mock"
    # deterministic given the same phone+otp - no randomness, no real send
    result2 = run(provider.send_otp("+919876543210", "123456"))
    assert result.message_id == result2.message_id


def test_msg91_provider_requires_credentials():
    with pytest.raises(KeyError):
        MSG91Provider()


def test_msg91_provider_is_not_mock(monkeypatch):
    monkeypatch.setenv("MSG91_API_KEY", "key")
    monkeypatch.setenv("MSG91_SENDER_ID", "RAIDEX")
    monkeypatch.setenv("MSG91_TEMPLATE_ID", "tmpl123")
    provider = MSG91Provider()
    assert provider.is_mock is False
    assert provider.name == "msg91"


def test_get_sms_provider_defaults_to_mock(monkeypatch):
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    provider = get_sms_provider()
    assert isinstance(provider, MockSMSProvider)
    assert provider.is_mock is True


def test_get_sms_provider_selects_msg91_from_env(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "msg91")
    monkeypatch.setenv("MSG91_API_KEY", "key")
    monkeypatch.setenv("MSG91_SENDER_ID", "RAIDEX")
    monkeypatch.setenv("MSG91_TEMPLATE_ID", "tmpl123")
    provider = get_sms_provider()
    assert isinstance(provider, MSG91Provider)
    assert provider.is_mock is False


@pytest.mark.asyncio
async def test_msg91_provider_sends_via_http(monkeypatch):
    monkeypatch.setenv("MSG91_API_KEY", "key")
    monkeypatch.setenv("MSG91_SENDER_ID", "RAIDEX")
    monkeypatch.setenv("MSG91_TEMPLATE_ID", "tmpl123")
    provider = MSG91Provider()

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"type": "success", "message": "req-123"}

    class FakeAsyncClient:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def post(self, url, params=None, headers=None):
            assert params["otp"] == "654321"
            assert params["mobile"] == "919876543210"  # no leading '+'
            assert headers["authkey"] == "key"
            return FakeResponse()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    result = await provider.send_otp("+919876543210", "654321")
    assert result.sent is True
    assert result.provider == "msg91"
    assert result.message_id == "req-123"
