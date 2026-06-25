# Payment Failure Runbook

## Detect

- Payment success rate drops.
- Payment webhook failures increase.
- Customer reports duplicate charges or stuck payments.

## Triage

1. Check payment provider dashboard.
2. Check webhook logs and deduplication records.
3. Check failed payment events and reconciliation job output.
4. Verify idempotency key behavior.

## Mitigate

1. Pause affected payment method if provider outage is confirmed.
2. Enable manual reconciliation queue.
3. Refund duplicate charges through provider dashboard.
4. Communicate known issue to support.

## Recovery Criteria

- Payment success rate returns to baseline.
- No unreconciled successful provider payments remain.
- Failed webhook backlog is zero.
