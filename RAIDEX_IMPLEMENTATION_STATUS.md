# RAIDEX — Implementation Status

Living checklist against the RAIDEX Master Product Specification. Supersedes `RAIDEX_CURRENT_STATE.md` (kept for history) as of this pass. See `RAIDEX_FINAL_VERIFICATION.md` for the detailed before/after/tests table for everything closed in this pass.

## Fully implemented (backend + frontend, tested)

| Area | Backend | Frontend | Tests |
|---|---|---|---|
| Auth (register/login/OTP/Google session/refresh/logout) | ✅ | ✅ | ✅ |
| KYC submit/status/admin review (GridFS storage) | ✅ | ✅ | ✅ |
| Vehicle discovery/detail/compare/wishlist | ✅ | ✅ | ✅ |
| Booking lifecycle (create/extend/cancel/invoice/dispute), transactional conflict guard | ✅ | ✅ | ✅ |
| Payments (mock + Razorpay), atomic double-confirm guard | ✅ | ✅ | ✅ |
| Trip lifecycle (before/after inspection, start/end, mileage) | ✅ | ✅ | ✅ |
| Reviews (one per completed booking, moderation-ready) | ✅ | ✅ (new this pass) | ✅ |
| RideMiles ledger (append-only) | ✅ | ✅ | ✅ |
| Wallet ledger + admin topup with `target_user_id` | ✅ | ✅ | ✅ |
| **Commission engine** — single `CommissionService`, admin-configurable, category/owner overrides, snapshotted onto every booking/subscription | ✅ | ✅ (admin edit + owner/customer transparency) | ✅ |
| **Owner payout system** — real `payouts` collection, idempotent per booking, admin mark-paid/failed, owner-facing breakdown | ✅ | ✅ (owner earnings screen + admin Payouts tab, both new/extended this pass) | ✅ |
| **AI Nexus** (Support/Ops/Finance) — `providers/ai_provider.py`, honest stub fallback, never hallucinates unreleased features | ✅ | ✅ (existing screens) | ✅ |
| **Owner anomaly cron** — migrated off the dead `emergentintegrations` dependency onto the real AI provider abstraction | ✅ | n/a (push/in-app notification) | ✅ (new this pass) |
| **Background jobs** — every registered job now has a real handler (insurance/document expiry reminders, trip reminders, payment reconciliation flags, fraud scans, analytics snapshots, subscription expiry) | ✅ | n/a | ✅ (new this pass) |
| **Rate limiting** — role-aware ceilings on auth, KYC, booking, payment, wallet, payout, commission-config, Nexus, subscription, swap | ✅ | n/a | ✅ |
| **Ledger reconciliation** (wallet + RideMiles, read-only) | ✅ | n/a (admin API only) | ✅ |
| **Service milestones** — configurable RAIDEX-mileage thresholds, idempotent benefit awarding | ✅ | ✅ (owner benefits list) | ✅ |
| **GPS provider abstraction** — `PhoneGPSProvider` wraps existing phone-GPS/geofence logic unchanged; seam ready for a future vehicle-hardware provider | ✅ (new this pass) | n/a (frontend still posts via `expo-location`, unchanged) | ✅ (new this pass) |
| **Subscriptions** — real entity, quote/create/activate-on-payment/usage/renew/cancel/auto-expire, reuses booking/payment/commission infra | ✅ (new this pass) | ✅ (new this pass) | ✅ (new this pass) |
| **Vehicle swap** — built on an active subscription, fee quoting, atomic vehicle reallocation, optional admin-approval gate | ✅ (new this pass) | ✅ (new this pass) | ✅ (new this pass) |
| Admin console (users, KYC, vehicles, bookings, payments, disputes, geofence, system health, commission, payouts, feature flags, jobs, reconciliation) | ✅ | ✅ (Payouts tab new this pass) | ✅ |
| SQLite backend deprecation | ✅ (dev-only, clearly marked, excluded from deploy path) | n/a | n/a |
| Dependency consolidation | ✅ (canonical `requirements.txt` + documented deploy-trimmed subset) | n/a | n/a |
| Deployment config coherence (Procfile/render.yaml → real Mongo server, no wildcard CORS) | ✅ | n/a | n/a |

## Feature-flagged (code-complete, OFF by default pending admin QA sign-off)

- `subscriptions` and `vehicle_swap` — both fully implemented and tested, but gated behind `PUT /admin/feature-flags/{flag}` so they only reach real users once an admin explicitly enables them post-QA. AI Nexus prompts only describe them once enabled.
- `vehicle_swap_requires_approval` — optional stricter mode (swap sits `requested` until an admin approves) vs. the default self-serve immediate-complete flow.

## Known remaining gaps / honest limitations

- **Subscription/swap admin category & owner override editing** — the admin default-commission-rate editor is live; a full add/remove UI for per-category/per-owner overrides is still API-only (`PUT /admin/commission-config`).
- **No React Native component-test tooling** — this codebase's frontend tests exclusively cover `src/features/*/api/*.ts` wrapper modules, not `app/**` screens (true even before this pass). New screens (subscriptions, swap, review submission, admin payouts/flags) are typechecked and manually contract-verified against the exact backend request/response shapes; the reviews feature-API layer now has real Jest coverage matching every sibling module. Introducing a component-testing framework is a separate tooling decision, not attempted here.
- **Maestro/EAS/device E2E** — cannot run in this sandboxed environment (no emulator/device). Not verified as part of this pass; existing flows were not re-run.
- **Real production providers** (Razorpay live keys, Karza/IDfy KYC, a real SMS gateway, Anthropic API key) are not configured by default — this is expected/intentional; see `docs/BACKEND.md` and `.env.example`.
- **No remote vehicle control anywhere** — confirmed absent by design (hard rule); GPS abstraction is strictly tracking/geofence/mileage.

## Closed in the continuation pass (previously listed as gaps)

- ✅ Subscription revenue now flows through the owner-payout collection — both initial activation and every renewal payment create a real, idempotent payout (`payment_id`-keyed, coexisting safely with booking-keyed payouts via a partial-unique-index redesign).
- ✅ Subscription renewal now requires payment (was previously a free, unpaid extension — a real revenue leak, not a deliberate policy).
- ✅ Admin UI for toggling feature flags (`subscriptions`, `vehicle_swap`, `vehicle_swap_requires_approval`).
- ✅ A pre-existing payment-amount-tampering gap (found while doing the above) — `payments_create` now floor-validates the amount against what a booking/subscription/renewal actually owes.

## Where to look

- `RAIDEX_FINAL_VERIFICATION.md` — the detailed before/after/tests/files table for this pass.
- `docs/BACKEND.md` — updated API map, provider env vars, service-file index.
- `backend/tests/` — 117 passing, 2 intentionally-skipped (opt-in live API smoke tests).
