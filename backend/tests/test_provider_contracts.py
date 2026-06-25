import asyncio
import random

import pytest

from providers.damage_inspector import InspectionInput, StubInspector
from providers.kyc_provider import KYCSubmission, StubKYCProvider


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
