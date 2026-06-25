# Raidex Quality War Room Report

Date: 2026-06-24

Scope: quality hardening only. No new features, no UI redesign, no new screens.

## Coverage Evidence

Frontend command: `jest --coverage --runInBand --watch=false`

- Test suites: 4 passed
- Tests: 11 passed
- Statements: 8.35%
- Branches: 5.43%
- Functions: 7.47%
- Lines: 8.93%
- Strong files now covered: offline queue/cache `94.73%` lines, Sentry wrapper `100%` lines, API client `59.30%` lines
- Target: 80% minimum
- Result: Failed target

Backend command: `pytest backend/tests -q --cov=backend --cov-report=term-missing`

- Tests: 20 passed, 20 skipped live API smoke tests
- Statements total: 40%
- `backend/server.py`: 40%
- `backend/providers/damage_inspector.py`: 88%
- `backend/providers/kyc_provider.py`: 46%
- `backend/providers/payment_gateway.py`: 49%
- `backend/cron/owner_anomaly.py`: 0%
- Target: 80% minimum
- Result: Failed target

## Security Evidence

Frontend command: `npm audit --json --omit=dev`

- Critical: 0
- High: 19
- Moderate: 20
- Low: 1
- Total production advisories: 40
- Safe `npm audit fix --omit=dev`: did not eliminate remaining advisories
- Remaining fixes require Expo/React Native major-version upgrades:
  - `expo`: high, upgrade available to `56.0.12`, breaking-change risk high, exploitable mainly through Expo build/config/tooling paths, mitigation is isolated trusted CI plus planned SDK upgrade branch.
  - `expo-constants`: high, upgrade available to `56.0.18`, breaking-change risk high, exploitable through Expo SDK dependency chain, mitigation is lockfile pinning and SDK upgrade branch.
  - `expo-linking`: high, upgrade available to `56.0.14`, breaking-change risk high, exploitable through SDK dependency chain, mitigation is SDK upgrade branch.
  - `expo-notifications`: high, upgrade available to `56.0.18`, breaking-change risk high, exploitable through SDK dependency chain, mitigation is SDK upgrade branch.
  - `expo-router`: high, upgrade available to `56.2.11`, breaking-change risk high, exploitable through router/Expo dependency chain, mitigation is SDK upgrade branch with navigation regression testing.
  - `expo-splash-screen`: high, upgrade available to `56.0.10`, breaking-change risk high, exploitable through SDK dependency chain, mitigation is SDK upgrade branch.
  - `react-native`: moderate, upgrade available to `0.86.0`, breaking-change risk high, exploitable in native/runtime dependency chain, mitigation is major RN upgrade with full device QA.
- Exploitability in Raidex: mostly build-tool/transitive XML, tar, Metro, Expo CLI, Expo SDK, and React Native CLI paths. Runtime exposure is lower than direct server dependencies, but production release tooling remains exposed.
- Mitigation until major upgrade: pin current lockfile, run builds only in trusted CI, avoid processing untrusted archives/config/XML in build jobs, isolate CI runners, and plan Expo/RN upgrade branch.

Backend command: `pip-audit -r backend/requirements.txt`

- Known vulnerabilities: 0
- Remediation applied: upgraded FastAPI from 0.110.1 to 0.138.0, which pulled patched Starlette 1.3.1.

## Chaos Evidence

Automated coverage now verifies:

- Network loss / API down for frontend writes: failed write requests are queued.
- Token expiry: frontend retries once after refresh-token exchange.
- Corrupt offline cache: returns null instead of crashing.
- Unreachable internet state: offline helper returns false.
- Booking conflict: double-booking is rejected.
- KYC not verified: booking is rejected.
- Missing trip inspection: trip start is rejected.
- Expired refresh token: rejected.
- Payment idempotency: duplicate create request reuses the original payment result.
- Wallet top-up confirmation: successful payment updates wallet balance.
- GST invoice fields: validated.
- Coupon cap: percent discount respects maximum discount.
- Self-referral: rejected.
- Dispute booking mismatch: rejected.
- Completed-trip reviews: update vehicle rating.
- Wishlist add/remove: persists expected state.

Not yet automated:

- Database outage behavior.
- Payment provider timeout with real provider SDK/webhook.
- GPS permission denied from the native location module.
- App restart during booking/payment on a device simulator.

## Performance Evidence

Measured locally:

- Frontend TypeScript check: 12,758.598 ms
- Backend compile check: 351.3598 ms
- Expo doctor: 17/17 checks passed

Not measured yet:

- Cold app start on device.
- Warm app start on device.
- Real API latency with MongoDB.
- Booking latency against deployed backend.
- Native map render speed on Android/iOS hardware.

## Manual QA Checklist

Customer:

- Signup
- Login
- KYC submit
- KYC status recovery
- Browse vehicles
- Apply filters
- Wishlist add/remove
- Booking creation
- Payment success
- Payment failure
- Trip start with inspection
- Trip end with inspection
- Invoice / GST invoice
- Dispute creation

Owner:

- Owner onboarding
- Add vehicle
- Edit vehicle
- Approve booking
- View earnings
- Fleet health / document expiry

Admin:

- Approve KYC
- Reject KYC
- Approve vehicle
- Reject vehicle
- Manage dispute
- View system health
- View fraud risk

## Open Bugs / Risks

- Frontend coverage is 8.93%, far below 80%.
- Backend coverage is 40%, far below 80%.
- Frontend has 40 production dependency advisories requiring major Expo/RN upgrades.
- 20 legacy live API smoke tests are skipped unless `RAIDEX_RUN_LIVE_API_TESTS=1`.
- FastAPI `on_event` lifecycle is deprecated and should be migrated to lifespan handlers.
- Device-level chaos scenarios are not automated yet.

## Production Score

Evidence-based score: 47 / 100

Scoring:

- Tests and coverage: 10 / 30
- Dependency security: 15 / 25
- Chaos resilience: 10 / 15
- Performance evidence: 5 / 15
- Manual QA readiness: 7 / 15

Blocking gates before production:

- Raise frontend and backend coverage to 80%+.
- Complete Expo/React Native major upgrade remediation or obtain vendor-patched SDK line.
- Automate device-level E2E and chaos tests.
- Run manual QA on Android device/emulator against staging services.
