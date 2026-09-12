"""SMS / OTP delivery provider abstraction.

Current impl: `MockSMSProvider` — does not send any real SMS, never talks to the
network, and is the only provider allowed to expose `dev_otp` back to callers.
Switch to MSG91: set env `SMS_PROVIDER=msg91` and provide:
  - MSG91_API_KEY      — auth key from your MSG91 account
  - MSG91_SENDER_ID     — approved 6-char DLT sender id
  - MSG91_TEMPLATE_ID   — approved DLT OTP template id
  - MSG91_BASE_URL      (default: https://control.msg91.com)

Production boot (`ENV=production`/`staging`) refuses to start with
`SMS_PROVIDER` unset or `mock` — see `server.py::_validate_env`.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SMSResult:
    sent: bool
    provider: str
    message_id: Optional[str] = None
    error: Optional[str] = None


class SMSProvider(ABC):
    name: str = "abstract"

    # True only for the local/dev mock. Used by server.py to decide whether
    # `dev_otp` may ever be included in an API response — a real provider
    # must never leak the OTP back to the caller.
    is_mock: bool = False

    @abstractmethod
    async def send_otp(self, phone: str, otp: str) -> SMSResult: ...


# ── Mock (dev default) ────────────────────────────────────────────────────────

class MockSMSProvider(SMSProvider):
    """
    Safe, non-hallucinating dev fallback. Makes no network calls and never
    pretends an SMS actually reached a handset — it just records that the
    OTP would have been sent, so local/dev flows can read it back via
    `dev_otp` in the API response.
    """

    name = "mock"
    is_mock = True

    async def send_otp(self, phone: str, otp: str) -> SMSResult:
        return SMSResult(sent=True, provider=self.name, message_id=f"mock-{phone}-{otp}")


# ── MSG91 ──────────────────────────────────────────────────────────────────────

class MSG91Provider(SMSProvider):
    """
    MSG91 OTP API integration (India).
    Docs: https://docs.msg91.com/reference/send-otp

    Uses:
      - POST /api/v5/otp  to trigger a DLT-approved OTP template SMS.

    Env vars:
        MSG91_API_KEY      — auth key from your MSG91 account
        MSG91_SENDER_ID    — approved 6-char DLT sender id
        MSG91_TEMPLATE_ID  — approved DLT OTP template id
        MSG91_BASE_URL     — default: https://control.msg91.com
    """

    name = "msg91"

    def __init__(self) -> None:
        self.api_key = os.environ["MSG91_API_KEY"]
        self.sender_id = os.environ["MSG91_SENDER_ID"]
        self.template_id = os.environ["MSG91_TEMPLATE_ID"]
        self.base = os.getenv("MSG91_BASE_URL", "https://control.msg91.com").rstrip("/")

    @staticmethod
    def _mobile(phone: str) -> str:
        """MSG91 expects a bare country-code-prefixed number, no leading '+'."""
        return phone.lstrip("+")

    async def send_otp(self, phone: str, otp: str) -> SMSResult:
        import httpx

        async with httpx.AsyncClient(timeout=10) as cli:
            resp = await cli.post(
                f"{self.base}/api/v5/otp",
                params={
                    "otp": otp,
                    "mobile": self._mobile(phone),
                    "template_id": self.template_id,
                    "sender": self.sender_id,
                },
                headers={
                    "authkey": self.api_key,
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            return SMSResult(
                sent=False,
                provider=self.name,
                error=f"MSG91 request failed: {resp.text[:120]}",
            )
        try:
            data = resp.json()
        except ValueError:
            return SMSResult(sent=False, provider=self.name, error="MSG91 returned a non-JSON response")

        if data.get("type") != "success":
            return SMSResult(
                sent=False,
                provider=self.name,
                error=str(data.get("message", "MSG91 OTP send failed")),
            )
        return SMSResult(sent=True, provider=self.name, message_id=str(data.get("message")))


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: SMSProvider | None = None


def get_sms_provider() -> SMSProvider:
    global _singleton
    if _singleton is None:
        provider = os.getenv("SMS_PROVIDER", "mock").lower()
        if provider == "msg91":
            _singleton = MSG91Provider()
        else:
            _singleton = MockSMSProvider()
    return _singleton


def reset_sms_provider() -> None:
    """Test hook: clears the cached singleton so a changed SMS_PROVIDER env
    var takes effect on the next get_sms_provider() call."""
    global _singleton
    _singleton = None
