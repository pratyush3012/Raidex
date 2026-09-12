"""GPS/telemetry provider abstraction.

Current default impl: `PhoneGPSProvider` — wraps the customer's phone GPS
(collected client-side via expo-location and posted to `POST /gps/track`).
This is unchanged MVP behavior, just moved behind an interface so a future
vehicle-installed hardware GPS integration (`VehicleHardwareGPSProvider`,
not implemented yet — no hardware vendor is integrated today) can be added
without rewriting the trip/geofence system that calls into this module.

Hard rule (see RAIDEX master spec, security/business rule #39): this
abstraction is STRICTLY location/telemetry. It must never grow engine-kill,
remote-start, ignition, or immobilizer operations — those are out of scope
for GPS and are not implemented anywhere in this codebase.
"""

from __future__ import annotations

import logging
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from math import radians, sin, cos, sqrt, atan2
from typing import Any, Optional

logger = logging.getLogger("raidex.gps")


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


@dataclass
class LocationEvent:
    vehicle_id: str
    lat: float
    lng: float
    speed_kmph: float = 0.0
    heading: Optional[float] = None
    booking_id: Optional[str] = None


class GPSProvider(ABC):
    """Tracking/security/mileage/geofence only - never vehicle control."""

    name: str = "abstract"

    @abstractmethod
    async def start_tracking(self, *, vehicle_id: str, booking_id: Optional[str] = None) -> dict:
        """Called when a trip starts. Returns a tracking-session descriptor."""
        ...

    @abstractmethod
    async def stop_tracking(self, *, vehicle_id: str, booking_id: Optional[str] = None) -> dict:
        """Called when a trip ends."""
        ...

    @abstractmethod
    async def ingest_location(self, event: LocationEvent) -> dict:
        """Record a location ping and evaluate geofence/speed rules against it.
        Returns {"ok": True, "events": [<geofence_event_id>, ...]}."""
        ...

    @abstractmethod
    async def health(self) -> dict:
        """Provider availability/status for admin observability."""
        ...


class PhoneGPSProvider(GPSProvider):
    """Wraps the existing phone-GPS (`expo-location`) flow. `db` is injected
    by server.py so this class can read/write the same `gps_tracks`,
    `vehicles`, and `geofence_events` collections the inline code used
    before this abstraction existed - no behavior change for the MVP."""

    name = "phone_gps"

    # injected by server.py after import, matching the push/KYC provider pattern
    db: Any = None
    utc_now: Any = None

    EXCESS_SPEED_KMPH = 100
    DEFAULT_GEOFENCE_RADIUS_M = 25000

    async def start_tracking(self, *, vehicle_id: str, booking_id: Optional[str] = None) -> dict:
        # Phone GPS has no explicit "session" to open server-side - the phone
        # simply starts posting `ingest_location` events once the trip begins.
        return {"provider": self.name, "vehicle_id": vehicle_id, "booking_id": booking_id, "status": "tracking"}

    async def stop_tracking(self, *, vehicle_id: str, booking_id: Optional[str] = None) -> dict:
        return {"provider": self.name, "vehicle_id": vehicle_id, "booking_id": booking_id, "status": "stopped"}

    async def ingest_location(self, event: LocationEvent) -> dict:
        now = self.utc_now() if self.utc_now else None
        veh = await self.db.vehicles.find_one({"vehicle_id": event.vehicle_id}, {"_id": 0})
        if not veh:
            return {"ok": False, "events": [], "error": "vehicle_not_found"}

        await self.db.gps_tracks.insert_one({
            "track_id": "trk_" + uuid.uuid4().hex[:12],
            "vehicle_id": event.vehicle_id, "booking_id": event.booking_id,
            "lat": event.lat, "lng": event.lng,
            "speed_kmph": event.speed_kmph, "heading": event.heading,
            "recorded_at": now,
        })
        await self.db.vehicles.update_one(
            {"vehicle_id": event.vehicle_id},
            {"$set": {"last_track_lat": event.lat, "last_track_lng": event.lng,
                      "last_track_speed": event.speed_kmph, "last_track_at": now}},
        )

        raised: list[str] = []
        home_lat, home_lng = veh["latitude"], veh["longitude"]
        radius = veh.get("home_geofence_radius_m", self.DEFAULT_GEOFENCE_RADIUS_M)
        dist = haversine_m(home_lat, home_lng, event.lat, event.lng)

        if dist > radius and not event.booking_id:
            evt = {
                "event_id": "evt_" + uuid.uuid4().hex[:10], "vehicle_id": event.vehicle_id,
                "owner_id": veh.get("owner_id", "usr_marketplace"), "booking_id": None,
                "kind": "exit_home", "lat": event.lat, "lng": event.lng,
                "meta": {"distance_m": int(dist)}, "acknowledged": False, "created_at": now,
            }
            await self.db.geofence_events.insert_one(evt)
            raised.append(evt["event_id"])

        if event.speed_kmph > self.EXCESS_SPEED_KMPH:
            evt = {
                "event_id": "evt_" + uuid.uuid4().hex[:10], "vehicle_id": event.vehicle_id,
                "owner_id": veh.get("owner_id", "usr_marketplace"), "booking_id": event.booking_id,
                "kind": "excess_speed", "lat": event.lat, "lng": event.lng,
                "meta": {"speed_kmph": event.speed_kmph}, "acknowledged": False, "created_at": now,
            }
            await self.db.geofence_events.insert_one(evt)
            raised.append(evt["event_id"])

        return {"ok": True, "events": raised}

    async def health(self) -> dict:
        return {"provider": self.name, "status": "ok", "hardware_integration": False}


# ── Factory ──────────────────────────────────────────────────────────────────

_singleton: GPSProvider | None = None


def get_gps_provider() -> GPSProvider:
    global _singleton
    if _singleton is None:
        provider = os.getenv("GPS_PROVIDER", "phone").lower()
        if provider != "phone":
            # No vehicle-hardware GPS vendor is integrated yet - log so a
            # misconfigured env var is visible in observability, but don't
            # crash startup over it (matches the fallback convention every
            # other provider factory in this package already uses).
            logger.warning(
                "Unknown GPS_PROVIDER '%s' - only 'phone' (PhoneGPSProvider) is implemented "
                "today; falling back to it. A vehicle-hardware provider is a future integration.",
                provider,
            )
        _singleton = PhoneGPSProvider()
    return _singleton


def inject_db(db, utc_now) -> None:
    """Called by server.py on startup, matching providers.push_sender.inject_db."""
    provider = get_gps_provider()
    if hasattr(provider, "db"):
        provider.db = db
        provider.utc_now = utc_now


def reset_gps_provider() -> None:
    global _singleton
    _singleton = None
