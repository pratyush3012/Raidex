# Raidex — ER Diagram (PostgreSQL / Supabase)

> Same business entities as before, now expressed as PG tables with FK relationships and the new `vehicle_availability_blocks` child table extracted from the prior nested array. Cardinalities verified against the schema constraints.

```mermaid
erDiagram
    users ||--o{ kyc_submissions : "submits"
    users ||--o{ vehicles : "owns when 'owner' in roles"
    users ||--o{ bookings : "renter (user_id)"
    users ||--o{ bookings : "owner (owner_id)"
    users ||--o{ payments : "pays"
    users ||--o{ ride_miles_ledger : "earns/spends"
    users ||--o{ wallet_ledger : "transacts"
    users ||--o{ notifications : "receives"
    users ||--o{ support_threads : "opens"
    users ||--o{ payouts : "receives (owner)"
    users ||--o{ admin_audit : "performs (admin)"
    users ||--o{ agent_runs : "initiates"

    vehicles ||--o{ bookings : "is booked"
    vehicles ||--o{ vehicle_availability_blocks : "has block"
    vehicles ||--o{ gps_tracks : "emits"
    vehicles ||--o{ geofence_events : "triggers"
    vehicles ||--o{ inspections : "inspected"

    bookings ||--o| payments : "paid by"
    bookings ||--o{ inspections : "before/after"
    bookings ||--o{ gps_tracks : "tracked during"

    payments ||--o{ wallet_ledger : "credits/debits"

    support_threads ||--o{ support_messages : "contains"

    payouts }o--o{ bookings : "covers (via booking_ids[])"
    coupons ||--o{ bookings : "applied"

    users {
      text user_id PK
      citext email UK
      text password_hash
      text google_id UK
      role_t_array roles
      kyc_status_t kyc_status
      numeric wallet_balance
      int ride_miles
      text tier
      timestamptz deleted_at
    }

    kyc_submissions {
      text kyc_id PK
      text user_id FK
      text aadhaar_front
      text dl_front
      text face_selfie
      numeric face_match_score
      kyc_status_t status
    }

    vehicles {
      text vehicle_id PK
      text owner_id FK
      vehicle_type_t type
      numeric price_per_day
      double_precision latitude
      double_precision longitude
      numeric lifetime_km
      verification_t verification_status
      bool available
    }

    vehicle_availability_blocks {
      text block_id PK
      text vehicle_id FK
      timestamptz from_at
      timestamptz to_at
      text reason
    }

    bookings {
      text booking_id PK
      text user_id FK
      text vehicle_id FK
      text owner_id FK
      booking_plan_t plan
      booking_status_t status
      numeric total_amount
      text payment_id FK
      jsonb vehicle_snapshot
    }

    payments {
      text payment_id PK
      text user_id FK
      text booking_id FK
      payment_purpose_t purpose
      payment_status_t status
      text provider
      numeric amount
    }

    inspections {
      text inspection_id PK
      text booking_id FK
      text vehicle_id FK
      inspection_phase_t phase
      numeric odometer_value
      numeric ai_score
    }

    gps_tracks {
      bigserial track_id PK
      text vehicle_id FK
      text booking_id FK
      double_precision lat
      double_precision lng
      timestamptz recorded_at
    }

    geofence_events {
      text event_id PK
      text vehicle_id FK
      text owner_id FK
      text booking_id FK
      geo_event_kind_t kind
      bool acknowledged
    }

    ride_miles_ledger {
      bigserial ledger_id PK
      text user_id FK
      int delta
      miles_reason_t reason
      int balance_after
    }

    wallet_ledger {
      bigserial ledger_id PK
      text user_id FK
      numeric delta
      wallet_reason_t reason
      text payment_id FK
      numeric balance_after
    }

    payouts {
      text payout_id PK
      text owner_id FK
      date period_start
      date period_end
      numeric net_payable
      payout_status_t status
      text_array booking_ids
    }

    notifications {
      text notification_id PK
      text user_id FK
      notif_type_t type
      bool read
    }

    support_threads {
      text thread_id PK
      text user_id FK
      support_status_t status
    }

    support_messages {
      text message_id PK
      text thread_id FK
      support_role_t role
      text content
    }

    agent_runs {
      text run_id PK
      agent_kind_t agent
      text user_id FK
      int tokens_in
      int tokens_out
    }

    admin_audit {
      text audit_id PK
      text admin_id FK
      text action
      text target_type
      text target_id
    }

    coupons {
      text coupon_id PK
      text code UK
      coupon_kind_t kind
      numeric value
      timestamptz valid_from
      timestamptz valid_to
    }
```

---

## Cardinality matrix

| From | Relationship | To | Notes |
|---|---|---|---|
| `users` | 1 → 0..N | `kyc_submissions` | history preserved across retries |
| `users` (owner role) | 1 → 0..N | `vehicles` | `vehicles.owner_id` FK |
| `users` | 1 → 0..N | `bookings` (renter) | `bookings.user_id` FK |
| `users` | 1 → 0..N | `bookings` (owner) | `bookings.owner_id` FK (denormalized for owner queries) |
| `vehicles` | 1 → 0..N | `vehicle_availability_blocks` | child of nested `availability_blocks[]` from Mongo |
| `bookings` | 1 → 0..1 | `payments` | a booking has at most one primary payment (refund tracked inline) |
| `bookings` | 1 → 0..2 | `inspections` | UNIQUE(booking_id, phase) → one `before` + one `after` |
| `bookings` | 1 → 0..N | `gps_tracks` | many pings during active trip |
| `vehicles` | 1 → 0..N | `gps_tracks` | pings continue even when idle |
| `vehicles` | 1 → 0..N | `geofence_events` | independent of bookings |
| `payouts` | M → N | `bookings` | references many bookings via `booking_ids[]` array (intentionally denormalized; payout windows are immutable once paid) |
| `support_threads` | 1 → 0..N | `support_messages` | conversation history |
| `coupons` | 1 → 0..N | `bookings` | `bookings.coupon_code` text reference |

## Critical constraints encoded at DB level

1. **No double-booking** — `bookings.bk_no_overlap` GIST exclusion constraint on `vehicle_id × tstzrange(start_date, end_date)` for `status IN ('confirmed','active')`. Postgres rejects overlapping confirmed bookings atomically.
2. **One inspection per phase per booking** — `inspections.ins_unique_phase` UNIQUE.
3. **Append-only ledgers/audit/telemetry** — `REVOKE UPDATE, DELETE` from PUBLIC; only `service_role` can INSERT (via Supabase RLS + REVOKE).
4. **Score sanity** — `CHECK (ai_score BETWEEN 0 AND 1)`, `liveness_score`, `face_match_score`.
5. **Money positivity** — `payments.amount > 0`, `ride_miles >= 0`.
6. **Coherent date ranges** — `bookings.bk_date_range CHECK (end_date > start_date)`, same on availability blocks.

These are the guardrails that **cannot** be expressed cleanly in MongoDB and are the strongest argument for moving to PG when you cut over.

---

## Notes for the MVP Mongo runtime

While we continue on Mongo, the codebase will:
- Keep `vehicles.availability_blocks` as a top-level Mongo collection `vehicle_availability_blocks` (not nested) so migration is row-for-row.
- Run conflict detection in application code (read-then-write) since Mongo cannot express the GIST exclusion. We accept the small race window because typical booking traffic is sparse; will be replaced by PG's exclusion constraint at migration time.
- Use BSON UUIDs as `TEXT`-compatible strings (`usr_…`) — already in place.
- Never embed objects inside arrays we don't already have a child table for.
