import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import PaymentCreateRequest, SignedUploadRequest


def test_payment_create_accepts_idempotency_key():
    req = PaymentCreateRequest(amount=1200, purpose="booking", idempotency_key="booking_123")
    assert req.idempotency_key == "booking_123"
    assert req.amount == 1200


def test_signed_upload_rejects_oversized_media():
    try:
        SignedUploadRequest(
            purpose="kyc",
            file_name="aadhaar.jpg",
            content_type="image/jpeg",
            size_bytes=20_000_000,
        )
    except Exception as exc:
        assert "size_bytes" in str(exc)
    else:
        raise AssertionError("oversized media should fail validation")
