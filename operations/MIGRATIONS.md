# Database Migration Strategy

## Versioning

- Store migrations under `backend/migrations`.
- Use monotonically increasing filenames: `YYYYMMDDHHMM_description.py`.
- Track applied migrations in a `schema_migrations` collection.

## Rules

- Migrations must be idempotent.
- Every migration must define `upgrade`.
- Destructive migrations must define `rollback` and require approval.
- Backfill scripts must be resumable.

## Rollback

1. Stop writes if rollback changes schema used by app code.
2. Run migration rollback for the failed version.
3. Deploy previous app version.
4. Verify `/api/health`, auth, booking, payment, and KYC smoke tests.

## Public Beta Rule

No migration should remove fields during beta. Use additive changes first, then clean up after a full release cycle.
