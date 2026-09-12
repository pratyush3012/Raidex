# RAIDEX v1.0 — Release Freeze Record

This document freezes the state of the RAIDEX codebase at the point it entered
the production-launch phase (Phase 0 of the launch plan). It exists so that
every later phase (infra, providers, security, real-money test, closed beta)
has a single unambiguous reference point to compare against.

## Version identity

| Field | Value |
|---|---|
| Release candidate | `v1.0.0-rc1` |
| Git commit (baseline) | `34936caa0700a9daefc3320b9596dd4ed827157d` (short: `34936ca`) |
| Git remote | `https://github.com/pratyush3012/Raidex.git` |
| Branch | `main` |
| Parent (last real commit before this session's work) | `b62bf75` — "Upgrade AI platform to continuous engineering OS" |
| Note on history | No local `.git` existed when this phase began (repo was a bare working copy). Git was re-initialized and the accumulated session work was grafted as a single commit onto the real `origin/main` history rather than starting a disconnected history. |

Everything from this commit forward is tracked in git. Prior "releases" (the
UI/UX transformation, the production audit, the feature-completion pass) all
happened before this repo had version control locally and are described in
the standalone docs at the repo root (`RAIDEX_FINAL_PRODUCTION_AUDIT.md`,
`RAIDEX_UI_UX_TRANSFORMATION_REPORT.md`, `RAIDEX_FINAL_VERIFICATION.md`,
`RAIDEX_IMPLEMENTATION_STATUS.md`).

## Backend

| Component | Version |
|---|---|
| Python (runtime.txt / render.yaml) | 3.12.0 |
| Python (.python-version, local dev) | 3.12.11 |
| Python (installed on this machine) | 3.12.10 |
| Python (CI, `.github/workflows/*.yml`) | floats `"3.12"` — **drift noted below** |
| FastAPI | 0.138.0 |
| Uvicorn | 0.25.0 |
| Motor (async MongoDB driver) | 3.3.1 |
| PyMongo | 4.6.3 |
| Pydantic | >=2.6.4 |
| sentry-sdk | >=2.13.0 |
| Deploy target | Render (`backend/render.yaml`), `web: uvicorn server:app --host 0.0.0.0 --port $PORT` |
| Entrypoint | `backend/server.py` (the *only* server — `server_sqlite.py` has been deleted; see "Changes made during this phase" below) |

**Known version drift (pre-existing, P2 in the production audit):** `runtime.txt`/`render.yaml` pin `3.12.0`, `.python-version` pins `3.12.11`, CI floats `3.12`. These should be reconciled to one exact patch version before wide launch — not done in this pass since it's a low-risk-but-nonzero-effort chore, not a blocker.

## Frontend

| Component | Version |
|---|---|
| Expo SDK | ~51.0.39 |
| React Native | 0.74.5 |
| React | 18.2.0 |
| Node (installed on this machine) | v24.17.0 |
| Build/deploy | EAS (`frontend/eas.json`) |
| Maps | Free MapLibre/OpenStreetMap rendering — no Google Maps API key required |

## Database

- **Engine:** MongoDB (Atlas in production; a Supabase/Postgres migration path exists in `backend/supabase/migrations/001_initial_schema.sql` but is **not** the active runtime — `MONGO_URL`/`DB_NAME` are what `server.py` actually uses).
- **Schema:** document-based, no formal migration tool; indexes are created idempotently at boot via `create_indexes()` in `backend/server.py` (partial-unique indexes for payout dedup, compound indexes for booking/vehicle queries, etc.)
- Schema/index reference: `docs/DATABASE.md`.

## External providers (selected via env var, see `backend/.env.example`)

| Capability | Default (dev) | Real option(s) wired in code | Status |
|---|---|---|---|
| Payments | `mock` | Razorpay (`PAYMENT_PROVIDER=razorpay`) | Code complete. Needs live keys — see Phase 2. |
| KYC | `stub` | Karza, IDfy | Code complete. Needs live account — see Phase 2. |
| SMS/OTP delivery | `mock` (leaks OTP in response) | **Being built this phase** (was previously entirely missing — P0-3 in the audit) | In progress. |
| Push notifications | `log` (no-op) | Expo push, OneSignal | Code exists but **the send path is never actually invoked** (P1-4 in the audit — outbox rows are written, nothing drains them). Not yet fixed. |
| AI / LLM (Nexus) | unset → safe stub | Anthropic (`AI_PROVIDER=anthropic`) | Code complete. Needs `ANTHROPIC_API_KEY`. |
| Damage inspection AI | `stub` | — (no real implementation exists yet) | Stub only, by design — not a launch blocker for the core rental flow. |
| GPS/telemetry | `phone` (customer device GPS via expo-location) | — (vehicle-hardware provider is a documented future slot, not built) | Working as designed for MVP. |

## Feature flags (via `FeatureFlagService`, admin-configurable, default OFF)

| Flag | Default | Notes |
|---|---|---|
| `subscriptions` | OFF | Requires admin opt-in via `PUT /admin/feature-flags/subscriptions` |
| `vehicle_swap` | OFF | Same mechanism |
| `vehicle_swap_requires_approval` | OFF | When ON, swaps land in `requested` state — **no admin UI exists yet to approve/reject them** (P1-6 in the audit). Do not enable this flag in production until that UI is built, or swaps will strand indefinitely. |

## Environment requirements (production/staging)

Enforced today by `_validate_env()` at boot (`backend/server.py`) — the server refuses to start if any of these are violated:

- `MONGO_URL`, `DB_NAME` — required always.
- `ALLOWED_ORIGINS` — must be set, must not contain `localhost`/`127.0.0.1`, must not be `*` (wildcard check added this phase).
- `PAYMENT_PROVIDER` — must not be `mock`.
- If `PAYMENT_PROVIDER=razorpay` — `RAZORPAY_WEBHOOK_SECRET` must be set (added this phase).
- `KYC_PROVIDER` — must not be `stub`.
- `SMS_PROVIDER` — must not be `mock`/unset (added this phase; a real implementation is being built alongside this guard).
- `JWT_SECRET` — must not be the placeholder default (pre-existing hard check).
- `ADMIN_PASSWORD` — must be explicitly set or boot fails (pre-existing hard check).

Not yet enforced by any boot-time guard (tracked as launch-readiness work, not done in this pass): nothing else identified as missing beyond the above as of this commit.

## Known limitations at this release point

These are carried over from `RAIDEX_FINAL_PRODUCTION_AUDIT.md` (verdict: **NOT READY** at time of that audit) and are being worked through as part of this launch phase — see that document for full detail. As of this commit, in progress or already closed:

- **P0-1** (booking double-booking race under real concurrency) — in progress.
- **P0-2** (owner could self-bypass vehicle-approval gating) — **closed this phase**: `PATCH /owner/vehicles/{id}` now rejects `available: true` unless `verification_status == "approved"`; `create_booking`/`create_subscription` also independently re-check `verification_status` as defense in depth.
- **P0-3** (OTP leaked in response, no real SMS provider) — in progress.
- **P0-4** (Razorpay webhook accepted unsigned payloads if secret unset) — **closed this phase**: boot now fails in production if `PAYMENT_PROVIDER=razorpay` and `RAZORPAY_WEBHOOK_SECRET` is unset.
- **P0-5** (CORS wildcard not rejected) — **closed this phase**: boot now fails if `ALLOWED_ORIGINS` contains `*`.
- All P1/P2/P3 findings in the audit remain open and are not addressed in this pass unless explicitly noted above. In particular: the refund race (P1-2), the Nexus thread IDOR (P1-3), the dead push-notification pipeline (P1-4), and the missing admin KYC/dispute/swap-approval UI (P1-5/6) are all still outstanding and should be treated as pre-closed-beta work, not pre-real-transaction-test work.
- `server_sqlite.py` (a dead, never-deployed SQLite fallback carrying a stale hardcoded commission rate — P2 in the audit) has been **deleted** this phase, and `start-backend.bat` now launches the real `server:app` instead.

## What this document is not

This is not a claim of production readiness. It is a factual snapshot for
comparison purposes. See `RAIDEX_FINAL_PRODUCTION_AUDIT.md` for the full
findings list and `RAIDEX_LAUNCH_READINESS_REPORT.md` (produced at the end of
the launch phase) for the up-to-date go/no-go assessment.
