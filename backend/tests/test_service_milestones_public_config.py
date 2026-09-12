import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from test_quality_flows import USER, fake_db  # noqa: F401


@pytest.mark.asyncio
async def test_non_admin_can_read_milestone_thresholds(fake_db):
    result = await server.get_milestone_config(USER)
    assert result["thresholds_km"] == [10_000, 25_000, 50_000, 100_000]


@pytest.mark.asyncio
async def test_public_config_reflects_admin_updated_thresholds(fake_db):
    fake_db.service_milestones.docs.append({"config_id": "service_milestones", "thresholds_km": [500, 1000]})
    result = await server.get_milestone_config(USER)
    assert result["thresholds_km"] == [500, 1000]
