"""
Regression tests for the SMS OTP provider abstraction (P0-3):
- SMS_PROVIDER selection mirrors the KYC_PROVIDER/PAYMENT_PROVIDER pattern.
- `dev_otp` is a local-dev-only convenience: it must never appear in the
  /auth/phone/request-otp response once a real (non-mock) provider is
  configured, and never at all when ENV is production/staging.
"""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from providers.sms_provider import MockSMSProvider, SMSResult
from test_quality_flows import fake_db  # noqa: F401


def _client():
    return TestClient(server.app, raise_server_exceptions=False)


class FakeRealProvider:
    """Stands in for a configured MSG91Provider without making HTTP calls."""

    name = "msg91"
    is_mock = False

    async def send_otp(self, phone, otp):
        return SMSResult(sent=True, provider=self.name, message_id="req-123")


class FakeFailingRealProvider:
    name = "msg91"
    is_mock = False

    async def send_otp(self, phone, otp):
        return SMSResult(sent=False, provider=self.name, error="gateway down")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("ENV", raising=False)
    yield


def test_request_otp_includes_dev_otp_with_mock_provider(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_sms_provider", lambda: MockSMSProvider())
    res = _client().post("/api/auth/phone/request-otp", json={"phone": "+919876543210"})
    assert res.status_code == 200
    body = res.json()
    assert "dev_otp" in body
    assert len(body["dev_otp"]) == 6
    assert body["dev_otp"].isdigit()


def test_request_otp_never_leaks_dev_otp_with_real_provider(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_sms_provider", lambda: FakeRealProvider())
    res = _client().post("/api/auth/phone/request-otp", json={"phone": "+919876543211"})
    assert res.status_code == 200
    assert "dev_otp" not in res.json()


def test_request_otp_never_leaks_dev_otp_in_production_even_with_mock(fake_db, monkeypatch):
    # Defense in depth: even if SMS_PROVIDER were somehow left as mock in
    # production, the response must never carry dev_otp.
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setattr(server, "get_sms_provider", lambda: MockSMSProvider())
    res = _client().post("/api/auth/phone/request-otp", json={"phone": "+919876543212"})
    assert res.status_code == 200
    assert "dev_otp" not in res.json()


def test_request_otp_succeeds_even_if_real_provider_send_fails(fake_db, monkeypatch):
    # OTP is already persisted server-side before delivery is attempted, so a
    # provider-side send failure must not break the request/verify flow or
    # leak the code back to the client.
    monkeypatch.setattr(server, "get_sms_provider", lambda: FakeFailingRealProvider())
    res = _client().post("/api/auth/phone/request-otp", json={"phone": "+919876543213"})
    assert res.status_code == 200
    assert "dev_otp" not in res.json()
    assert "challenge_id" in res.json()


def test_get_sms_provider_selection_matches_env_var(monkeypatch):
    """SMS_PROVIDER selection mirrors the KYC_PROVIDER/PAYMENT_PROVIDER pattern:
    unset/unknown -> mock, 'msg91' -> the real provider."""
    from providers.sms_provider import MSG91Provider, get_sms_provider, reset_sms_provider

    reset_sms_provider()
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    assert isinstance(get_sms_provider(), MockSMSProvider)

    reset_sms_provider()
    monkeypatch.setenv("SMS_PROVIDER", "msg91")
    monkeypatch.setenv("MSG91_API_KEY", "key")
    monkeypatch.setenv("MSG91_SENDER_ID", "RAIDEX")
    monkeypatch.setenv("MSG91_TEMPLATE_ID", "tmpl123")
    assert isinstance(get_sms_provider(), MSG91Provider)
    reset_sms_provider()
