# RAIDEX — Final Production Readiness Audit

Read-only audit. No code was modified while producing this document. Six independent read-only passes covered all 40 requested areas plus the financial-invariant chain, duplicate/retry behavior, and an endpoint-by-endpoint authorization sweep. Every finding below cites the exact file/function/route it was found in; several claims were verified by actually running the backend test suite (quoted verbatim where relevant) rather than trusted from comments.

**Total test run at time of audit:** `cd backend && python -m pytest -q` → `127 passed, 2 skipped, 8 warnings`. All targeted `-k` subsets referenced below passed. Passing tests do **not** by themselves establish production readiness — several of the findings below are real defects that the existing test suite does not (and, in one case, structurally cannot) catch.

---

## P0 — Blocks real money / blocks launch

### P0-1 — Booking double-booking race is not actually prevented under concurrency
- **File**: `backend/features/booking/service.py:84-113`
- **Function/route**: `BookingService.create_booking` / `_check_conflict_and_insert`
- **Problem**: The conflict-check + insert is wrapped in `session.start_transaction()` with a fallback for standalone (non-replica-set) Mongo. This is real code, not vaporware — but MongoDB multi-document transactions only guarantee snapshot isolation and detect write-write conflicts **on the same document**. Two concurrent `create_booking` calls for overlapping (not identical) date ranges each insert a **brand-new** document with a different `booking_id`; there is nothing for Mongo to conflict on. There is no unique index enforcing non-overlapping ranges per vehicle (the only relevant index is a plain non-unique compound index for query performance, `server.py:3130`). The code comment implies this transaction prevents double-booking; it does not, for the general overlapping-range case.
- **Test coverage gap**: The one test that looks relevant, `tests/test_quality_flows.py:266 test_booking_conflict_blocks_double_booking`, passes but is not a concurrency test — it pre-inserts a conflicting booking synchronously, then calls `create_booking` once. Worse, the fake test DB's `FakeMongoClient.start_session()` (`tests/test_quality_flows.py:135-143`) **always** raises `OperationFailure`, meaning **every test in the entire suite exercises only the non-transactional fallback path** — the real `session.start_transaction()` code path has zero test coverage.
- **Impact**: On the actual deployed replica-set MongoDB, two near-simultaneous booking requests for overlapping dates on the same vehicle can both succeed — double-booking a physical vehicle, with two "confirmed" bookings, two payments, two commission snapshots, and (once trips complete) two payouts for the same asset.
- **Recommended fix**: Serialize per-vehicle booking creation with a real mutual-exclusion primitive — e.g. a unique index on a derived per-vehicle "day bucket" set, a dedicated lock document per vehicle acquired via `find_one_and_update` before the range check, or moving the conflict check to a single atomic `find_one_and_update` against the vehicle document itself (e.g. a `current_booking_window` field) rather than a separate collection scan. Add a genuine concurrency test using `asyncio.gather` against a Mongo that actually supports transactions (a replica-set test container, not the in-memory fake) before considering this closed.

### P0-2 — Owner can bypass vehicle-approval gating and list an unapproved vehicle as bookable
- **File**: `backend/server.py:2147-2154` (`PATCH /owner/vehicles/{vehicle_id}`, `owner_update_vehicle`)
- **Problem**: The owner-editable field whitelist includes `"available"` with no check against the vehicle's `verification_status`. Both `BookingService.create_booking` and `SubscriptionService.create_subscription` gate only on `vehicle.get("available", False)` — neither checks `verification_status == "approved"` anywhere. An owner can create a vehicle (`verification_status: "pending"`), then immediately `PATCH` it to `available: true`, and it becomes bookable/subscribable before any admin has reviewed it.
- **Impact**: The entire "admin approval is authoritative" guarantee the product claims (RC/insurance/pollution-certificate review before a vehicle can accept real customers) can be self-service-bypassed by any owner. This is a real trust/safety and liability gap (an uninsured or undocumented vehicle could take paying customers).
- **Recommended fix**: Either strip `"available"` from the owner-PATCH whitelist entirely (owners can toggle a separate `paused`/`owner_available` flag; effective availability = `owner_available AND verification_status == "approved"`), or add a server-side check that rejects `available: true` unless `verification_status == "approved"`, in both `owner_update_vehicle` and at the point `create_booking`/`create_subscription` check availability.

### P0-3 — OTP is returned in the API response with no production guardrail, and there is no real SMS provider
- **File**: `backend/server.py:760-780` (`POST /auth/phone/request-otp`); no `providers/sms_provider.py` exists anywhere in the codebase (confirmed absent — payment/KYC/push/AI/GPS all have a provider abstraction module, SMS does not).
- **Problem**: `SMS_PROVIDER` defaults to `"mock"` when unset, at which point `response["dev_otp"] = otp` returns the real OTP value directly in the JSON response. `_validate_env()` enforces production-safety checks for `PAYMENT_PROVIDER` and `KYC_PROVIDER` but has **no equivalent check for SMS delivery** — nothing stops this from booting in production with `SMS_PROVIDER` unset. There is also no dedicated SMS provider abstraction to switch to in the first place — this spec requirement was never built, not just left unconfigured.
- **Impact**: If deployed without explicitly setting a real SMS provider (which doesn't exist to set), every phone-OTP login/registration leaks the OTP to whoever can see the HTTP response — a full account-takeover primitive for phone-based auth.
- **Recommended fix**: Build a real `providers/sms_provider.py` abstraction (mirroring `kyc_provider.py`'s pattern) with at least one real backend (e.g. MSG91, Twilio, or a regional Indian SMS gateway), and add an `_validate_env` check that fails boot in production if `SMS_PROVIDER` is unset/mock — exactly like the existing `PAYMENT_PROVIDER`/`KYC_PROVIDER` checks.

### P0-4 — Razorpay webhook accepts unsigned payloads if the webhook secret is unset
- **File**: `backend/server.py:2997-3016` (`razorpay_webhook`)
- **Problem**: `if secret: <verify signature> else: <process anyway, no check>`. There is no `_validate_env` requirement that `RAZORPAY_WEBHOOK_SECRET` be set when `PAYMENT_PROVIDER=razorpay` in production; `render.yaml` lists it as a manually-pasted `sync: false` secret with nothing in code enforcing its presence.
- **Impact**: If ever deployed with the secret forgotten, `POST /api/webhooks/razorpay` accepts **any** unsigned payload claiming `payment.captured` for any `order_id`, silently marking that payment "succeeded" and confirming the booking — a direct real-money payment-bypass, not a theoretical one.
- **Recommended fix**: Add an `_validate_env` check: in production/staging, if `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_WEBHOOK_SECRET` must be set and non-empty, or boot fails. Do not allow the webhook handler to silently skip verification in any environment where real payment processing is enabled.

### P0-5 — `_validate_env` does not reject a wildcarded `ALLOWED_ORIGINS`
- **File**: `backend/server.py:68-71` (`_validate_env`), `server.py:3080-3096` (`CORSMiddleware` setup)
- **Problem**: The startup guard only rejects origins containing `"localhost"`/`"127.0.0.1"` — it does not reject `ALLOWED_ORIGINS=*`. If ever set that way in production, `CORSMiddleware` is configured with `allow_origins=["*"]` **and** `allow_credentials=True` simultaneously — exactly the CORS misconfiguration the spec explicitly calls out as forbidden. `render.yaml` carries a human comment warning against this, but nothing in code enforces it.
- **Impact**: Any origin could make credentialed cross-site requests against the API (partially mitigated by browsers rejecting `*` + credentials per spec, but this is not a safety net anyone should rely on, and non-browser clients aren't protected at all).
- **Recommended fix**: Add an explicit `if "*" in allowed_origins: raise RuntimeError(...)` check to `_validate_env` alongside the existing localhost check.

---

## P1 — Serious production risk

| # | Finding | File / Function |
|---|---|---|
| P1-1 | Pricing shown to a customer via `POST /pricing/quote` (surge/weekend/festival/weather-adjusted via `DynamicPricingEngine`) is structurally disconnected from what's actually charged at booking creation — `BookingService._rental_amount` uses a flat `price_per_X * units` formula with none of the quote engine's multipliers, and `BookingCreate` has no `quote_id`/locked-price field linking the two. | `backend/features/booking/service.py:42,256-268` vs `backend/raidex_platform/pricing.py:6-26` |
| P1-2 | `POST /payments/{payment_id}/refund` has no atomic claim (unlike `payments_confirm`, which correctly uses `find_one_and_update`). It reads the payment, calls the gateway, then writes "processed" — two concurrent refund requests for the same payment can both pass the pre-check, both trigger a real gateway refund call, and both credit the wallet ledger, with the second write just overwriting the first's terminal state and masking that two refunds actually fired. | `backend/server.py:1310-1335` |
| P1-3 | `GET /nexus/threads/{thread_id}` has no `user_id` filter at all — any authenticated user who obtains/guesses a `thread_id` can read another user's entire AI-support transcript (which may contain booking IDs, dispute details, personal complaints). Mitigated somewhat by `thread_id` being server-generated (not client-chosen), but this is a real, unmitigated IDOR on the read path — every other thread-adjacent write path in the same file does scope by `user_id`. | `backend/server.py:2940-2943` |
| P1-4 | `NotificationService.notify()` writes rows to `notification_outbox` per channel but **never actually sends them** — the method that calls the push sender (`send_push_for_event`) is never invoked from `server.py`, and no scheduled job drains the outbox. Every booking/payment/KYC/trip/payout/subscription/swap/milestone "notification" today only ever produces an in-app row; push notifications are silently never delivered in production. (The owner-anomaly cron bypasses this and pushes directly, which is inconsistent with — and highlights — the gap.) | `backend/raidex_platform/notifications.py:13-68`, confirmed via repo-wide grep of `send_push_for_event` call sites |
| P1-5 | Admin console has real backend support for KYC approve/reject and dispute resolution (`POST /admin/kyc/{id}/approve`/`/reject`, `PATCH /admin/disputes/{id}`), and even has frontend API helper functions for them (`approveKyc`, `updateDispute` in `frontend/src/features/admin/api/admin.ts`) — but **no screen in the shipped admin console calls them**. The KYC tab is read-only status display; the Disputes tab is read-only. An admin literally cannot approve a KYC submission or resolve a dispute anywhere in the app. | `frontend/app/admin/index.tsx` (KYC tab ~334-350, Disputes tab ~370-386) vs `frontend/src/features/admin/api/admin.ts` |
| P1-6 (adjacent to P1-5) | When an admin turns on `vehicle_swap_requires_approval` via the Flags tab, swaps land in `"requested"` state — but there is no admin UI anywhere to approve or reject them (`/admin/vehicle-swaps/{id}/approve`/`/reject` are backend-only). Turning that flag on today would strand every swap request indefinitely. | `frontend/app/admin/index.tsx` (no Vehicle Swaps tab) vs `backend/server.py:2539-2559` |
| P1-7 | `kyc_submissions` has no index on `kyc_id` (used by every admin approve/reject point-lookup) and no index on `status` (used by the admin KYC queue filter) — only `[user_id, submitted_at]` exists. This is an operational-scaling admin workflow, not a cosmetic query. | `backend/server.py:2608-2617,2623,2640` vs index list at `server.py:3144` |

---

## P2 — Non-blocking, should be fixed before wide launch

- **Dead hardcoded commission rate in unused code**: `backend/server_sqlite.py:1317,1367` hardcodes `0.15` independent of `CommissionService` (whose real default is `0.40`). Confirmed `server_sqlite.py` is not the production entrypoint (`Procfile`/`render.yaml` both target `server:app`), so no live financial impact — but it's a landmine sitting in the same package that silently drifts from the real commission logic. Recommend deleting or very visibly gating this file.
- **`payments_create` "deposit" purpose has no amount-floor validation** — unlike `booking`/`subscription`/`subscription_renewal`, a `purpose: "deposit"` payment only checks `amount > 0`, with no check against `booking.deposit`. `backend/server.py:1118-1201`.
- **Simulated GPS fallback is indistinguishable from real telemetry once it reaches the backend** — `frontend/app/trip/[booking_id].tsx` posts fabricated coordinates to the same `POST /gps/track` endpoint used by real device GPS whenever `expo-location` is unavailable/denied/on web, with only a client-side "sim" label; the backend's `GpsTrackIn` model has no `source`/`is_simulated` field. No direct financial impact (mileage comes from odometer readings, not GPS), but undermines any future dispute/anti-fraud reliance on geofence event history.
- **Refund produces no user-facing notification at all** — `POST /payments/{payment_id}/refund` updates state and credits the wallet but never calls `NotificationService`/`emit_domain_event`. `backend/server.py:1310-1335`.
- **`POST /auth/refresh` has zero rate limiting** — every other unauthenticated auth endpoint (register/login/OTP/google-session) has a slowapi decorator; refresh has neither that nor `check_rate_limit`. Given 60-day refresh token lifetime, this is a conspicuous gap for replay/brute-force throttling. `backend/server.py:913`.
- **Large surface of admin-panel backend routes with no console UI at all**: `/admin/bookings` (no Bookings tab — only Payments), `/admin/reconciliation` (ledger health invisible to admins), `/admin/subscriptions`, `/admin/service-milestones/config`, `/admin/service-benefits`+`/fulfill`, `/admin/audit`, `/admin/fraud/risk` (fraud flags raised by the `scan_fraud_rules` job are never surfaced anywhere), `/admin/analytics/dashboard`, `/admin/observability/dashboard`, `/admin/jobs` (no job-health visibility), `/admin/notifications/retry-failed` (no retry button), `/admin/nexus/health`. Each individually is P2; collectively this is a meaningful operational blind spot for whoever runs RAIDEX day-to-day.
- **Missing indexes** beyond the P1 KYC one: `subscriptions.owner_id` (used by `GET /owner/subscriptions`), `subscriptions.status`/`vehicle_swaps.status` (used by the admin status-filter queries), `service_benefits.vehicle_id` (used by `GET /owner/service-benefits`). All currently full-scan.
- **No automated/scheduled backup creation** — `scripts/backup_mongodb.ps1` exists and works, but nothing schedules it (no cron entry, no CI trigger); backup cadence depends entirely on a human remembering to run it. Documented in `docs/DATABASE.md`, so not a hidden gap, but still a real operational risk.
- **`.github/workflows/release.yml` runs `npm audit --audit-level=high` as a hard fail**, while `ci.yml` explicitly and deliberately treats the identical finding as advisory-only with a documented rationale. The release workflow can hard-block a release on a risk the team has already consciously accepted elsewhere.
- **OTP resend has no phone-number-scoped cooldown** — only IP-keyed slowapi throttling exists; an attacker distributing requests across IPs can SMS-bomb one victim phone number.
- **Several admin-mutation routes aren't covered by `check_rate_limit`** — KYC approve/reject, vehicle approve/reject, payout mark-failed, feature-flag toggle, service-benefit fulfill. Lower severity since all are already role-gated, but inconsistent with the two other admin-mutation routes that are covered.
- **`service_milestones.check_and_award` has a non-transactional check-then-write gap** under true concurrency (two simultaneous trip completions on the same vehicle crossing the same threshold could both pass the "not yet awarded" check before either writes) — narrower blast radius than the booking race since it only affects benefit issuance, not money movement or asset double-allocation.
- **`PayoutService.mark_paid` has no internal idempotency guard** of its own — the caller in `server.py` checks `before["status"] == "paid"` first, so it's safe today, but the guarantee lives in the caller rather than the service method itself.
- **Python runtime version drift**: `backend/render.yaml`/`runtime.txt` pin `3.12.0`, `.python-version` pins `3.12.11`, CI floats `"3.12"` — three different resolutions of "the same" version across dev/CI/deploy.

---

## P3 — Future improvement / low-severity polish

- 30-day JWT access-token TTL is long for an access token (mitigated by working `jti` revocation check on every request).
- Web token storage uses `localStorage` (standard Expo web tradeoff vs. `SecureStore` on native — inherently more XSS-exposed, not a bug).
- `PATCH /owner/vehicles/{id}`'s response re-fetch isn't scoped by `owner_id` (the actual update is correctly scoped) — no real confidentiality impact since vehicle data is already public via `GET /vehicles/{id}`, but incorrect by contract.
- `GET /owner/stats` is missing `_require_role(user, "owner")` — currently harmless because the handler returns fully hardcoded placeholder numbers, not real per-owner data, but would become a real bug the moment it's wired to real data without someone remembering the role check.
- `providers/payment_gateway.py`'s `RazorpayGateway.confirm` puts `str(exc)` into `failure_reason`, which flows back to the client via the payment record — low-severity internal detail leakage, not a secrets leak.
- Referral `reward_miles` is recorded at referral creation but never actually credited via the RideMiles ledger anywhere in the codebase — the reward is promised but not paid; also means no "reward" notification can ever fire for it.
- Inspection duplicate-submission check runs after the booking-status gate rather than before, producing a misleading error instead of an idempotent response in one unreachable-via-normal-flow edge case.
- Odometer readings that drive mileage/RideMiles are self-reported via a plain numeric field with no photo/OCR cross-check — a trust-boundary note, not a code bug.

---

## Authorization audit summary (customer / owner / admin)

A full endpoint-by-endpoint IDOR sweep was performed across every route taking a `{resource}_id` (bookings, payments, subscriptions, swaps, payouts, KYC, notifications, reviews, wallet, disputes, geofence, wishlist, GPS, media). Result: the overwhelming majority (30+ endpoints checked individually) correctly scope by `user_id`/`owner_id`/admin role. The only confirmed authorization defects are **P1-3** (Nexus thread IDOR) and **P0-2** (owner vehicle-approval bypass) above, plus the low-severity **P3** items (`/owner/vehicles/{id}` PATCH read-back, `/owner/stats` missing role check). Every `/admin/*` route (38 total, enumerated by the audit) was independently confirmed to call `_require_role(user, "admin")`. JWT role/roles claims cannot be forged by a client — `get_current_user` resolves the trusted `user` record from the DB by the token's subject, never from client-supplied claims or request body fields. `$regex` construction is consistently `re.escape()`-guarded everywhere user input reaches a Mongo query. No raw exception text (`str(e)`) is returned to clients anywhere in `server.py` itself (one low-severity exception noted in `payment_gateway.py`, P3 above).

## Financial invariant chain: BOOKING → PAYMENT → COMMISSION → OWNER PAYABLE → PAYOUT

Traced end-to-end and confirmed **sound in isolation**: commission is snapshotted once at booking creation and every downstream reader (payout, owner earnings) reads that frozen snapshot rather than recomputing live; `create_payout_for_booking` is genuinely idempotent (DB-enforced via a real partial-unique index plus an application-level check, both verified by passing tests); a subscription payment produces exactly one payout keyed by `payment_id`, coexisting safely with booking-keyed payouts via the partial-index redesign. **The chain's only structural weakness is upstream of it** — the P0-1 booking race means the "one booking, one vehicle, one time slot" precondition the whole chain assumes is not actually guaranteed under concurrent load.

## Duplicate/retry testing — results

| Scenario | Result |
|---|---|
| Duplicate payment webhook | **Safe** — atomic `find_one_and_update({"status":"created"})` claim plus a separate `webhook_events` event-id dedup ledger; both layers verified correct by direct trace. |
| Duplicate payment confirmation | **Safe** — same atomic-claim mechanism; a replay after settlement returns the existing record untouched, no side effects re-run. |
| Duplicate booking request (same instant, overlapping range) | **Unsafe — see P0-1.** No test proves otherwise; the one related test doesn't exercise concurrency at all. |
| Concurrent booking requests | **Unsafe — see P0-1.** |
| Duplicate payout | **Safe** — DB-enforced partial-unique index + application check, test-verified (`test_create_payout_is_idempotent_for_retried_completion`, passing). |
| Duplicate RideMiles reward | **Safe** — every `_append_miles_ledger` call site audited (4 total); all are gated behind either a booking-status guard (`end_trip`) or an atomic payment-status claim (`payments_confirm`, the Razorpay webhook). No path can award RideMiles twice for the same event. |
| Duplicate service milestone | **Mostly safe, one gap** — idempotent by design (`awarded_thresholds_km` tracking), but the check-then-write is not itself transactional; a true simultaneous double-completion on one vehicle crossing a threshold at the same instant could theoretically double-award. Test-verified for the sequential case. |
| Duplicate vehicle swap | **Safe** — `complete_swap`'s atomic `find_one_and_update` claim on the target vehicle's `available` field prevents two swaps from both claiming the same vehicle; a second `complete_swap` call on an already-completed swap is a verified no-op. |
| Duplicate subscription activation | **Safe** — `activate()` only transitions a `pending_payment` subscription once; a second call is a no-op returning the already-active record, test-verified. |
| Refund retry | **Unsafe — see P1-2.** No atomic claim; two concurrent refund calls can both execute a real gateway refund. |

## Production-safety guardrails — what actually stops a bad deploy

| Guard | Status |
|---|---|
| `PAYMENT_PROVIDER=mock` in production | **Blocked** by `_validate_env` |
| `KYC_PROVIDER=stub` in production | **Blocked** by `_validate_env` |
| `SMS_PROVIDER` mock/unset in production | **Not blocked — P0-3.** No abstraction, no guard. |
| `ALLOWED_ORIGINS=*` in production | **Not blocked — P0-5.** |
| Weak/default `JWT_SECRET` in production | **Blocked** — hard `RuntimeError` at boot. |
| Auto-generated `ADMIN_PASSWORD` logged in production | **Blocked** — requires explicit `ADMIN_PASSWORD` or boot fails. |
| `RAZORPAY_WEBHOOK_SECRET` unset while `PAYMENT_PROVIDER=razorpay` | **Not blocked — P0-4.** |
| `server_sqlite.py` accidentally deployed | **Not possible** — neither `Procfile` nor `render.yaml` reference it; confirmed clean. |
| Debug behavior otherwise | No `DEBUG` flag or equivalent found enabling unsafe behavior beyond the items above. |

---

## Automated checks run as part of this audit

- `pytest -q` (full suite): **127 passed, 2 skipped**
- `pytest -k booking/payout/subscription/swap/milestone/reconcil/job/rate_limit` (targeted subsets): all passed, verbatim output captured per-area above
- `pip-audit -r backend/requirements.txt`: clean, no known vulnerabilities
- Frontend `npx tsc --noEmit`: exit 0
- Frontend `npm test`: 44 passed, 12 suites
- Frontend `npx eslint .`: 0 errors, 12 pre-existing warnings (no new issues)
- Frontend `npm audit --omit=dev`: 54 findings (2 low / 32 moderate / 19 high / 1 critical), all traced to the Expo 51 / Metro build-tool dependency chain — already known and deliberately deferred (documented in `ci.yml` as advisory-only pending an Expo SDK major upgrade with its own QA pass). Not runtime-app-code exposure.
- Maestro E2E: **not runnable** in this environment (no Maestro CLI, no emulator/device). Static check only: both existing flows' referenced `testID`s and text assertions were confirmed to still match current UI (not stale) — but neither flow exercises any of subscriptions/swap/reviews/admin-payouts/feature-flags, so there is effectively zero E2E coverage of everything built in the most recent implementation pass.

---

## RELEASE VERDICT

# NOT READY

Five P0 findings — a booking-engine race that can double-allocate a physical vehicle under real concurrent load, a self-service bypass of vehicle-approval review, an OTP/SMS delivery gap with no production guardrail that can leak one-time passcodes, a payment-webhook path that accepts unsigned events if a secret is ever left unset, and a CORS wildcard hole in the production-safety validator — are each independently disqualifying for a real-money launch. None of these are exotic; each would be found by a motivated attacker or hit in ordinary production traffic (the booking race in particular needs no attacker at all, just two customers booking the same popular vehicle at the same time).

This is **not** a verdict driven by the passing test suite being insufficient in volume — 127 backend tests passing is a genuinely strong signal for everything they actually cover (payout idempotency, RideMiles dedup, subscription/swap correctness, KYC gating, IDOR scoping on 30+ endpoints, ledger reconciliation). The issue is specifically that the test suite's own architecture (a fake Mongo that can never exercise a real transaction) structurally cannot catch P0-1, and the other four P0s are the class of defect that unit tests don't reach at all — they're guardrail/config-validation gaps, not logic bugs.

**Path to READY FOR CLOSED BETA**: fix all five P0s (the SMS/OTP one requires standing up a real SMS provider, which is the largest of the five; the other four are each a bounded, well-scoped code change). At that point a closed beta with a small, trusted user base and manual admin oversight (compensating for the missing KYC-approval/dispute-resolution admin UI in the interim) would be reasonable.

**Path to READY FOR PRODUCTION**: additionally close the P1s — especially the refund race, the Nexus IDOR, and the dead push-notification pipeline (customers will not learn about booking/payment/trip events they're currently relying on push for) — and wire up the admin console gaps for KYC/dispute/swap-approval so the backend's own workflows are actually operable end-to-end by a real admin team.
