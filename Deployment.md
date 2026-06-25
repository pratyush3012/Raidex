# Raidex Deployment

## Required Checks

Before release:

1. Frontend Jest
2. Frontend TypeScript
3. Expo doctor
4. Backend Pytest
5. Dependency audit
6. Environment validation

## Environment

Production and staging must define:

- `MONGO_URL`
- `DB_NAME`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- `PAYMENT_PROVIDER`
- `KYC_PROVIDER`
- `SENTRY_DSN`

Mock payment and stub KYC providers are blocked in production/staging by backend environment validation.
