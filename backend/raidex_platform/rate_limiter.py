# RAIDEX_RATE_LIMITER
# Enforces raidex_platform.rate_limits' role-based ceilings on sensitive,
# state-changing endpoints (booking, payment, KYC, wallet, AI, admin financial
# actions) that are unit-tested via direct function calls rather than through
# the full ASGI/TestClient request cycle slowapi's decorator requires. slowapi
# itself remains in place for the auth endpoints (register/login/OTP/refresh),
# which are tested through TestClient. In-memory per-process storage, the same
# tier slowapi itself defaults to without a Redis backend configured.
import time
from collections import defaultdict, deque


class InMemoryRateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)

    def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Record a call under `key` and return whether it's allowed (True) or
        the caller has exceeded `limit` calls within the trailing window (False)."""
        now = time.monotonic()
        window = self._hits[key]
        while window and now - window[0] > window_seconds:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True

    def reset(self) -> None:
        """Test helper - the singleton is process-wide, so tests must reset it
        between cases to avoid cross-test interference."""
        self._hits.clear()


_singleton = InMemoryRateLimiter()


def get_rate_limiter() -> InMemoryRateLimiter:
    return _singleton
