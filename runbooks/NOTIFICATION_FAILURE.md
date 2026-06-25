# Notification Failure Runbook

## Detect

- Notification outbox failed status increases.
- Push provider returns errors.
- Users report missing booking/payment/KYC notifications.

## Triage

1. Check notification outbox by channel.
2. Check push/email/SMS provider dashboards.
3. Verify provider credentials.

## Mitigate

1. Retry failed notifications using `/api/admin/notifications/retry-failed`.
2. Disable failing channel if it is causing retries to back up.
3. Keep in-app notifications active.

## Recovery Criteria

- Failed outbox backlog is zero.
- Provider status is healthy.
- New notifications are delivered successfully.
