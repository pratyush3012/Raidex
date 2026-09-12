import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The in-process rate limiter (raidex_platform.rate_limiter) is a
    process-wide singleton - reset it before every test so one test's calls
    can't trip another test's 429 threshold."""
    from raidex_platform.rate_limiter import get_rate_limiter

    get_rate_limiter().reset()
    yield
    get_rate_limiter().reset()


def pytest_collection_modifyitems(config, items):
    if os.getenv("RAIDEX_RUN_LIVE_API_TESTS") == "1":
        return
    skip_live = pytest.mark.skip(reason="Set RAIDEX_RUN_LIVE_API_TESTS=1 to run localhost API smoke tests")
    for item in items:
        if item.path.name == "backend_test.py":
            item.add_marker(skip_live)
