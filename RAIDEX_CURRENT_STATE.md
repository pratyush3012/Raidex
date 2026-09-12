# RAIDEX — Current State Audit

Audited against the RAIDEX Master Product Specification (business model, commission, RideMiles, service milestones, subscriptions, vehicle swap, AI Nexus, GPS, security rules).

**Important note on session state:** earlier in this same session (before this audit request arrived) a set of verified fixes were already applied and are reflected in "current behavior" below — they are explicitly marked `[FIXED THIS SESSION]`. Everything else describes the codebase as it stands right now, unmodified since. No code has been changed since that request to stop and audit.

Stack confirmed: FastAPI + MongoDB backend (`backend/server.py`, real/authoritative) with a parallel SQLite dev fallback (`backend/server_sqlite.py`); Expo/React Native frontend (`frontend/app`, `frontend/src`); JWT + Google-session auth; Razorpay/mock payment provider; stub/Karza/IDfy KYC provider abstraction; MongoDB for all persistence (a Supabase/Postgres schema exists but is unused, planning-only).

---

## 1. What is fully implemented

| Area | File/path | Behavior |
|---|---|---|
| Auth (register/login/phone-OTP/Google session/refresh/logout) | `backend/server.py:600-870` | JWT access + refresh tokens, device-session store, bcrypt hashing, revocation list. `[FIXED THIS SESSION]` logout now also revokes the refresh-token's device session. |
| KYC submit/status/admin review | `backend/server.py:915-1010`, `2100-2135` | Stub verifier auto-approves/rejects on rule checks; Karza/IDfy real-provider classes exist (`backend/providers/kyc_provider.py`) but are unused by default (`KYC_PROVIDER=stub`). `[FIXED THIS SESSION]` documents now stored via GridFS (`fs_bucket`) instead of inline base64, with a realistic size cap. |
| Vehicle discovery, detail, reviews, wishlist | `backend/server.py` (vehicles/reviews/wishlist routes); `frontend/app/(tabs)/index.tsx`, `frontend/app/vehicle/[id].tsx` | Search/filter/sort, ratings, reviews list (no review-submission UI yet), wishlist toggle. |
| Booking lifecycle (create/extend/cancel/invoice/dispute) | `backend/features/booking/service.py` | `[FIXED THIS SESSION]` `create_booking`'s conflict-check+insert now runs inside a Mongo transaction (with a non-transactional fallback for standalone/dev Mongo) to close the double-booking race. `[FIXED THIS SESSION]` `cancel_booking` now actually calls the payment gateway's refund and credits the wallet ledger when a succeeded payment exists, instead of only recording a `refund_due` number. |
| Payments (mock + Razorpay) create/confirm/refund/webhook | `backend/server.py:1000-1250`, `2440-2520`; `backend/providers/payment_gateway.py` | Real Razorpay order-create/HMAC-verify/refund implementation exists. `[FIXED THIS SESSION]` `payments_confirm` and the Razorpay webhook now atomically claim the payment (`find_one_and_update`) before processing, closing the double-confirmation race. |
| Trip lifecycle (before/after inspection, start/end, mileage) | `backend/server.py:1470-1620` | Requires before-inspection to start, after-inspection to end; computes `miles_earned` and updates vehicle `lifetime_km`. This `lifetime_km` field is exactly the raw data the spec's "vehicle service milestone" feature needs — see §5 and §11. |
| RideMiles ledger | `backend/server.py:1072-1090` | Append-only ledger (`ride_miles_ledger` collection) with balance-after snapshots — matches the spec's "never overwrite balance, immutable ledger" requirement. |
| Owner dashboard (vehicles, bookings, earnings — read-only) | `backend/server.py` owner routes; `frontend/app/owner/index.tsx` | Basic stats and lists; no payout automation (see §2). |
| Admin console (users, KYC, vehicles, bookings, payments, disputes, geofence, audit) | `backend/server.py` admin routes; `frontend/app/admin/index.tsx` | Broad coverage; audit log entries written on sensitive actions (`admin_audit` collection). `[FIXED THIS SESSION]` `GET /api/geofence-events` no longer leaks all owners' events to any authenticated user (was an IDOR — see §6). |
| Maps | `frontend/src/features/maps/MapView.tsx` (new), `frontend/app/(tabs)/index.tsx`, `frontend/app/vehicle/[id].tsx` | `[FIXED THIS SESSION]` A real MapLibre GL + free-OpenStreetMap-tile map (WebView, with a web/failure fallback) is now what's actually rendered on the discovery screen and on the vehicle detail screen. Previously the shipped screen showed a purely decorative fake map while the real implementation sat dead/unused. |
| Deployment config coherence | `backend/Procfile`, `backend/render.yaml`, `backend/requirements-deploy.txt` | `[FIXED THIS SESSION]` Procfile now runs the real Mongo server (`server:app`), not the SQLite dev fallback; `render.yaml`'s env vars no longer contradict the app's own production-safety checks (mock/stub providers, wildcard CORS); FastAPI version and Sentry dependency now consistent with what's tested. |
| CI / index-script drift | `.github/workflows/ci.yml`, `backend/setup_mongodb.py` | `[FIXED THIS SESSION]` CI now runs Python 3.12 (matching the deploy runtime) and blocks merges on `pip-audit` findings (currently clean); `setup_mongodb.py` now calls the same `create_indexes()` function the app's own startup hook uses, so the two can't drift out of sync again. `scripts/verify_restore.ps1` now actually verifies restored document counts instead of always printing success. |

## 2. What is partially implemented

| Area | File/path | Current behavior | Intended behavior (spec) | Severity |
|---|---|---|---|---|
| Owner payouts | `backend/server.py` `/owner/payouts` | Reads from a `payouts` collection nothing ever writes to — always returns empty. | Spec §16: owner must see gross/commission/fees/net payout with payout status, auditable. | High |
| Commission | `backend/server.py:1917, 2023, 2326-2330` | Hardcoded `commission_rate = 0.15` (15%) in **three separate places**, independent of any config. | Spec §4: commission must be backend/admin-configurable, support per-category/owner/promo overrides, and the doc's own target figure is 40% (a business decision to confirm) — but the core defect is that it's hardcoded and duplicated at all. | High |
| Rate limiting | `backend/raidex_platform/rate_limits.py`; `backend/server.py` | A role-based rate-limit scheme is fully defined but never imported/used. Only 4 auth endpoints have `@limiter.limit(...)`; booking, payment, and everything else is unlimited. | Spec §35 (abuse/brute-force protection) implies rate limiting on sensitive endpoints broadly, not just auth. | Medium |
| Background jobs registry | `backend/raidex_platform/jobs.py` | `insurance_reminders`, `document_expiry_reminders`, `trip_reminders`, `payment_reconciliation`, `fraud_scans`, `analytics_aggregation` are registered as metadata only — no handlers exist. Only `owner_anomaly` (§5 below) is wired to a real cron. | Spec §31 (owner re-engagement/anomaly detection) and general ops automation. | Medium |
| Owner anomaly / re-engagement AI job | `backend/cron/owner_anomaly.py`; scheduled in `server.py` startup | Exists and is scheduled daily, but depends on the `emergentintegrations` package, which is **not in any requirements file** — every run raises `ImportError` inside a broad `except Exception`, so it silently no-ops every day. | Spec §31: "detect anomaly → notify owner" should actually run. | High |
| AI Nexus (Support/Ops/Finance agents) | `backend/server.py:2295-2400`, `/nexus/support/chat`, `/nexus/ops/query`, `/nexus/finance/query` | Structurally matches the spec's three named agents well (§32) — but see §5 (broken dependency) and §5/§7 (hallucinated features). | Spec §32-33: AI recommends, human/rules validate for sensitive actions. No sensitive-action execution exists yet (agents are read-only/informational), which is actually **compliant** with §33 — the gap is only that the agents can't run at all today. | High (availability), not a safety-rule violation |
| Frontend feature API layer | `frontend/src/features/{admin,booking,vehicles,payments,reviews,wishlist}/api/*.ts` | Fully written and unit-tested, but **no screen in `frontend/app/**` imports any of them** — every real screen calls the API client directly with inline path strings instead. Two parallel implementations of the same endpoints exist. | Not a spec conflict per se, but a maintainability/consistency risk and a sign the "Feature Location Guide" in `docs/FRONTEND.md` doesn't describe the wired app. | Low-Medium |
| Offline support | `frontend/src/utils/offline.ts`, `frontend/src/api/client.ts` | `[PARTIALLY FIXED THIS SESSION]` A `flushQueuedRequests()` was added and wired to `OfflineBanner`'s reconnect event, and the wishlist toggle now queues on failure. Not yet audited: whether every mutating screen (payments, bookings) consistently passes `queueOnFailure`. | Full offline-tolerant writes across all mutating flows. | Low-Medium |

## 3. What is mocked / stubbed

| Area | File/path | Current | Production requirement |
|---|---|---|---|
| Payments | `backend/providers/payment_gateway.py`; `.env.example` default `PAYMENT_PROVIDER=mock` | `MockGateway` (95% random success) is the default. Real `RazorpayGateway` exists and is wired correctly end-to-end (frontend `RazorpayCheckout.tsx` + backend confirm/webhook), but needs live Razorpay keys to activate. | Spec §12: Razorpay in production, server-side signature verification (already implemented), idempotent webhook (already implemented). |
| KYC | `backend/providers/kyc_provider.py`; default `KYC_PROVIDER=stub` | `StubKYCProvider` does local field-presence/format checks only, no real document verification. `KarzaProvider`/`IDfyProvider` are implemented but untested (no contract tests beyond the stub) and unused by default. | Spec §9: real KYC provider (IDfy/Karza/HyperVerge) in production. |
| SMS/OTP | `backend/server.py` phone-OTP flow | `SMS_PROVIDER=mock` always in both backends; dev OTP is literally returned in the API response when mocked. No dedicated `providers/sms_sender.py` abstraction exists (unlike payment/KYC/push, which do have one). | Needs a real SMS provider abstraction before production phone auth. |
| Damage AI inspector | `backend/providers/damage_inspector.py` | Only `StubInspector` exists; the factory falls back to it even if a different provider name is configured — there is no way to select a real provider today. | Spec §21-22: AI-assisted damage comparison as an assistant, not sole authority (current stub is compliant with "assistant only," but does no real detection). |
| Social login | `frontend/src/context/AuthContext.tsx:159-165` | `loginWithGoogle`/`loginWithApple` are hardcoded to always throw. `[FIXED THIS SESSION]` the UI buttons are now visibly disabled ("Coming soon") instead of presenting a broken action. | Real OAuth needs the user's own Google/Apple developer app credentials — out of scope until provided. |
| Vehicle GPS | `frontend/app/trip/[booking_id].tsx`; `backend/server.py` geofence/GPS routes | Uses the **customer's phone GPS** (`expo-location`) exclusively. There is no vehicle-installed-hardware telemetry integration anywhere. | Spec §17-18 explicitly distinguishes phone GPS (fine for MVP) from a future vehicle-hardware GPS provider integration — current code does not yet have the abstraction seam for that future swap (it's all inline `expo-location` calls, no provider interface). |

## 4. What is broken

| # | File/path | Current behavior | Intended | Severity | Status |
|---|---|---|---|---|---|
| 1 | `backend/server.py` `/wallet/topup` (`~line 1794`) | Endpoint is admin-only (good), but it credits `user["user_id"]` — **the calling admin's own wallet** — with no `target_user_id` parameter, even though its own docstring says "Admin-only wallet credit for customer support adjustments" (implying crediting a *customer's* wallet). As written it cannot actually be used for its stated purpose. | Admin should be able to specify which user's wallet to credit. | High | **Open** |
| 2 | AI Nexus system prompts | `backend/server.py:2296` (`FIN_SYS`/tagline text) | The AI's own system prompt tells it to describe "monthly subscriptions" and "vehicle swap" as existing product features — **neither is implemented anywhere in the codebase** (see §5). The support/finance AI will confidently tell customers about features that don't exist. | Spec's own AI Nexus rules (§32-33) imply the AI shouldn't misrepresent product capabilities. | High | **Open** |
| 3 | `backend/cron/owner_anomaly.py` + `/nexus/*` endpoints | Depend on `emergentintegrations`, not in any requirements file → `ImportError` swallowed by broad `except Exception`, silently no-ops. | Should either install the dependency or fail loudly/report status so it's noticed. | High | **Open** |
| 4 | Payment method selector | `frontend/app/checkout/[booking_id].tsx` | `[FIXED THIS SESSION]` — was previously fully cosmetic (chosen method never reached the backend or pay screen); now Card/UPI/Net Banking selections are forwarded to Razorpay's own checkout to restrict/preselect the method, and the non-functional "Raidex Wallet" option was removed rather than left as a fake choice. | — | Medium | **Fixed** |
| 5 | Sentry (frontend) | `frontend/src/observability/sentry.ts` | `[FIXED THIS SESSION]` — DSN was read via `"EXPO_PUBLIC_" + "SENTRY_DSN"` string concatenation, which defeats Expo/Metro's static env-var inlining and silently disabled Sentry in real builds. Now reads the literal `process.env.EXPO_PUBLIC_SENTRY_DSN` form (config exposed as a mutable `sentryConfig` object so it stays unit-testable despite the inlining). | — | High | **Fixed** |
| 6 | E2E tests | `.maestro/customer_journey.yaml`, `.maestro/owner_admin_smoke.yaml` | `[FIXED THIS SESSION]` — both asserted `"Nearby vehicles"`, a string that doesn't exist anywhere in the app (actual heading is `"Nearby rides"`); both flows would have failed on that assertion. Corrected. | — | Medium | **Fixed** |
| 7 | Deployment (Procfile/render.yaml) | `backend/Procfile`, `backend/render.yaml` | `[FIXED THIS SESSION]` — Procfile launched the untested SQLite fallback server while render.yaml targeted the real Mongo server; render.yaml's own env values would have made the app refuse to boot in production (`RuntimeError` from its own safety guard). Corrected. | — | Critical | **Fixed** |
| 8 | `backend/setup_mongodb.py` | Stale, hand-duplicated index list covering ~17 of the real ~35 collections. | `[FIXED THIS SESSION]` — now delegates to the same `create_indexes()` the app itself uses. | — | Medium | **Fixed** |
| 9 | `scripts/verify_restore.ps1` | Ran `mongorestore --drop` and printed "completed" unconditionally, verifying nothing. | `[FIXED THIS SESSION]` — now count-checks every restored collection against the backup's own `.bson` files and fails on mismatch. | — | Medium | **Fixed** |

## 5. What conflicts with this specification

| Spec section | Conflict | File/path | Severity |
|---|---|---|---|
| §4 Commission | Must be configurable, never hardcoded; target 40%. | Code hardcodes `0.15` (15%) in 3 places (`backend/server.py:1917,2023,2326`). Both the value and the lack of configurability conflict with spec. | High |
| §25-26 Service milestones | Owners should receive a service benefit when a vehicle's cumulative RAIDEX-platform mileage crosses a configurable threshold. | `lifetime_km` is tracked (`backend/server.py:1522`) but nothing reads it against a milestone table, notifies the owner, or records a benefit. Feature does not exist beyond the raw counter. | Not built (roadmap item, see §11) |
| §27-28 Subscriptions & vehicle swap | Should exist as a booking mode distinct from hourly/daily/weekly/monthly, with swap eligibility rules. | No subscription entity, no swap entity, no related endpoints anywhere in `backend/` or `frontend/`. Only referenced in marketing copy and the AI system prompt (see §4 bug #2). | Not built (roadmap item) |
| §17-18 GPS architecture | Should be built so a future vehicle-hardware GPS provider can be swapped in without an architecture rewrite. | Current GPS/location code is 100% inline `expo-location` calls on the customer's phone; there is no `providers/gps_provider.py`-style abstraction analogous to the payment/KYC/push provider pattern already used elsewhere in this codebase. | Architectural gap, not a bug — worth fixing before vehicle-hardware integration is attempted |
| §29 Wallet security | Users must not create arbitrary wallet money through an unsecured API. | The only direct-credit path (`/wallet/topup`) is correctly admin-gated — **no spec conflict found here**, this is compliant. (Its self-credit bug is tracked separately in §4.) | — |
| §36 Data model / ledgers | Wallet ledger, RideMiles ledger, payment records, payout records, admin audit logs should be append-oriented and auditable. | Wallet ledger (`wallet_ledger`) and RideMiles ledger (`ride_miles_ledger`) are both genuinely append-only with balance-after snapshots — compliant. Payout records (`payouts` collection) exist as a schema but nothing ever writes to them (see §2) — not yet auditable because nothing is recorded. | Partial conflict |
| §9 KYC data handling | Should not log sensitive KYC data in plaintext / should not store raw documents inefficiently. | `[FIXED THIS SESSION]` — was storing full base64 image data inline on the `kyc_submissions` document; now stored via GridFS with only a file reference on the document. | Resolved |

## 6. Security risks

| # | File/path | Risk | Severity | Status |
|---|---|---|---|---|
| 1 | `backend/server.py` `GET /api/geofence-events` | IDOR — the query's `$or` clause matched every event regardless of owner, letting any authenticated user read any other owner's security/geofence events. | Critical | **Fixed this session** |
| 2 | `backend/server.py` `payments_confirm` + Razorpay webhook | Race condition — both read-then-wrote payment status non-atomically; a racing webhook and client confirm could both pass the status check and double-process a payment (double RideMiles, double notification). | High | **Fixed this session** |
| 3 | `backend/features/booking/service.py` `create_booking` | Race condition — conflict-check and insert were not atomic; two concurrent requests for overlapping dates could both pass and double-book a vehicle. | High | **Fixed this session** |
| 4 | `backend/server.py` `/auth/logout` | Logout only revoked the access-token `jti`; the refresh token (valid up to `REFRESH_EXPIRE_DAYS=60`) stayed valid and could keep minting new access tokens after "logout". | High | **Fixed this session** |
| 5 | `backend/server.py` admin bootstrap (`seed_data`) | Auto-generated admin password was written to `logger.warning`, which can leak into log aggregators/Sentry breadcrumbs in production. | Medium-High | **Fixed this session** — production/staging now requires `ADMIN_PASSWORD` explicitly and fails fast instead. |
| 6 | `backend/render.yaml` (as originally committed) | `ALLOWED_ORIGINS: "*"` combined with `allow_credentials=True` in CORS middleware — insecure and functionally broken (browsers reject wildcard-origin + credentials). | High | **Fixed this session** |
| 7 | `backend/server.py` `/wallet/topup` | Self-credit bug (see §4 #1) is not itself an authorization bypass (still admin-gated), but the docstring/behavior mismatch means an admin using it as documented would silently credit the wrong account. | Medium | **Open** |
| 8 | `backend/server.py` KYC documents | Were stored as raw base64 inline (no object storage, per the project's own `docs/DATABASE.md` guidance). | Medium | **Fixed this session** (moved to GridFS) |
| 9 | Rate limiting | Only 4 auth endpoints are rate-limited; booking/payment/most endpoints have none. A pre-built role-based scheme (`raidex_platform/rate_limits.py`) sits unused. | Medium | **Open** |
| 10 | `npm audit` (frontend) | 1 critical (`node-tar`, via `cacache` → `@expo/cli` build tooling), ~19 high findings, mostly in the Expo/Metro build-tool dependency chain (not runtime app code shipped to end users). A real fix requires a major Expo SDK bump (breaking change) that needs its own manual QA pass. | Critical (build-tooling scope) / not exploitable via the shipped app itself | **Open, deliberately deferred** — CI's `npm audit` step is intentionally kept advisory-only until this is addressed with proper QA (see `.github/workflows/ci.yml` comment). |
| 11 | `backend/server.py` Nexus agent error handling | Some 500 responses leak raw exception text (`str(e)`) into the HTTP detail field. | Low (info disclosure) | **Open** |

## 7. Business logic risks

- **Commission hardcoded in 3 places, at 15% not the spec's stated 40%.** Any change to RAIDEX's take rate today requires a code change and redeploy in three separate spots, with real risk of the three drifting out of sync with each other (they already show different rounding contexts). See §5.
- **AI Nexus describes non-existent features to users** (subscriptions, vehicle swap — see §4 #2). A customer asking the support AI about a subscription plan would get a confidently wrong answer about a real product capability that doesn't exist, which is a genuine trust/business risk given the spec's emphasis on transparency.
- **Owner payouts are not automated or recorded anywhere** (§2) — owners have no way to see real payout status, and RAIDEX has no operational payout-processing flow at all, only a placeholder read endpoint returning an always-empty list.
- **No service-milestone benefit logic** despite tracking the exact `lifetime_km` counter the feature needs — the core owner-retention mechanic the spec calls out as a key differentiator (§25-26) doesn't exist yet beyond raw data collection.
- **New users are seeded with `wallet_balance: 500` and `ride_miles: 250`** (`backend/server.py:278-279` model default, and again at several registration code paths). This looks like an intentional signup-bonus design choice, but it's worth the business owner explicitly confirming it (500/250 on every signup, with no apparent cap or fraud check on repeat signups via different emails/phones, is a potential abuse vector at scale).
- **No subscription or vehicle-swap revenue model exists** despite being called out as a core differentiator (§27-28) — this is 100% roadmap, not a partial implementation.

## 8. Data integrity risks

- **Payout ledger is unpopulated** — no invariant enforced between "money owed to owner" and "money actually paid out" because nothing writes payout records at all (§2, §6).
- **`wallet_ledger`/`ride_miles_ledger` are correctly append-only**, but there is no reconciliation job verifying `sum(ledger deltas) == current balance field` on the user document — if a future code path ever updates `wallet_balance`/`ride_miles` directly without going through `_append_wallet_ledger`/`_append_miles_ledger`, the ledger and the cached balance would silently diverge with nothing to catch it.
- **Three divergent Python dependency files** (`requirements.txt`, `requirements-deploy.txt`, `requirements-sqlite.txt`) still exist for different deploy targets (`[PARTIALLY FIXED THIS SESSION]` — versions were aligned between `requirements.txt`/`requirements-deploy.txt`, but three files is still an ongoing drift risk going forward; consider consolidating to one file plus deploy-target-specific overlays).
- **`backend/server_sqlite.py` remains a second, hand-copied backend implementation** with its own auth/KYC/payments logic (KYC auto-verifies, no rate-limit-aware roles, no production env-safety guard at all). It is excluded from test coverage and no longer wired as the deploy target (`Procfile` now points at `server:app`), but it still exists in the repo as a maintenance/drift risk — any future security fix applied to `server.py` will not automatically apply there.

## 9. Production blockers

Ranked by how badly they'd hurt a real launch if untouched:

1. ~~`render.yaml`/`Procfile` deploy the wrong/misconfigured server and the app would refuse to boot in production.~~ **Fixed this session.**
2. **Commission hardcoded, not configurable** — blocks RAIDEX from ever changing its take rate without a backend redeploy, and the current 15% doesn't match the business's stated 40% target. Needs a decision + a config mechanism before revenue actually depends on it.
3. **Owner payouts have no real implementation** — RAIDEX cannot actually pay owners through the product today; this would need to happen out-of-band (manual bank transfers) until built.
4. **AI Nexus is non-functional** (missing dependency) and, separately, **misrepresents the product** (subscriptions/swap) in its system prompt — both need addressing before exposing `/nexus/*` to real users.
5. **No real payment/KYC/SMS provider is configured by default** — this is expected/intentional for the current dev stage, but is a hard blocker for an actual production launch and requires the business's own merchant/API accounts (Razorpay, Karza/IDfy, an SMS gateway).
6. **`/wallet/topup`'s self-credit bug** would need fixing before any real customer-support wallet-adjustment workflow could rely on it.
7. **Rate limiting gaps** on booking/payment endpoints — acceptable for a closed beta, a real gap before public launch given payment-abuse surface.

## 10. Recommended fixes

In rough priority order (severity × effort):

1. **Make commission configurable.** Introduce a single source of truth (e.g., a `platform_config`/`feature_flags`-style collection or an env-driven default with per-category/owner overrides), replace all 3 hardcoded `0.15` sites with a lookup, and decide the real target rate (spec says 40%, code says 15% — these need to be reconciled with the business, not silently changed by an engineer).
2. **Fix `/wallet/topup` to take an explicit `target_user_id`** so admin-initiated support credits actually go to the customer's wallet, not the admin's own.
3. **Either fix or gate off AI Nexus**: add `emergentintegrations` to requirements (if it's a real installable package) or replace/remove the dependency, *and* rewrite the system prompts so the AI doesn't claim subscriptions/vehicle-swap exist until they actually do.
4. **Build minimal owner payout recording** — at minimum, write a `payouts` record whenever a booking completes and its commission is finalized, even if actual bank transfer stays manual/out-of-band initially. This closes the biggest gap between "owner sees earnings" and "owner sees money actually paid."
5. **Extend rate limiting** to booking/payment endpoints using the already-built `raidex_platform/rate_limits.py` role-based scheme instead of leaving it as dead code.
6. **Decide and act on `backend/server_sqlite.py`'s fate** — either commit to maintaining it in lockstep with `server.py` (unlikely to be worth the cost) or clearly mark/deprecate it as dev-only tooling so nobody mistakes it for a production-equivalent implementation again.
7. **Consolidate the three `requirements*.txt` files** into one canonical file (plus environment-specific extras) to stop future version drift.
8. Continue the deferred items already called out honestly in the codebase: real Razorpay/KYC/SMS credentials, the Expo SDK major-version bump (to clear the remaining `npm audit` findings) with a full manual QA pass, and a proper GPS-provider abstraction seam before any vehicle-hardware GPS integration is attempted.

## 11. Recommended feature roadmap

Aligned to the spec's own priority ordering (§44):

- **Priority 1 (core transactions) — essentially done**, modulo the commission-configurability and rate-limiting gaps above.
- **Priority 2 (trip)** — done; the main outstanding piece is deciding how "vehicle GPS hardware" would plug in later (needs an abstraction seam now to avoid a rewrite later, per §17-18).
- **Priority 3 (marketplace supply)** — owner onboarding/vehicle approval/pricing/availability are done; **owner payouts are the biggest gap** and should be the next major build.
- **Priority 4 (retention)** — RideMiles ledger, coupons, and referrals exist; **subscriptions and vehicle swap do not exist at all** and are the largest true feature gap versus this specification. Recommend scoping subscriptions first (it's the prerequisite for swap), reusing the existing booking/vehicle infrastructure per the spec's own guidance (§27) rather than building a parallel system.
- **Priority 5 (intelligence)** — AI Nexus structure (3 agents) matches spec intent well; needs the dependency fixed and prompts corrected before it's usable. Owner anomaly detection is scheduled but currently silently broken (same missing dependency). **Service milestones** (§25-26) are pure greenfield — the `lifetime_km` counter needed to build them already exists, so this is a comparatively cheap, high-differentiation feature to build next once payouts/commission-config are stable.

---

*No production code was modified as part of producing this report. Awaiting explicit instruction on which of the above to act on next.*
