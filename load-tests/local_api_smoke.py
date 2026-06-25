import json
import os
import statistics
import sys
import time
import tracemalloc
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "raidex_load_test")
os.environ.setdefault("JWT_SECRET", "test_secret_" * 8)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient
import server


class FakeHealthDb:
    async def command(self, *_args, **_kwargs):
        return {"ok": 1}


def percentile(values, pct):
    if not values:
        return 0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(round((pct / 100) * (len(ordered) - 1))))
    return ordered[idx]


def main():
    requests = int(os.getenv("REQUESTS", "1000"))
    concurrency = int(os.getenv("CONCURRENCY", "50"))
    server.db = FakeHealthDb()
    client = TestClient(server.app, raise_server_exceptions=False)
    latencies = []
    statuses = []
    tracemalloc.start()
    cpu_start = time.process_time()
    wall_start = time.perf_counter()

    def hit():
        started = time.perf_counter()
        res = client.get("/api/v1/health")
        return (time.perf_counter() - started) * 1000, res.status_code

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(hit) for _ in range(requests)]
        for future in as_completed(futures):
            elapsed, status = future.result()
            latencies.append(elapsed)
            statuses.append(status)

    wall_ms = (time.perf_counter() - wall_start) * 1000
    cpu_ms = (time.process_time() - cpu_start) * 1000
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    result = {
        "requests": requests,
        "concurrency": concurrency,
        "success_rate": round(sum(1 for s in statuses if s == 200) / max(1, len(statuses)), 4),
        "p50_ms": round(statistics.median(latencies), 2),
        "p95_ms": round(percentile(latencies, 95), 2),
        "p99_ms": round(percentile(latencies, 99), 2),
        "max_ms": round(max(latencies), 2),
        "wall_ms": round(wall_ms, 2),
        "cpu_ms": round(cpu_ms, 2),
        "peak_memory_mb": round(peak / 1024 / 1024, 2),
        "notes": "Local in-process FastAPI health load smoke. Does not validate staging network, database throughput, or WebSocket scale.",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
