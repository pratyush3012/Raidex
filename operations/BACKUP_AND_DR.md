# Backup And Disaster Recovery

## Daily Backup

- Run `mongodump` for the production database every 24 hours.
- Store encrypted archives in a private bucket.
- Retain daily backups for 14 days.

## Weekly Backup

- Keep one weekly backup for 12 weeks.
- Verify archive integrity after upload.

## Restore Verification

- Restore latest backup into an isolated staging database weekly.
- Run backend smoke tests against restored staging.
- Record verification timestamp and operator.

## Disaster Recovery

1. Freeze deployments.
2. Identify last good backup.
3. Restore into clean cluster.
4. Update application `MONGO_URL`.
5. Run health, auth, booking, payment, KYC smoke tests.
6. Resume traffic gradually.

## RPO / RTO Targets

- RPO target: 24 hours until continuous backup is enabled.
- RTO target: 4 hours for public beta.
