# WebSocket Failure Runbook

## Detect

- Realtime booking/payment/KYC updates stop.
- WebSocket connection errors increase.
- Admin live alerts stop updating.

## Triage

1. Check WebSocket endpoint availability.
2. Check load balancer/proxy WebSocket support.
3. Check app logs for connection churn.

## Mitigate

1. Fall back to polling critical screens.
2. Restart only affected realtime worker if separated.
3. Scale service if connection count is saturated.

## Recovery Criteria

- New WebSocket connections are accepted.
- Realtime event latency is below SLA.
- No abnormal disconnect spike remains.
