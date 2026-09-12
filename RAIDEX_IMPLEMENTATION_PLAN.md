# RAIDEX Implementation Plan (Gap Closure)

Scope: close the P0/P1/P2 gaps identified in `RAIDEX_CURRENT_STATE.md` per the master spec. Executed in phases, backend-first (financial correctness), then frontend surfaces for anything new, with tests at each step. Existing working functionality is preserved; regressions are fixed immediately.

## Phase 2 — P0
1. **Commission engine** (`raidex_platform/commission.py`): single `CommissionService`, backed by a `platform_config` collection (default 40%, category/owner overrides, admin-editable via `GET/PUT /admin/commission-config`). Booking creation snapshots `commission_rate`/`commission_amount`/`owner_net_amount` on the booking so historical records don't move when config changes later. Replaces the 3 hardcoded `0.15` sites.
2. **Wallet topup fix** (`POST /wallet/topup`): add required `target_user_id` + `reason`, optional idempotent `reference`, audit log, notify target user. Was crediting the calling admin's own wallet.
3. **AI Nexus**: replace the missing `emergentintegrations` dependency with a clean `providers/ai_provider.py` abstraction — `AnthropicProvider` (official `anthropic` SDK, gated on `ANTHROPIC_API_KEY`) with a deterministic `StubAIProvider` fallback that is explicit about being non-AI when no key is configured (never hallucinates). Fix system prompts to only describe subscriptions/vehicle swap once those features are actually enabled (feature-flag-gated), and stop leaking raw exception text to clients (log full detail server-side, return a generic message).

## Phase 3 — P1
4. **Owner payout system**: real `payouts` collection populated on booking completion (idempotent — one payout per booking), with commission/fee/net breakdown from the same `CommissionService` snapshot. Admin list/filter/mark-paid endpoints with audit trail. Owner-facing endpoint enriched.
5. **Rate limiting**: apply the existing role-aware `rate_limits.py` scheme to booking, payment, wallet, KYC, and support/AI endpoints (not just the 4 auth ones).
6. **Ledger reconciliation**: admin endpoint comparing `wallet_ledger`/`ride_miles_ledger` sums against cached balances per user, reporting healthy/warning/mismatch — read-only, no auto-mutation.
7. **SQLite backend deprecation**: mark `server_sqlite.py` clearly as dev-only (module docstring + `docs/BACKEND.md` note); confirmed no deployment path points at it anymore (fixed earlier this session).
8. **Dependency consolidation**: keep `requirements.txt` as the canonical/tested file; `requirements-deploy.txt` stays a deploy-trimmed subset kept in version lockstep (already aligned this session); document the split rather than collapsing it (collapsing risks the free-tier Render build pulling dev-only tooling).

## Phase 4 — GPS abstraction
9. `providers/gps_provider.py`: `GPSProvider` interface (start/stop tracking, ingest location event, geofence check, telemetry) with `PhoneGPSProvider` wrapping the existing phone-GPS logic unchanged. No behavior change for the MVP; creates the seam the spec asks for before any vehicle-hardware integration is attempted. Explicitly no remote-control operations (start/stop/kill engine) — tracking only.

## Phase 5 — Service milestones
10. `service_milestones` (config), `vehicle_service_progress` (per-vehicle cumulative state), `service_benefits` (issued benefits) collections. Crossing-detection hooked into trip completion (where `lifetime_km` already updates), idempotent per milestone per vehicle, owner notification, admin visibility. Benefit status: `eligible` → `pending_partner_fulfillment` → `fulfilled` (no fake redemption, no claim of real service-center integration).

## Phase 6 — Subscriptions
11. `subscriptions` collection reusing vehicle/payment/notification infrastructure: plan discovery, eligibility, creation, payment-gated activation, usage/mileage tracking against `included_km`, renewal, cancellation/expiry. Server-side pricing only. Prevents overlapping subscription/booking allocation of the same vehicle.

## Phase 7 — Vehicle swap
12. `vehicle_swaps` collection built on top of subscriptions: eligibility, availability/category compatibility, fee calculation, atomic old-vehicle-release + new-vehicle-activation (transaction where supported, safe fallback otherwise), history, notifications.

## Phase 8 — Frontend integration
13. Wire real (non-cosmetic) screens/surfaces for: owner payout breakdown, commission transparency on checkout, a subscriptions screen (browse/subscribe/manage), a vehicle-swap flow from an active subscription, AI Nexus already-existing screens continue to work against the new provider.

## Phase 9 — Security & tests
14. Targeted fixes: no raw exception leakage to clients; confirm rate limits return 429; add unit/integration tests for every new service (commission, wallet topup, payouts, milestones, subscriptions, swap, reconciliation) using the existing fake-Mongo test harness pattern.

## Phase 10 — Verification
15. Run backend `pytest`, frontend `typecheck`/`lint`/`test`, and document results plus remaining external-configuration requirements in `RAIDEX_IMPLEMENTATION_STATUS.md` and `RAIDEX_FINAL_VERIFICATION.md`. Maestro/EAS/device-based E2E cannot run in this sandboxed environment (no emulator/device) — this is called out explicitly as a limitation rather than claimed as verified.

## Explicit non-goals (per the hard rule in the brief)
No remote vehicle control (engine kill/start/ignition/immobilizer) is implemented anywhere — GPS/telemetry stays tracking-only.
