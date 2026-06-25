# Server Down Runbook

## Detect

- API uptime probe fails.
- `/api/health` unavailable or repeatedly degraded.
- Sentry/API monitor alerts trigger.

## Triage

1. Check hosting provider incident page.
2. Check latest deployment status.
3. Check application logs for startup/runtime exceptions.
4. Check database connectivity.
5. Check environment variables.

## Mitigate

1. Roll back the last release if failure began after deploy.
2. Scale service replicas if CPU or memory is saturated.
3. Restart service only after logs are captured.
4. Post incident status to internal launch channel.

## Recovery Criteria

- `/api/health` returns 200 for 10 consecutive checks.
- Error rate is below 1%.
- No new critical Sentry events for 15 minutes.
