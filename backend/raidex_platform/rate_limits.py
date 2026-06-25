ROLE_RATE_LIMITS = {
    "guest": "30/minute",
    "customer": "120/minute",
    "owner": "180/minute",
    "admin": "300/minute",
    "support_webhook": "600/minute",
}


def rate_limit_for_role(role: str | None) -> str:
    return ROLE_RATE_LIMITS.get(role or "guest", ROLE_RATE_LIMITS["guest"])
