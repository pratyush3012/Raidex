"""Payment gateway abstraction.

Current impl: `MockGateway` — deterministic 95% success, 1.5s simulated latency.
Switch to Razorpay: set env `PAYMENT_PROVIDER=razorpay` and provide:
  - RAZORPAY_KEY_ID
  - RAZORPAY_KEY_SECRET
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import random
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class PaymentOrder:
    order_id: str
    amount: float
    currency: str
    provider: str
    provider_order_id: Optional[str] = None  # Razorpay's own order id


@dataclass
class PaymentResult:
    success: bool
    provider_payment_id: Optional[str]
    provider_signature: Optional[str]
    failure_reason: Optional[str]


@dataclass
class RefundResult:
    success: bool
    refund_amount: float
    failure_reason: Optional[str]


class PaymentGateway(ABC):
    """Provider-agnostic payment interface."""

    name: str = "abstract"

    @abstractmethod
    async def create_order(
        self, *, amount: float, currency: str = "INR", meta: dict | None = None
    ) -> PaymentOrder: ...

    @abstractmethod
    async def confirm(
        self,
        *,
        order_id: str,
        provider_payment_id: str | None = None,
        provider_signature: str | None = None,
    ) -> PaymentResult: ...

    @abstractmethod
    async def refund(self, *, provider_payment_id: str, amount: float) -> RefundResult: ...


# ── Mock ────────────────────────────────────────────────────────────────────

class MockGateway(PaymentGateway):
    name = "mock"

    async def create_order(
        self, *, amount: float, currency: str = "INR", meta: dict | None = None
    ) -> PaymentOrder:
        await asyncio.sleep(0.2)
        oid = "order_mock_" + uuid.uuid4().hex[:12]
        return PaymentOrder(
            order_id=oid,
            amount=amount,
            currency=currency,
            provider=self.name,
            provider_order_id=oid,
        )

    async def confirm(
        self,
        *,
        order_id: str,
        provider_payment_id: str | None = None,
        provider_signature: str | None = None,
    ) -> PaymentResult:
        await asyncio.sleep(1.2)
        ok = random.random() < 0.95
        if ok:
            return PaymentResult(
                success=True,
                provider_payment_id=provider_payment_id or ("pay_mock_" + uuid.uuid4().hex[:12]),
                provider_signature=provider_signature or "sig_mock",
                failure_reason=None,
            )
        return PaymentResult(
            success=False,
            provider_payment_id=None,
            provider_signature=None,
            failure_reason=random.choice([
                "Card declined by issuer",
                "Insufficient funds",
                "Network timeout — please retry",
            ]),
        )

    async def refund(self, *, provider_payment_id: str, amount: float) -> RefundResult:
        await asyncio.sleep(0.6)
        return RefundResult(success=True, refund_amount=amount, failure_reason=None)


# ── Razorpay ─────────────────────────────────────────────────────────────────

class RazorpayGateway(PaymentGateway):
    """
    Real Razorpay integration.

    Env vars required:
        RAZORPAY_KEY_ID      — rzp_test_xxxxxxxxxxxx  (or rzp_live_…)
        RAZORPAY_KEY_SECRET  — your Razorpay secret

    Flow:
      1. create_order  → POST /orders                → returns Razorpay order_id
      2. Client opens Razorpay checkout with order_id  (handled in frontend)
      3. confirm       → server-side signature verify  (no extra HTTP call needed)
      4. refund        → POST /payments/{id}/refund
    """

    name = "razorpay"
    BASE = "https://api.razorpay.com/v1"

    def __init__(self) -> None:
        self.key_id = os.environ["RAZORPAY_KEY_ID"]
        self.key_secret = os.environ["RAZORPAY_KEY_SECRET"]
        self._auth = (self.key_id, self.key_secret)

    async def create_order(
        self, *, amount: float, currency: str = "INR", meta: dict | None = None
    ) -> PaymentOrder:
        import httpx

        # Razorpay expects amount in paise (smallest unit)
        paise = int(amount * 100)
        payload = {
            "amount": paise,
            "currency": currency,
            "receipt": "rcpt_" + uuid.uuid4().hex[:10],
            "notes": meta or {},
        }
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                f"{self.BASE}/orders",
                json=payload,
                auth=self._auth,
            )
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Razorpay create_order failed: {r.text}")
        data = r.json()
        return PaymentOrder(
            order_id=data["id"],           # e.g. order_xxxxxxxxxxxx
            amount=amount,
            currency=currency,
            provider=self.name,
            provider_order_id=data["id"],
        )

    async def confirm(
        self,
        *,
        order_id: str,
        provider_payment_id: str | None = None,
        provider_signature: str | None = None,
    ) -> PaymentResult:
        """
        Verify the HMAC-SHA256 signature that Razorpay checkout sends back.

        provider_payment_id  = razorpay_payment_id  (from checkout callback)
        provider_signature   = razorpay_signature   (from checkout callback)
        order_id             = razorpay_order_id
        """
        if not provider_payment_id or not provider_signature:
            return PaymentResult(
                success=False,
                provider_payment_id=None,
                provider_signature=None,
                failure_reason="Missing payment_id or signature from checkout",
            )
        try:
            body = f"{order_id}|{provider_payment_id}"
            expected = hmac.new(
                self.key_secret.encode(), body.encode(), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(expected, provider_signature):
                return PaymentResult(
                    success=False,
                    provider_payment_id=provider_payment_id,
                    provider_signature=provider_signature,
                    failure_reason="Signature verification failed",
                )
            return PaymentResult(
                success=True,
                provider_payment_id=provider_payment_id,
                provider_signature=provider_signature,
                failure_reason=None,
            )
        except Exception as exc:
            return PaymentResult(
                success=False,
                provider_payment_id=None,
                provider_signature=None,
                failure_reason=str(exc),
            )

    async def refund(self, *, provider_payment_id: str, amount: float) -> RefundResult:
        import httpx

        paise = int(amount * 100)
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.post(
                f"{self.BASE}/payments/{provider_payment_id}/refund",
                json={"amount": paise},
                auth=self._auth,
            )
        if r.status_code not in (200, 201):
            return RefundResult(
                success=False,
                refund_amount=0,
                failure_reason=f"Razorpay refund failed: {r.text}",
            )
        data = r.json()
        return RefundResult(
            success=True,
            refund_amount=data.get("amount", paise) / 100,
            failure_reason=None,
        )


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: PaymentGateway | None = None


def get_payment_gateway() -> PaymentGateway:
    global _singleton
    if _singleton is None:
        provider = os.getenv("PAYMENT_PROVIDER", "mock").lower()
        if provider == "razorpay":
            _singleton = RazorpayGateway()
        else:
            _singleton = MockGateway()
    return _singleton
