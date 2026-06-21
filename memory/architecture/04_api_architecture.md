# Raidex — API Architecture

All endpoints prefixed with `/api`. Auth via `Authorization: Bearer <token>` (JWT or Emergent session).
Responses: JSON only, never expose Mongo `_id`. Errors: `{ "detail": "<message>" }` + appropriate HTTP code.

## Conventions
- IDs: prefixed strings (`usr_`, `veh_`, `bkg_`, `pay_`, `ins_`, `kyc_`, `evt_`, `pyo_`).
- Lists return arrays; paginated lists wrap in `{ items, next_cursor, total }`.
- Datetime in ISO-8601 UTC.
- Money in INR as integers paise-less (rupees as `number`).

## Role gating
- Customer endpoints: any authenticated user.
- Owner endpoints: `role=owner` or `roles` contains `owner`.
- Admin endpoints: `roles` contains `admin`.

---

## 1. Auth & Profile

| Method | Path | Body / Query | Returns | Auth |
|---|---|---|---|---|
| POST | `/auth/register` | `{email,password,name}` | `{access_token, user}` | public |
| POST | `/auth/login` | `{email,password}` | `{access_token, user}` | public |
| POST | `/auth/google/session` | `{session_id}` | `{access_token, user}` | public |
| GET | `/auth/me` | — | `User` | yes |
| POST | `/auth/logout` | — | `{ok}` | yes |
| PATCH | `/auth/profile` | `{name?, phone?, avatar?}` | `User` | yes |

## 2. KYC

| Method | Path | Notes |
|---|---|---|
| POST | `/kyc/submit` | Body: `{aadhaar_front, aadhaar_back, dl_front, dl_back, dl_number, dl_expiry, face_selfie, aadhaar_last4}`. Returns `{kyc_id, status:'processing'}`. Backend kicks async stub. |
| GET | `/kyc/status` | Returns current `kyc_submission` for user. |
| POST | `/kyc/{kyc_id}/retry` | Reopens rejected submission. |

## 3. Vehicles (discovery — customer)

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/vehicles` | `type, q, sort, min_price, max_price, transmission, fuel_type, near_lat, near_lng, radius_km` | only `available=true & verification_status=approved` |
| GET | `/vehicles/{id}` | | full detail |
| GET | `/vehicles/{id}/availability` | `from, to` | returns conflicting blocks |

## 4. Bookings & Trip

| Method | Path | Notes |
|---|---|---|
| POST | `/bookings` | Body: `{vehicle_id, plan, start_date, end_date, add_ons[], coupon_code?, use_miles?}` → `status=pending_payment`. |
| POST | `/bookings/{id}/start` | Requires before-inspection submitted. |
| POST | `/bookings/{id}/end` | Requires after-inspection submitted. Triggers refund flow + miles. |
| POST | `/bookings/{id}/extend` | Body: `{new_end_date}` |
| POST | `/bookings/{id}/cancel` | |
| GET | `/bookings` | `status?` query, returns current user's bookings |
| GET | `/bookings/{id}` | |

## 5. Payments (provider-agnostic)

| Method | Path | Notes |
|---|---|---|
| POST | `/payments/create` | `{booking_id?, amount, purpose}` → `{payment_id, provider_order_id (mock), status:'created'}` |
| POST | `/payments/{id}/confirm` | `{provider_payment_id?, provider_signature?}` → simulates success or failure (95/5 split unless body forces). On success, marks booking `confirmed`, credits ledgers. |
| POST | `/payments/{id}/refund` | `{amount?}` → wallet credit. |
| GET | `/payments/{id}` | |

## 6. Inspections (before / after)

| Method | Path | Notes |
|---|---|---|
| POST | `/inspections` | `{booking_id, phase, photos[], video_url?, odometer_value, fuel_level, notes?}` → runs stub AI scoring, returns inspection. |
| GET | `/inspections/{id}` | |
| GET | `/bookings/{id}/inspections` | both phases for a booking |

## 7. GPS & Geofencing

| Method | Path | Notes |
|---|---|---|
| POST | `/gps/track` | (vehicle simulator) Body: `{vehicle_id, lat, lng, speed_kmph, heading}`. Server appends to `gps_tracks`, updates `vehicles.last_track`, evaluates geofence. **For MVP this is also exposed for clients in dev to drive demo movement.** |
| GET | `/vehicles/{id}/location` | latest `last_track` (owner / current renter / admin only) |
| GET | `/vehicles/{id}/trail` | `from, to` paginated polyline samples |
| GET | `/geofence-events` | owner-only feed |
| POST | `/geofence-events/{id}/ack` | mark acknowledged |

## 8. RideMiles & Wallet

| Method | Path | Notes |
|---|---|---|
| GET | `/rewards/me` | tier, balance, history |
| GET | `/rewards/catalog` | available rewards |
| POST | `/rewards/redeem` | `{reward_id}` |
| GET | `/wallet/balance` | |
| GET | `/wallet/ledger` | |
| POST | `/wallet/topup` | `{amount, payment_id}` |

## 9. Notifications

| GET | `/notifications`           | list |
| POST | `/notifications/{id}/read` | mark read |
| POST | `/notifications/read-all`  | bulk |

## 10. Owner endpoints (`/owner/*`)

| Method | Path |
|---|---|
| POST | `/owner/onboard` |
| POST | `/owner/vehicles` (create) |
| GET | `/owner/vehicles` |
| PATCH | `/owner/vehicles/{id}` (price, available, calendar) |
| DELETE | `/owner/vehicles/{id}` |
| GET | `/owner/bookings` (?status) |
| GET | `/owner/earnings` (?from,&to) — daily series + KPIs |
| GET | `/owner/utilization` |
| GET | `/owner/payouts` |
| POST | `/owner/bank-account` (`{ifsc, account_masked, holder_name}`) |

## 11. Admin endpoints (`/admin/*`) — role=admin

| GET | `/admin/kpis` | revenue, active bookings, signups |
| GET | `/admin/users` (?q, ?role) |
| PATCH | `/admin/users/{id}` (kyc_status override, ban) |
| GET | `/admin/vehicles?verification_status=pending` |
| POST | `/admin/vehicles/{id}/approve` |
| POST | `/admin/vehicles/{id}/reject` `{reason}` |
| GET | `/admin/bookings?status` |
| GET | `/admin/payments?status` |
| POST | `/admin/payments/{id}/refund` |
| GET | `/admin/geofence-events` |
| GET | `/admin/coupons` / POST / PATCH / DELETE |
| GET | `/admin/audit` |
| GET | `/admin/agent-runs` |

## 12. AI Nexus (`/nexus/*`)

| POST | `/nexus/support/chat` | `{thread_id?, message}` — Support agent (LLM Claude Haiku) |
| GET | `/nexus/support/threads` | user's threads |
| GET | `/nexus/support/threads/{id}` |
| POST | `/nexus/ops/query` | admin-only, e.g. "Which 3 vehicles had the highest utilization last week?" → calls tools then LLM |
| POST | `/nexus/finance/query` | admin-only, revenue / payout queries |

Internal tools available to AI agents (deterministic, not LLM):
- `tool.vehicles.list`, `tool.bookings.summary`, `tool.revenue.range`, `tool.utilization`, `tool.user.lookup`.

## 13. Coupons (customer-facing)

| POST | `/coupons/validate` `{code, amount}` → discount preview |

---

## Status code reference
- 200 / 201 — OK / Created
- 400 — Validation error
- 401 — Missing/invalid auth
- 403 — Wrong role
- 404 — Not found
- 409 — Conflict (double-booking, calendar block)
- 422 — Domain rule violation (e.g. start-trip without inspection)
- 500 — Server error
