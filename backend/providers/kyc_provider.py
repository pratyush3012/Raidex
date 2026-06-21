"""KYC provider abstraction.

Current impl: `StubKYCProvider` — local field validation, ~3s simulated latency.
Switch to Karza: set env `KYC_PROVIDER=karza` and provide:
  - KARZA_API_KEY
  - KARZA_BASE_URL  (default: https://testapi.karza.in)

Switch to IDfy: set env `KYC_PROVIDER=idfy` and provide:
  - IDFY_ACCOUNT_ID
  - IDFY_API_KEY
  - IDFY_BASE_URL   (default: https://api.idfy.io)
"""

from __future__ import annotations

import asyncio
import os
import base64
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class KYCSubmission:
    aadhaar_front: str       # base64 data URI
    aadhaar_back: str
    aadhaar_last4: str
    dl_front: str
    dl_back: str
    dl_number: str
    dl_expiry: str
    face_selfie: str


@dataclass
class KYCResult:
    status: str              # 'verified' | 'rejected' | 'processing'
    face_match_score: Optional[float]
    liveness_score: Optional[float]
    rejection_reason: Optional[str]
    provider: str


class KYCProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    async def verify(self, sub: KYCSubmission) -> KYCResult: ...


# ── Stub ─────────────────────────────────────────────────────────────────────

class StubKYCProvider(KYCProvider):
    name = "stub"

    async def verify(self, sub: KYCSubmission) -> KYCResult:
        await asyncio.sleep(3.0)
        required = [
            sub.aadhaar_front, sub.aadhaar_back,
            sub.dl_front, sub.dl_back,
            sub.face_selfie, sub.dl_number,
        ]
        if not all(required):
            return KYCResult(
                status="rejected",
                face_match_score=None,
                liveness_score=None,
                rejection_reason="Missing one or more required documents",
                provider=self.name,
            )
        if len(sub.dl_number.strip()) < 6:
            return KYCResult(
                status="rejected",
                face_match_score=0.55,
                liveness_score=0.40,
                rejection_reason="DL number appears invalid",
                provider=self.name,
            )
        return KYCResult(
            status="verified",
            face_match_score=0.92,
            liveness_score=0.95,
            rejection_reason=None,
            provider=self.name,
        )


# ── Karza ─────────────────────────────────────────────────────────────────────

class KarzaProvider(KYCProvider):
    """
    Karza KYC integration (India).
    Docs: https://karza.in/docs

    Uses:
      - POST /v3/aadhaar-masking  for Aadhaar OCR + masking
      - POST /v3/dl               for Driving License OCR/verify
      - POST /v3/face-match       for selfie vs Aadhaar photo comparison

    Env vars:
        KARZA_API_KEY   — from your Karza account
        KARZA_BASE_URL  — default: https://testapi.karza.in (production: https://api.karza.in)
    """

    name = "karza"

    def __init__(self) -> None:
        self.api_key = os.environ["KARZA_API_KEY"]
        self.base = os.getenv("KARZA_BASE_URL", "https://testapi.karza.in").rstrip("/")
        self._headers = {
            "x-karza-key": self.api_key,
            "Content-Type": "application/json",
        }

    @staticmethod
    def _strip_prefix(b64_data_uri: str) -> str:
        """Strip 'data:image/jpeg;base64,' prefix if present."""
        if "," in b64_data_uri:
            return b64_data_uri.split(",", 1)[1]
        return b64_data_uri

    async def verify(self, sub: KYCSubmission) -> KYCResult:
        import httpx

        async with httpx.AsyncClient(timeout=30) as cli:
            # 1. Aadhaar OCR
            aadhaar_resp = await cli.post(
                f"{self.base}/v3/aadhaar-masking",
                headers=self._headers,
                json={
                    "image1": self._strip_prefix(sub.aadhaar_front),
                    "image2": self._strip_prefix(sub.aadhaar_back),
                },
            )
            if aadhaar_resp.status_code != 200:
                return KYCResult(
                    status="rejected",
                    face_match_score=None,
                    liveness_score=None,
                    rejection_reason=f"Aadhaar verification failed: {aadhaar_resp.text[:120]}",
                    provider=self.name,
                )
            aadhaar_data = aadhaar_resp.json()
            if aadhaar_data.get("statusCode") != 101:
                return KYCResult(
                    status="rejected",
                    face_match_score=None,
                    liveness_score=None,
                    rejection_reason=aadhaar_data.get("error", "Aadhaar OCR failed"),
                    provider=self.name,
                )

            # 2. Driving License verify
            dl_resp = await cli.post(
                f"{self.base}/v3/dl",
                headers=self._headers,
                json={
                    "dlNo": sub.dl_number.strip().upper(),
                    "dob": sub.dl_expiry or "",   # Karza uses dob field for DL lookup
                    "consent": "Y",
                    "image": self._strip_prefix(sub.dl_front),
                },
            )
            if dl_resp.status_code != 200:
                return KYCResult(
                    status="rejected",
                    face_match_score=None,
                    liveness_score=None,
                    rejection_reason=f"DL verification failed: {dl_resp.text[:120]}",
                    provider=self.name,
                )
            dl_data = dl_resp.json()
            if dl_data.get("statusCode") not in (101, 102):  # 102 = partial match
                return KYCResult(
                    status="rejected",
                    face_match_score=None,
                    liveness_score=None,
                    rejection_reason=dl_data.get("error", "DL not found or expired"),
                    provider=self.name,
                )

            # 3. Face match (selfie vs Aadhaar photo)
            face_resp = await cli.post(
                f"{self.base}/v3/face-match",
                headers=self._headers,
                json={
                    "image1": self._strip_prefix(sub.face_selfie),
                    "image2": self._strip_prefix(sub.aadhaar_front),
                },
            )
            face_score = 0.0
            if face_resp.status_code == 200:
                fd = face_resp.json()
                face_score = float(fd.get("data", {}).get("confidence", 0))

        if face_score < 0.70:
            return KYCResult(
                status="rejected",
                face_match_score=face_score,
                liveness_score=None,
                rejection_reason="Face does not match Aadhaar photo (score too low)",
                provider=self.name,
            )

        return KYCResult(
            status="verified",
            face_match_score=face_score,
            liveness_score=None,
            rejection_reason=None,
            provider=self.name,
        )


# ── IDfy ─────────────────────────────────────────────────────────────────────

class IDfyProvider(KYCProvider):
    """
    IDfy KYC integration (India).
    Docs: https://documentation.idfy.io

    Uses:
      - POST /tasks/sync/extract/ind_aadhaar for Aadhaar extraction
      - POST /tasks/sync/extract/ind_driving_license for DL extraction
      - POST /tasks/sync/verify/dl for DL government database verify
      - POST /tasks/sync/face/face_match for face comparison

    Env vars:
        IDFY_ACCOUNT_ID  — from IDfy dashboard
        IDFY_API_KEY     — from IDfy dashboard
        IDFY_BASE_URL    — default: https://api.idfy.io
    """

    name = "idfy"

    def __init__(self) -> None:
        self.account_id = os.environ["IDFY_ACCOUNT_ID"]
        self.api_key = os.environ["IDFY_API_KEY"]
        self.base = os.getenv("IDFY_BASE_URL", "https://api.idfy.io").rstrip("/")

    @property
    def _headers(self) -> dict:
        return {
            "api-key": self.api_key,
            "account-id": self.account_id,
            "Content-Type": "application/json",
        }

    @staticmethod
    def _strip_prefix(b64_data_uri: str) -> str:
        if "," in b64_data_uri:
            return b64_data_uri.split(",", 1)[1]
        return b64_data_uri

    async def verify(self, sub: KYCSubmission) -> KYCResult:
        import httpx

        async with httpx.AsyncClient(timeout=30) as cli:
            # 1. Aadhaar extraction
            aadh_resp = await cli.post(
                f"{self.base}/tasks/sync/extract/ind_aadhaar",
                headers=self._headers,
                json={
                    "document1": self._strip_prefix(sub.aadhaar_front),
                    "document2": self._strip_prefix(sub.aadhaar_back),
                },
            )
            if aadh_resp.status_code != 200:
                return KYCResult(
                    status="rejected",
                    face_match_score=None,
                    liveness_score=None,
                    rejection_reason=f"Aadhaar extraction failed: {aadh_resp.text[:120]}",
                    provider=self.name,
                )

            # 2. DL extraction + verify
            dl_extract = await cli.post(
                f"{self.base}/tasks/sync/extract/ind_driving_license",
                headers=self._headers,
                json={"document1": self._strip_prefix(sub.dl_front)},
            )
            dl_verify = await cli.post(
                f"{self.base}/tasks/sync/verify/dl",
                headers=self._headers,
                json={"id_number": sub.dl_number.strip().upper()},
            )
            if dl_verify.status_code == 200:
                vd = dl_verify.json()
                if not vd.get("result", {}).get("is_id_number_valid", True):
                    return KYCResult(
                        status="rejected",
                        face_match_score=None,
                        liveness_score=None,
                        rejection_reason="DL number invalid or not found in government database",
                        provider=self.name,
                    )

            # 3. Face match
            face_resp = await cli.post(
                f"{self.base}/tasks/sync/face/face_match",
                headers=self._headers,
                json={
                    "document1": self._strip_prefix(sub.face_selfie),
                    "document2": self._strip_prefix(sub.aadhaar_front),
                },
            )
            face_score = 0.0
            if face_resp.status_code == 200:
                fd = face_resp.json()
                face_score = float(fd.get("result", {}).get("confidence", 0))

        if face_score < 0.70:
            return KYCResult(
                status="rejected",
                face_match_score=face_score,
                liveness_score=None,
                rejection_reason="Face does not match Aadhaar photo (score too low)",
                provider=self.name,
            )

        return KYCResult(
            status="verified",
            face_match_score=face_score,
            liveness_score=None,
            rejection_reason=None,
            provider=self.name,
        )


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: KYCProvider | None = None


def get_kyc_provider() -> KYCProvider:
    global _singleton
    if _singleton is None:
        provider = os.getenv("KYC_PROVIDER", "stub").lower()
        if provider == "karza":
            _singleton = KarzaProvider()
        elif provider == "idfy":
            _singleton = IDfyProvider()
        else:
            _singleton = StubKYCProvider()
    return _singleton
