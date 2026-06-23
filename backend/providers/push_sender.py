"""Push notification sender abstraction.

Current impl: `LogSender` — logs to console (in-app notifications still persist).
Switch to Expo Push: set env `PUSH_PROVIDER=expo` (no extra keys needed server-side).
Switch to OneSignal: set env `PUSH_PROVIDER=onesignal` + ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY.
Switch to FCM: set env `PUSH_PROVIDER=fcm` + GOOGLE_FCM_SERVER_KEY.

Device tokens for native push (Expo / FCM) are stored via POST /push/register.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PushPayload:
    user_id: str
    title: str
    body: str
    deeplink: Optional[str] = None
    data: Optional[dict] = field(default=None)


class PushSender(ABC):
    name: str = "abstract"

    @abstractmethod
    async def send(self, payload: PushPayload) -> bool: ...

    @abstractmethod
    async def send_to_token(self, token: str, payload: PushPayload) -> bool:
        """Send directly to a known device push token (Expo / FCM)."""
        ...


# ── Log (dev default) ─────────────────────────────────────────────────────────

class LogSender(PushSender):
    name = "log"

    def __init__(self) -> None:
        self.log = logging.getLogger("raidex.push")

    async def send(self, payload: PushPayload) -> bool:
        self.log.info(
            "PUSH[%s] → %s: %s | deeplink=%s | data=%s",
            payload.user_id, payload.title, payload.body,
            payload.deeplink or "-", payload.data or "-",
        )
        return True

    async def send_to_token(self, token: str, payload: PushPayload) -> bool:
        self.log.info(
            "PUSH_TOKEN[%s] → %s: %s",
            token[:20] + "…" if len(token) > 20 else token,
            payload.title,
            payload.body,
        )
        return True


# ── Expo Push ─────────────────────────────────────────────────────────────────

class ExpoPushSender(PushSender):
    """
    Sends to ExponentPushToken[xxxxxxxx] tokens collected via
    expo-notifications on the client.

    No server key needed — Expo's push service is public.
    Docs: https://docs.expo.dev/push-notifications/sending-notifications/
    """

    name = "expo"
    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

    # db is injected by server.py after import
    db = None

    async def send(self, payload: PushPayload) -> bool:
        """Look up stored tokens for user_id and send to each."""
        if self.db is None:
            return False
        tokens_docs = await self.db.push_tokens.find(
            {"user_id": payload.user_id}, {"_id": 0, "token": 1}
        ).to_list(20)
        if not tokens_docs:
            return False
        results = []
        for doc in tokens_docs:
            results.append(await self.send_to_token(doc["token"], payload))
        return any(results)

    async def send_to_token(self, token: str, payload: PushPayload) -> bool:
        import httpx

        message = {
            "to": token,
            "title": payload.title,
            "body": payload.body,
            "sound": "default",
            "data": payload.data or {},
        }
        if payload.deeplink:
            message["data"]["url"] = payload.deeplink

        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.post(
                self.EXPO_PUSH_URL,
                json=message,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        return r.status_code == 200


# ── OneSignal ─────────────────────────────────────────────────────────────────

class OneSignalSender(PushSender):
    """
    OneSignal REST API integration.
    Env vars:
        ONESIGNAL_APP_ID         — from OneSignal dashboard
        ONESIGNAL_REST_API_KEY   — REST API key (not write-only key)
    Docs: https://documentation.onesignal.com/reference/create-notification
    """

    name = "onesignal"
    BASE = "https://onesignal.com/api/v1/notifications"

    # db injected by server.py
    db = None

    def __init__(self) -> None:
        self.app_id = os.environ["ONESIGNAL_APP_ID"]
        self.rest_key = os.environ["ONESIGNAL_REST_API_KEY"]

    async def send(self, payload: PushPayload) -> bool:
        """Send to all devices registered for this user via external_user_id."""
        import httpx

        body = {
            "app_id": self.app_id,
            "include_external_user_ids": [payload.user_id],
            "headings": {"en": payload.title},
            "contents": {"en": payload.body},
            "data": payload.data or {},
        }
        if payload.deeplink:
            body["url"] = payload.deeplink

        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.post(
                self.BASE,
                json=body,
                headers={
                    "Authorization": f"Basic {self.rest_key}",
                    "Content-Type": "application/json",
                },
            )
        return r.status_code in (200, 202)

    async def send_to_token(self, token: str, payload: PushPayload) -> bool:
        import httpx

        body = {
            "app_id": self.app_id,
            "include_player_ids": [token],
            "headings": {"en": payload.title},
            "contents": {"en": payload.body},
            "data": payload.data or {},
        }
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.post(
                self.BASE,
                json=body,
                headers={"Authorization": f"Basic {self.rest_key}", "Content-Type": "application/json"},
            )
        return r.status_code in (200, 202)


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: PushSender | None = None


def get_push_sender() -> PushSender:
    global _singleton
    if _singleton is None:
        provider = os.getenv("PUSH_PROVIDER", "log").lower()
        if provider == "expo":
            _singleton = ExpoPushSender()
        elif provider == "onesignal":
            _singleton = OneSignalSender()
        else:
            _singleton = LogSender()
    return _singleton


def inject_db(db) -> None:
    """Called by server.py on startup to give push senders DB access for token lookup."""
    sender = get_push_sender()
    if hasattr(sender, "db"):
        sender.db = db
