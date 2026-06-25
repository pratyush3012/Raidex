# Raidex Testing

## Frontend

Run:

`npm.cmd test -- --watch=false`

Current verified result:

- 6 suites passed
- 35 tests passed before Phase 4 feature API tests

Critical tests cover:

- Shared API client retry, auth header, caching, and offline queue
- AuthProvider hook/component behavior
- Feature API wrapper contracts

## Backend

Run:

`python -m pytest backend/tests -q --cov=server --cov=features.booking --cov=providers --cov-report=term-missing`

Current verified result after booking service extraction:

- 35 passed
- 20 skipped legacy live localhost smoke tests
- `features.booking.service`: 100% coverage

## Test Design Rule

Every new feature module should have:

- Service tests for business rules
- Route tests for auth/validation/HTTP status
- Repository tests or fake DB contract tests for persistence assumptions
