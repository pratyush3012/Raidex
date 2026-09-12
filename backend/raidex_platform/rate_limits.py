ROLE_RATE_LIMITS = {
    "guest": "30/minute",
    "customer": "120/minute",
    "owner": "180/minute",
    "admin": "300/minute",
    "support_webhook": "600/minute",
}


def rate_limit_for_role(role: str | None) -> str:
    return ROLE_RATE_LIMITS.get(role or "guest", ROLE_RATE_LIMITS["guest"])


_UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def parse_rate_limit(spec: str) -> tuple[int, int]:
    """'120/minute' -> (120, 60). Used to enforce ROLE_RATE_LIMITS outside of
    slowapi (e.g. for endpoints tested via direct function calls rather than
    through the ASGI request cycle slowapi's decorator requires)."""
    count_str, _, unit = spec.partition("/")
    return int(count_str), _UNIT_SECONDS.get(unit.strip().lower(), 60)
