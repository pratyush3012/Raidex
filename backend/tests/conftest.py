import os

import pytest


def pytest_collection_modifyitems(config, items):
    if os.getenv("RAIDEX_RUN_LIVE_API_TESTS") == "1":
        return
    skip_live = pytest.mark.skip(reason="Set RAIDEX_RUN_LIVE_API_TESTS=1 to run localhost API smoke tests")
    for item in items:
        if item.path.name == "backend_test.py":
            item.add_marker(skip_live)
