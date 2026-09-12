# RAIDEX Launch Checklist

Status tags used throughout: **CODE COMPLETE** (built and tested, nothing more to write) · **EXTERNAL CONFIGURATION REQUIRED** (code/abstraction exists, needs a real account/credential/domain from you) · **BUSINESS DECISION REQUIRED** (needs a human/legal/operational decision, not code) · **NOT YET IMPLEMENTED** (no code exists for this yet).

This checklist is a living document — update the status column as each item closes. See `RAIDEX_V1_RELEASE.md` for the frozen baseline this checklist tracks against, and `RAIDEX_FINAL_PRODUCTION_AUDIT.md` for the detailed security/correctness findings referenced below.

---

## Technical

| Item | Status | Notes |
|---|---|---|
| Production backend (FastAPI) | CODE COMPLETE | `backend/server.py`, deploy config in `backend/render.yaml` |
| Production database (MongoDB Atlas) | EXTERNAL CONFIGURATION REQUIRED | Code only ever talks to `MONGO_URL`/`DB_NAME` env vars — no Atlas cluster exists yet. You need to create one and paste the connection string into Render (or wherever you deploy). |
| Backups | EXTERNAL CONFIGURATION REQUIRED | `scripts/backup_mongodb.ps1` and `scripts/verify_restore.ps1` exist and work, but nothing schedules them automatically (P2 finding). Needs a cron/scheduled-task entry pointed at your actual Atlas cluster. |
| Restore verified | NOT YET IMPLEMENTED (this session) | Script exists; an actual restore-drill against a real backup has not been run because no production cluster exists yet. Do this once Atlas is live, before real money touches the system (Phase 4/5 of the launch plan). |
| HTTPS / domain | EXTERNAL CONFIGURATION REQUIRED | No domain has been registered/pointed anywhere from what's in this repo. Whatever host you deploy to (Render, etc.) provides HTTPS by default on its subdomain; a custom domain is your choice. |
| Monitoring / error tracking (Sentry) | EXTERNAL CONFIGURATION REQUIRED | Code wires up `sentry_sdk.init()` automatically when `SENTRY_DSN` is set (`backend/server.py`); frontend has the equivalent (`EXPO_PUBLIC_SENTRY_DSN`). No DSN is configured — needs a Sentry account/project. |
| Production secrets (JWT, admin password, etc.) | EXTERNAL CONFIGURATION REQUIRED | Boot-time validation (`_validate_env`) already refuses to start without these being set to non-default values — see `RAIDEX_V1_RELEASE.md` for the full enforced list. |
| Rate limits | CODE COMPLETE (mostly) | `slowapi` in place on auth/OTP/booking-mutation routes. Two known gaps remain open: `POST /auth/refresh` has no rate limit, and several admin-mutation routes aren't covered (P2 findings, not yet fixed this pass). |
| Security audit | IN PROGRESS | See `RAIDEX_FINAL_PRODUCTION_AUDIT.md`. As of this checklist: P0-2, P0-4, P0-5 closed; P0-1 (booking race) and P0-3 (SMS provider) are being fixed in this same session; all P1/P2/P3 items remain open. |
| Dependency audit | CODE COMPLETE (backend) / KNOWN GAP (frontend) | `pip-audit` on backend: clean. `npm audit --omit=dev` on frontend: 54 findings, all traced to the Expo 51/Metro build-tool chain, deliberately deferred pending an Expo SDK major upgrade (documented in `ci.yml`). Not runtime-app-code exposure, but should not be ignored indefinitely. |

## Payments

| Item | Status | Notes |
|---|---|---|
| Razorpay Live account | EXTERNAL CONFIGURATION REQUIRED (BUSINESS DECISION REQUIRED for the KYB/business paperwork Razorpay itself requires) | Code supports `PAYMENT_PROVIDER=razorpay` end-to-end; needs real `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` from a live (not test) Razorpay dashboard, which itself requires a registered business entity and bank account on Razorpay's side. |
| Webhook configured & verified | CODE COMPLETE, EXTERNAL CONFIGURATION REQUIRED to activate | Signature verification code exists and (as of this session) boot now refuses to start in production without the webhook secret set. You still need to register the webhook URL in the Razorpay dashboard once a real domain exists. |
| Refunds | CODE COMPLETE, KNOWN GAP OPEN | Refund flow works; a race condition where two concurrent refund requests can both fire a real gateway refund is documented as P1-2 in the audit and not yet fixed. |
| Reconciliation | CODE COMPLETE | `/admin/reconciliation` endpoint exists; no admin console tab surfaces it yet (P2 finding). |

## KYC

| Item | Status | Notes |
|---|---|---|
| Provider abstraction | CODE COMPLETE | `backend/providers/kyc_provider.py` supports `stub`/`karza`/`idfy` via `KYC_PROVIDER`. |
| Real KYC provider account | EXTERNAL CONFIGURATION REQUIRED (BUSINESS DECISION REQUIRED to pick Karza vs. IDfy vs. HyperVerge) | No credentials exist in this repo for any of these — you need to register with one and configure `KARZA_API_KEY`/`KARZA_BASE_URL` or the IDfy equivalents in `.env`/Render. |
| Admin approve/reject UI | PARTIAL — NOT YET IMPLEMENTED (frontend) | Backend routes exist (`POST /admin/kyc/{id}/approve`/`reject`) and even have frontend API helper functions written, but no screen in the admin console actually calls them (P1-5 in the audit). An admin literally cannot approve a KYC submission today. **This blocks any real-customer test that requires KYC approval** unless done by directly calling the API. |
| Document storage | CODE COMPLETE | GridFS-backed (`fs_bucket` in `backend/server.py`), documents never touch the raw document collection. |

## Communications

| Item | Status | Notes |
|---|---|---|
| SMS/OTP provider | IN PROGRESS (this session) | Previously entirely missing (P0-3) — OTP was returned directly in the API response with no real SMS abstraction at all. A provider abstraction + real gateway integration is being built now; see the session's final report for which provider was implemented and what credentials you'll need to supply. |
| Push notifications | NOT YET IMPLEMENTED (delivery) | `NotificationService` writes outbox rows for every domain event, but the actual send-to-device step is never invoked from `server.py` and nothing drains the outbox (P1-4). Customers today receive zero push notifications for booking/payment/trip/payout events — only in-app notification rows. This should be fixed before closed beta; it's a real, currently-silent gap in what the product claims to do. |
| Email | NOT YET IMPLEMENTED | No email-sending code exists in the backend. Not required for MVP unless a business decision adds transactional email (receipts, etc.) to scope. |

## Mobile

| Item | Status | Notes |
|---|---|---|
| Android build | EXTERNAL CONFIGURATION REQUIRED | EAS config exists (`frontend/eas.json`); an actual signed build requires an Expo/EAS account and (for Play Store) a Google Play Console developer account ($25 one-time), which this session cannot create for you. |
| iOS build | EXTERNAL CONFIGURATION REQUIRED | Same EAS pipeline; requires an Apple Developer Program account ($99/year) and Apple's own review process, again not something an automated session can obtain. |
| App signing | EXTERNAL CONFIGURATION REQUIRED | Managed by EAS once the above accounts exist. |
| Deep links | CODE COMPLETE (Expo Router file-based routing already supports this) | Verify actual `raidex://` / universal-link domain association once a real domain exists. |
| Store listing assets (icon, splash, screenshots, description, permission explanations) | NOT YET IMPLEMENTED | No app-store-facing copy or screenshots exist in this repo. This is a content/design task, not a code task — flag to whoever owns marketing/product copy. |

## Business (BUSINESS DECISION REQUIRED for all of the below — none of this is code)

| Item | Status |
|---|---|
| Terms of Service | NOT YET IMPLEMENTED — no legal documents exist in this repo. Needs a lawyer or a legal-template service; this is not something to draft casually for a real-money product. |
| Privacy Policy | NOT YET IMPLEMENTED — same as above, and needed for app store submission regardless of legal risk. |
| Refund Policy | NOT YET IMPLEMENTED |
| Rental Agreement (customer-facing) | NOT YET IMPLEMENTED |
| Owner Agreement (the contract RAIDEX has with vehicle owners — commission %, payout terms, liability) | NOT YET IMPLEMENTED |
| Damage Policy | NOT YET IMPLEMENTED |
| KYC Disclosure (what's collected, why, retention) | NOT YET IMPLEMENTED — required for both app stores and (in India) for reasonable data-protection compliance given KYC documents are collected. |
| Support process (who answers a ticket, SLA) | NOT YET IMPLEMENTED — the AI Nexus support agent exists in-app, but a real human escalation path/ownership has not been defined. |
| Payout process (who actually presses "mark paid" and moves real money to an owner's bank account) | NOT YET IMPLEMENTED — the admin payout-marking UI exists in code, but the actual banking/transfer mechanism (NEFT/IMPS/UPI, manual or automated) is not built or decided. |

## Operations (BUSINESS DECISION REQUIRED / process, not code)

| Item | Status |
|---|---|
| Owner onboarding process (who walks a real owner through signup) | NOT YET IMPLEMENTED |
| Vehicle verification process (who physically/administratively checks RC, insurance, pollution cert before approving) | PARTIAL — the approve/reject *buttons* exist in the admin console; the actual verification *process* a human follows is undefined. |
| Inspection process | CODE COMPLETE for the in-app before/after photo+odometer flow; the human process for disputing a bad inspection is undefined. |
| Dispute process | PARTIAL — backend route exists (`PATCH /admin/disputes/{id}`), no admin UI calls it (same gap as KYC approval, P1-5), and no human process is defined for who investigates a dispute. |
| Damage process | NOT YET IMPLEMENTED as a defined process (the damage-AI-inspector is a stub by design; real damage adjudication would be manual today). |
| Emergency/support process | NOT YET IMPLEMENTED |

---

## Summary

Of the ~40 checklist items above: roughly a third are genuinely **CODE COMPLETE**, a third are **EXTERNAL CONFIGURATION REQUIRED** (accounts/credentials/domains only you can create), and a third are **BUSINESS DECISION REQUIRED / NOT YET IMPLEMENTED** — mostly legal documents, operational processes, and a handful of real gaps in the admin console (KYC approval, dispute resolution, vehicle-swap approval all lack UI despite having working backend routes). None of the code gaps are large; all of the legal/business items require a human decision-maker, not more engineering.
