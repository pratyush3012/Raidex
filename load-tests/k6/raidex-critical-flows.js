import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    smoke_1000: {
      executor: "ramping-vus",
      stages: [
        { duration: "2m", target: 1000 },
        { duration: "5m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
    },
    scale_5000: {
      executor: "constant-vus",
      vus: 5000,
      duration: "5m",
      startTime: "9m",
    },
    scale_10000: {
      executor: "constant-vus",
      vus: 10000,
      duration: "5m",
      startTime: "15m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health ok": (r) => r.status === 200 });

  const vehicles = http.get(`${BASE_URL}/api/vehicles`, {
    headers: { Authorization: `Bearer ${__ENV.ACCESS_TOKEN || "load-test-token"}` },
  });
  check(vehicles, { "vehicles non-error": (r) => r.status < 500 });

  sleep(1);
}
