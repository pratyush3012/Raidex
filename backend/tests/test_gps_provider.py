import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from providers.gps_provider import LocationEvent, PhoneGPSProvider, get_gps_provider, reset_gps_provider
from test_quality_flows import fake_db, vehicle  # noqa: F401


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def _reset_singleton():
    reset_gps_provider()
    yield
    reset_gps_provider()


@pytest.mark.asyncio
async def test_get_gps_provider_defaults_to_phone(monkeypatch):
    monkeypatch.delenv("GPS_PROVIDER", raising=False)
    provider = get_gps_provider()
    assert isinstance(provider, PhoneGPSProvider)
    assert provider.name == "phone_gps"


@pytest.mark.asyncio
async def test_unknown_provider_falls_back_to_phone_instead_of_crashing_startup(monkeypatch, caplog):
    # No vehicle-hardware vendor is integrated yet - a misconfigured env var
    # must not crash the whole app at startup (matches every other provider
    # factory's fallback convention in this package); it should be visible in
    # logs instead.
    monkeypatch.setenv("GPS_PROVIDER", "vehicle_hardware")
    with caplog.at_level("WARNING"):
        provider = get_gps_provider()
    assert isinstance(provider, PhoneGPSProvider)
    assert any("Unknown GPS_PROVIDER" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_ingest_location_records_track_and_updates_vehicle_position(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", latitude=28.6, longitude=77.2))
    provider = PhoneGPSProvider()
    provider.db = fake_db
    provider.utc_now = utc_now

    result = await provider.ingest_location(LocationEvent(vehicle_id="veh_1", lat=28.6, lng=77.2, speed_kmph=40))
    assert result["ok"] is True
    assert result["events"] == []
    assert len(fake_db.gps_tracks.docs) == 1
    assert fake_db.vehicles.docs[0]["last_track_lat"] == 28.6


@pytest.mark.asyncio
async def test_ingest_location_raises_exit_home_geofence_event_outside_a_trip(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", latitude=28.6, longitude=77.2, home_geofence_radius_m=1000))
    provider = PhoneGPSProvider()
    provider.db = fake_db
    provider.utc_now = utc_now

    # ~100km away, no active booking -> should raise an exit_home event.
    result = await provider.ingest_location(LocationEvent(vehicle_id="veh_1", lat=29.5, lng=77.2, speed_kmph=0))
    assert len(result["events"]) == 1
    assert fake_db.geofence_events.docs[0]["kind"] == "exit_home"


@pytest.mark.asyncio
async def test_ingest_location_does_not_raise_exit_home_during_an_active_trip(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", latitude=28.6, longitude=77.2, home_geofence_radius_m=1000))
    provider = PhoneGPSProvider()
    provider.db = fake_db
    provider.utc_now = utc_now

    result = await provider.ingest_location(
        LocationEvent(vehicle_id="veh_1", lat=29.5, lng=77.2, speed_kmph=0, booking_id="bkg_1"),
    )
    assert result["events"] == []


@pytest.mark.asyncio
async def test_ingest_location_raises_excess_speed_event(fake_db):
    fake_db.vehicles.docs.append(vehicle(vehicle_id="veh_1", latitude=28.6, longitude=77.2))
    provider = PhoneGPSProvider()
    provider.db = fake_db
    provider.utc_now = utc_now

    result = await provider.ingest_location(LocationEvent(vehicle_id="veh_1", lat=28.6, lng=77.2, speed_kmph=130, booking_id="bkg_1"))
    assert len(result["events"]) == 1
    assert fake_db.geofence_events.docs[0]["kind"] == "excess_speed"


@pytest.mark.asyncio
async def test_health_reports_no_hardware_integration():
    provider = PhoneGPSProvider()
    health = await provider.health()
    assert health["hardware_integration"] is False
