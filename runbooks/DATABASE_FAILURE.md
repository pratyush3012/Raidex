# Database Failure Runbook

## Detect

- `/api/health` returns database unreachable.
- MongoDB connection errors appear in logs.
- Query latency spikes.

## Triage

1. Check managed MongoDB cluster status.
2. Check connection string and network access list.
3. Check CPU, memory, storage, and connection count.
4. Check slow query logs.

## Mitigate

1. Fail over to replica if available.
2. Scale cluster if resource exhaustion is confirmed.
3. Restore from latest verified backup only if data loss/corruption is confirmed.

## Recovery Criteria

- Database ping succeeds.
- Error rate and query latency return to baseline.
- Backup/restore status is known.
