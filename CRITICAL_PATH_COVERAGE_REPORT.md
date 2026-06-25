# Raidex Critical Path Test Coverage Report

Date: 2026-06-25

Scope: business-critical test coverage only. Cosmetic UI files and broad app-screen coverage are intentionally not counted as success criteria in this pass.

## Test Results

Frontend command:

`npm.cmd test -- --watch=false`

- Test suites: 6 passed
- Tests: 35 passed
- Snapshots: 0

Targeted frontend critical-module coverage command:

`npm.cmd test -- --watch=false --collectCoverageFrom=src/api/client.ts --collectCoverageFrom=src/context/AuthContext.tsx --collectCoverageFrom=src/utils/offline.ts --collectCoverageFrom=src/observability/sentry.ts --coverageReporters=text`

Backend command:

`python -m pytest backend/tests -q --cov=server --cov=providers --cov-report=term-missing`

- Tests: 29 passed
- Skipped: 20 legacy live localhost smoke tests gated behind `RAIDEX_RUN_LIVE_API_TESTS=1`

TypeScript command:

`npm.cmd run typecheck`

- Result: passed

## Module Coverage Table

| Layer | Module | Statements | Branches | Functions | Lines | 90% Target |
|---|---:|---:|---:|---:|---:|---|
| Frontend | `src/api/client.ts` | 71.57% | 67.56% | 88.88% | 75.58% | Failed |
| Frontend | `src/context/AuthContext.tsx` | 50.49% | 23.68% | 81.81% | 53.76% | Failed |
| Frontend | `src/utils/offline.ts` | 90.00% | 83.33% | 100.00% | 94.73% | Passed on lines/statements/functions; branch short |
| Frontend | `src/observability/sentry.ts` | 100.00% | 83.33% | 100.00% | 100.00% | Passed on lines/statements/functions; branch short |
| Backend | `backend/server.py` | 54.00% | n/a | n/a | 54.00% | Failed |
| Backend | `backend/providers/damage_inspector.py` | 88.00% | n/a | n/a | 88.00% | Failed by 2 points |
| Backend | `backend/providers/kyc_provider.py` | 51.00% | n/a | n/a | 51.00% | Failed |
| Backend | `backend/providers/payment_gateway.py` | 49.00% | n/a | n/a | 49.00% | Failed |
| Backend | `backend/providers/push_sender.py` | 45.00% | n/a | n/a | 45.00% | Failed |

## Critical Flow Evidence Matrix

| Priority | Flow | Success | Failure | Network Failure | Validation Failure | Unauthorized Access |
|---:|---|---|---|---|---|---|
| 1 | Authentication | Frontend AuthProvider login/session restore; backend register/login route | Wrong password | Google session provider down returns server failure path | Invalid register payload returns 422 | Missing auth header returns 401 |
| 2 | KYC | Backend submit/status; provider contract tests | Provider rejects/marks failed | Provider exception marks KYC rejected | KYC model now rejects missing/invalid docs | Covered by protected route tests |
| 3 | Vehicle Discovery | Backend filtered discovery; frontend API contract | Missing vehicle 404 | Frontend cached discovery fallback on API failure | Invalid availability dates 400 | Protected route 401 coverage |
| 4 | Booking Creation | Backend create booking; frontend API contract | Vehicle conflict / KYC not verified | Frontend failed write queue | Invalid booking payload 422 / invalid dates 400 | Route missing auth 401 |
| 5 | Payment Flow | Backend create/confirm/idempotency/wallet; frontend API contract | Forced failed payment / missing payment | Gateway create-order exception | Non-positive amount rejected | Wrong user payment lookup 404 |
| 6 | Booking Extension | Backend extension success | Extension conflict/invalid status paths covered partially | Not separately simulated | New end before old end 400 | Protected route 401 coverage |
| 7 | Booking Cancellation | Backend cancel success/refund due | Cannot cancel completed/cancelled booking | Frontend failed write queue covers cancel-class writes | Reason field max length covered by model | Protected route 401 coverage |
| 8 | Invoice Generation | Backend invoice success | Missing booking 404 covered in invoice path indirectly | Not separately simulated | Booking ownership required | Protected route 401 coverage |
| 9 | GST Invoice | Backend GST invoice success | Missing booking 404 covered in invoice path indirectly | Not separately simulated | GST flag path covered | Protected route 401 coverage |
| 10 | Reviews | Backend completed-trip review success | Duplicate review 409 / incomplete trip 403 | Not separately simulated | Rating model range covered by Pydantic | Protected route 401 coverage |
| 11 | Wishlist | Backend add/list/remove success | Missing vehicle 404 | Not separately simulated | Vehicle id path required by route | Protected route 401 coverage |
| 12 | Referrals | Backend referral success | Self-referral 400 | Not separately simulated | Invalid email handled by model | Protected route 401 coverage |
| 13 | Coupons | Backend coupon success | Missing coupon 404 | Not separately simulated | Amount/code model validation | Protected route 401 coverage |
| 14 | Disputes | Backend dispute create/admin update success | Booking id mismatch / invalid status | Not separately simulated | Message/category model validation | Protected route 401 coverage |
| 15 | Admin Approval Actions | Vehicle/KYC/dispute admin actions success | Missing KYC 404 | Not separately simulated | Invalid dispute status 400 | Non-admin 403 and missing auth 401 |

## Changes Made In This Pass

- Added backend critical route/service/edge tests in `backend/tests/test_critical_paths.py`.
- Expanded backend fake DB matching for `$or`, `$regex`, `$lte`, `$gte`, counts, sorting, and index no-ops.
- Tightened backend KYC request validation for required document fields, Aadhaar last4, DL number, and selfie/document payload lengths.
- Added frontend critical API integration tests for all 15 priority flows in `frontend/src/api/critical-flows.test.ts`.
- Added frontend AuthProvider hook/component tests in `frontend/src/context/AuthContext.test.tsx`.
- Stabilized frontend Jest mocks for notifications, constants, browser auth, and linking.
- Pinned React Native Testing Library to the React 18 / React Native 0.74 compatible line and added `@types/react-test-renderer`.

## Target Status

The critical flows are now meaningfully covered by automated tests, but the requested 90% module coverage target is not yet met.

Passing 90% next requires either splitting `backend/server.py` into independently measurable route/service modules or adding many more route tests against the current monolithic file. On frontend, `AuthContext.tsx` needs Google web/native paths, register, refresh edge cases, push-token grant path, and logout token unregister paths covered to approach 90%.
