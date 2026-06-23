# Raidex — Database Schema (PostgreSQL / Supabase, canonical)

> **Production target:** PostgreSQL 15+ (Supabase). All tables include `created_at` + `updated_at` (auto-managed via Supabase triggers or SQLAlchemy events). Soft deletes only on `users` and `vehicles`.
> **Preview runtime:** MongoDB collections with the same names and (string) primary keys, follow relational discipline (FK references stored as strings, no nested docs, append-only ledgers). Mongo→PG migration is a 1:1 row copy with light type coercion.

## Conventions
- Primary keys: `TEXT` with prefixed UUIDs (`usr_<12hex>`, `veh_<10hex>`, etc.). This keeps IDs portable across Mongo and PG and is human-grep-able in logs.
- Money columns: `NUMERIC(12,2)` (INR rupees).
- Datetimes: `TIMESTAMPTZ` (always UTC).
- Enums: PG native `ENUM` types (listed at top of each section).
- Foreign keys: `ON DELETE RESTRICT` except where explicitly noted (audit/ledger keep historical refs even if parent removed).
- Indexes called out under each table.
- All sensitive media columns (KYC, inspection) stored as `TEXT` URLs in production (signed S3 URLs). MVP runtime stores base64 in same columns.
- Append-only tables (`*_ledger`, `audit`, `agent_runs`, `gps_tracks`, `geofence_events`) — no UPDATE or DELETE allowed (enforced via Supabase RLS + revoke).

---

## Enum types

```sql
CREATE TYPE role_t              AS ENUM ('customer','owner','admin');
CREATE TYPE kyc_status_t        AS ENUM ('pending','submitted','processing','verified','rejected');
CREATE TYPE vehicle_type_t      AS ENUM ('car','bike');
CREATE TYPE verification_t      AS ENUM ('pending','approved','rejected');
CREATE TYPE booking_plan_t      AS ENUM ('hourly','daily','weekly','monthly');
CREATE TYPE booking_status_t    AS ENUM ('pending_payment','confirmed','active','completed','cancelled','disputed');
CREATE TYPE payment_purpose_t   AS ENUM ('booking','deposit','wallet_topup','subscription_renewal');
CREATE TYPE payment_status_t    AS ENUM ('created','processing','succeeded','failed','refunded','partially_refunded');
CREATE TYPE refund_status_t     AS ENUM ('none','requested','processed','failed');
CREATE TYPE inspection_phase_t  AS ENUM ('before','after');
CREATE TYPE fuel_level_t        AS ENUM ('empty','quarter','half','threequarter','full');
CREATE TYPE geo_event_kind_t    AS ENUM ('exit_home','enter_home','excess_speed','idle_too_long');
CREATE TYPE miles_reason_t      AS ENUM ('booking','distance','referral','review','redeem','bonus','expiry');
CREATE TYPE wallet_reason_t     AS ENUM ('topup','booking','refund','payout','bonus','adjustment');
CREATE TYPE payout_status_t     AS ENUM ('scheduled','processing','paid','failed');
CREATE TYPE notif_type_t        AS ENUM ('booking','trip','payment','kyc','reward','geo_alert','system');
CREATE TYPE support_status_t    AS ENUM ('open','resolved','escalated');
CREATE TYPE support_role_t      AS ENUM ('user','assistant','system');
CREATE TYPE agent_kind_t        AS ENUM ('support','operations','finance');
CREATE TYPE coupon_kind_t       AS ENUM ('flat','percent');
```

---

## 1. `users`
```sql
CREATE TABLE users (
  user_id          TEXT PRIMARY KEY,
  email            CITEXT NOT NULL UNIQUE,
  phone            TEXT,
  name             TEXT NOT NULL,
  avatar_url       TEXT,
  password_hash    TEXT,
  google_id        TEXT UNIQUE,
  roles            role_t[] NOT NULL DEFAULT ARRAY['customer']::role_t[],
  kyc_status       kyc_status_t NOT NULL DEFAULT 'pending',
  current_kyc_id   TEXT REFERENCES kyc_submissions(kyc_id) DEFERRABLE INITIALLY DEFERRED,
  wallet_balance   NUMERIC(12,2) NOT NULL DEFAULT 500.00,
  ride_miles       INTEGER NOT NULL DEFAULT 250 CHECK (ride_miles >= 0),
  tier             TEXT NOT NULL DEFAULT 'Silver',
  last_lat         DOUBLE PRECISION,
  last_lng         DOUBLE PRECISION,
  last_geo_at      TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX users_roles_idx ON users USING GIN (roles);
CREATE INDEX users_tier_idx  ON users (tier);
```

## 2. `kyc_submissions`
```sql
CREATE TABLE kyc_submissions (
  kyc_id              TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(user_id),
  aadhaar_front       TEXT NOT NULL,
  aadhaar_back        TEXT NOT NULL,
  aadhaar_last4       CHAR(4),
  dl_front            TEXT NOT NULL,
  dl_back             TEXT NOT NULL,
  dl_number           TEXT NOT NULL,
  dl_expiry           DATE,
  face_selfie         TEXT NOT NULL,
  liveness_score      NUMERIC(4,3) CHECK (liveness_score BETWEEN 0 AND 1),
  face_match_score    NUMERIC(4,3) CHECK (face_match_score BETWEEN 0 AND 1),
  provider            TEXT NOT NULL DEFAULT 'stub',
  status              kyc_status_t NOT NULL DEFAULT 'processing',
  rejection_reason    TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at         TIMESTAMPTZ
);
CREATE INDEX kyc_user_idx   ON kyc_submissions (user_id);
CREATE INDEX kyc_status_idx ON kyc_submissions (status);
```

## 3. `vehicles`
```sql
CREATE TABLE vehicles (
  vehicle_id              TEXT PRIMARY KEY,
  owner_id                TEXT NOT NULL REFERENCES users(user_id),
  type                    vehicle_type_t NOT NULL,
  name                    TEXT NOT NULL,
  brand                   TEXT NOT NULL,
  model                   TEXT NOT NULL,
  year                    SMALLINT,
  registration_number     TEXT UNIQUE,
  rc_url                  TEXT,
  insurance_url           TEXT,
  pollution_url           TEXT,
  hero_image              TEXT NOT NULL,
  gallery_images          TEXT[] NOT NULL DEFAULT '{}',
  price_per_hour          NUMERIC(10,2) NOT NULL,
  price_per_day           NUMERIC(10,2) NOT NULL,
  price_per_week          NUMERIC(10,2) NOT NULL,
  price_per_month         NUMERIC(10,2) NOT NULL,
  subscription_monthly    NUMERIC(10,2),
  deposit                 NUMERIC(10,2) NOT NULL,
  transmission            TEXT NOT NULL,
  fuel_type               TEXT NOT NULL,
  seats                   SMALLINT NOT NULL,
  features                TEXT[] NOT NULL DEFAULT '{}',
  description             TEXT,
  location                TEXT NOT NULL,
  latitude                DOUBLE PRECISION NOT NULL,
  longitude               DOUBLE PRECISION NOT NULL,
  home_geofence_radius_m  INTEGER NOT NULL DEFAULT 25000,
  rating                  NUMERIC(3,2) NOT NULL DEFAULT 0,
  trips                   INTEGER NOT NULL DEFAULT 0,
  lifetime_km             NUMERIC(10,1) NOT NULL DEFAULT 0,
  last_service_km         NUMERIC(10,1) NOT NULL DEFAULT 0,
  gps_device_id           TEXT,
  verification_status     verification_t NOT NULL DEFAULT 'pending',
  available               BOOLEAN NOT NULL DEFAULT FALSE,
  last_track_lat          DOUBLE PRECISION,
  last_track_lng          DOUBLE PRECISION,
  last_track_at           TIMESTAMPTZ,
  last_track_speed        NUMERIC(5,1),
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX vehicles_owner_idx        ON vehicles (owner_id);
CREATE INDEX vehicles_type_idx         ON vehicles (type);
CREATE INDEX vehicles_verification_idx ON vehicles (verification_status);
CREATE INDEX vehicles_available_idx    ON vehicles (available) WHERE available = TRUE;
-- Future (Supabase PostGIS extension):
-- CREATE INDEX vehicles_geo_gist ON vehicles USING GIST (ll_to_earth(latitude, longitude));
```

## 4. `vehicle_availability_blocks`
```sql
CREATE TABLE vehicle_availability_blocks (
  block_id    TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  from_at     TIMESTAMPTZ NOT NULL,
  to_at       TIMESTAMPTZ NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vab_range CHECK (to_at > from_at)
);
CREATE INDEX vab_vehicle_idx ON vehicle_availability_blocks (vehicle_id, from_at, to_at);
```

## 5. `bookings`
```sql
CREATE TABLE bookings (
  booking_id          TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(user_id),
  vehicle_id          TEXT NOT NULL REFERENCES vehicles(vehicle_id),
  owner_id            TEXT NOT NULL REFERENCES users(user_id),  -- denormalized
  vehicle_snapshot    JSONB NOT NULL,
  plan                booking_plan_t NOT NULL,
  is_subscription     BOOLEAN NOT NULL DEFAULT FALSE,
  start_date          TIMESTAMPTZ NOT NULL,
  end_date            TIMESTAMPTZ NOT NULL,
  pickup_location     TEXT,
  pickup_lat          DOUBLE PRECISION,
  pickup_lng          DOUBLE PRECISION,
  base_amount         NUMERIC(12,2) NOT NULL,
  add_ons             TEXT[] NOT NULL DEFAULT '{}',
  add_on_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12,2) NOT NULL,
  deposit             NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_code         TEXT,
  miles_used          INTEGER NOT NULL DEFAULT 0,
  miles_earned        INTEGER NOT NULL DEFAULT 0,
  payment_id          TEXT REFERENCES payments(payment_id) DEFERRABLE INITIALLY DEFERRED,
  status              booking_status_t NOT NULL DEFAULT 'pending_payment',
  odometer_start      NUMERIC(10,1),
  odometer_end        NUMERIC(10,1),
  inspection_before_id TEXT REFERENCES inspections(inspection_id) DEFERRABLE INITIALLY DEFERRED,
  inspection_after_id  TEXT REFERENCES inspections(inspection_id) DEFERRABLE INITIALLY DEFERRED,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bk_date_range CHECK (end_date > start_date)
);
CREATE INDEX bookings_user_idx     ON bookings (user_id);
CREATE INDEX bookings_owner_idx    ON bookings (owner_id);
CREATE INDEX bookings_vehicle_idx  ON bookings (vehicle_id);
CREATE INDEX bookings_status_idx   ON bookings (status);
CREATE INDEX bookings_start_idx    ON bookings (start_date);
-- Range overlap guard for confirmed/active bookings on same vehicle:
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT bk_no_overlap
  EXCLUDE USING GIST (
    vehicle_id WITH =,
    tstzrange(start_date, end_date, '[)') WITH &&
  ) WHERE (status IN ('confirmed','active'));
```

## 6. `payments`
```sql
CREATE TABLE payments (
  payment_id           TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(user_id),
  booking_id           TEXT REFERENCES bookings(booking_id),
  purpose              payment_purpose_t NOT NULL,
  amount               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency             CHAR(3) NOT NULL DEFAULT 'INR',
  provider             TEXT NOT NULL DEFAULT 'mock',
  provider_order_id    TEXT,
  provider_payment_id  TEXT,
  provider_signature   TEXT,
  status               payment_status_t NOT NULL DEFAULT 'created',
  failure_reason       TEXT,
  refund_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_status        refund_status_t NOT NULL DEFAULT 'none',
  refunded_at          TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payments_user_idx    ON payments (user_id);
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_status_idx  ON payments (status);
```

## 7. `inspections`
```sql
CREATE TABLE inspections (
  inspection_id        TEXT PRIMARY KEY,
  booking_id           TEXT NOT NULL REFERENCES bookings(booking_id),
  vehicle_id           TEXT NOT NULL REFERENCES vehicles(vehicle_id),
  phase                inspection_phase_t NOT NULL,
  photo_front          TEXT,
  photo_back           TEXT,
  photo_left           TEXT,
  photo_right          TEXT,
  photo_dashboard      TEXT,
  photo_odometer       TEXT,
  extra_photos         TEXT[] NOT NULL DEFAULT '{}',
  video_url            TEXT,
  odometer_value       NUMERIC(10,1) NOT NULL,
  fuel_level           fuel_level_t NOT NULL,
  notes                TEXT,
  ai_score             NUMERIC(4,3) CHECK (ai_score BETWEEN 0 AND 1),
  ai_findings          JSONB,
  damage_comparison    JSONB,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ins_unique_phase UNIQUE (booking_id, phase)
);
CREATE INDEX ins_booking_idx ON inspections (booking_id);
CREATE INDEX ins_vehicle_idx ON inspections (vehicle_id);
```

## 8. `gps_tracks` (append-only, time-series)
```sql
CREATE TABLE gps_tracks (
  track_id      BIGSERIAL PRIMARY KEY,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(vehicle_id),
  booking_id    TEXT REFERENCES bookings(booking_id),
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  speed_kmph    NUMERIC(5,1) NOT NULL DEFAULT 0,
  heading       SMALLINT CHECK (heading BETWEEN 0 AND 359),
  battery_pct   SMALLINT CHECK (battery_pct BETWEEN 0 AND 100),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX gps_vehicle_time_idx ON gps_tracks (vehicle_id, recorded_at DESC);
-- Retention: scheduled Supabase Edge Function deletes rows older than 90 days nightly.
-- INSERT-only enforced via RLS / role grants (REVOKE UPDATE, DELETE FROM PUBLIC).
```

## 9. `geofence_events`
```sql
CREATE TABLE geofence_events (
  event_id       TEXT PRIMARY KEY,
  vehicle_id     TEXT NOT NULL REFERENCES vehicles(vehicle_id),
  owner_id       TEXT NOT NULL REFERENCES users(user_id),
  booking_id     TEXT REFERENCES bookings(booking_id),
  kind           geo_event_kind_t NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  meta           JSONB NOT NULL DEFAULT '{}',
  acknowledged   BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX geo_vehicle_idx ON geofence_events (vehicle_id, created_at DESC);
CREATE INDEX geo_owner_open_idx ON geofence_events (owner_id) WHERE acknowledged = FALSE;
```

## 10. `ride_miles_ledger` (append-only)
```sql
CREATE TABLE ride_miles_ledger (
  ledger_id        BIGSERIAL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id),
  delta            INTEGER NOT NULL,
  reason           miles_reason_t NOT NULL,
  ref_type         TEXT,           -- 'booking' | 'reward' | ...
  ref_id           TEXT,
  balance_after    INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX miles_user_time_idx ON ride_miles_ledger (user_id, created_at DESC);
-- REVOKE UPDATE, DELETE FROM PUBLIC
```

## 11. `wallet_ledger` (append-only)
```sql
CREATE TABLE wallet_ledger (
  ledger_id        BIGSERIAL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id),
  delta            NUMERIC(12,2) NOT NULL,
  reason           wallet_reason_t NOT NULL,
  payment_id       TEXT REFERENCES payments(payment_id),
  ref_type         TEXT,
  ref_id           TEXT,
  balance_after    NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX wallet_user_time_idx ON wallet_ledger (user_id, created_at DESC);
```

## 12. `payouts` (owner settlement)
```sql
CREATE TABLE payouts (
  payout_id        TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users(user_id),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  gross_earnings   NUMERIC(12,2) NOT NULL,
  commission       NUMERIC(12,2) NOT NULL,
  tax              NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_payable      NUMERIC(12,2) NOT NULL,
  booking_ids      TEXT[] NOT NULL,
  bank_ifsc        TEXT,
  bank_account_masked TEXT,
  status           payout_status_t NOT NULL DEFAULT 'scheduled',
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payouts_owner_idx ON payouts (owner_id, period_end DESC);
```

## 13. `notifications`
```sql
CREATE TABLE notifications (
  notification_id  TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  type             notif_type_t NOT NULL,
  deeplink         TEXT,
  read             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notif_user_idx ON notifications (user_id, created_at DESC) WHERE read = FALSE;
```

## 14. `support_threads` & `support_messages`
```sql
CREATE TABLE support_threads (
  thread_id       TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  subject         TEXT NOT NULL,
  status          support_status_t NOT NULL DEFAULT 'open',
  assigned_agent  TEXT NOT NULL DEFAULT 'support_ai',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sth_user_idx ON support_threads (user_id);

CREATE TABLE support_messages (
  message_id    TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL REFERENCES support_threads(thread_id) ON DELETE CASCADE,
  role          support_role_t NOT NULL,
  content       TEXT NOT NULL,
  tool_calls    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX smsg_thread_idx ON support_messages (thread_id, created_at);
```

## 15. `agent_runs` (Nexus telemetry, append-only)
```sql
CREATE TABLE agent_runs (
  run_id        TEXT PRIMARY KEY,
  agent         agent_kind_t NOT NULL,
  user_id       TEXT REFERENCES users(user_id),
  input         TEXT NOT NULL,
  output        TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  model         TEXT,
  latency_ms    INTEGER,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_runs_agent_time_idx ON agent_runs (agent, created_at DESC);
```

## 16. `admin_audit` (append-only)
```sql
CREATE TABLE admin_audit (
  audit_id      TEXT PRIMARY KEY,
  admin_id      TEXT NOT NULL REFERENCES users(user_id),
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  before_state  JSONB,
  after_state   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_target_idx ON admin_audit (target_type, target_id);
```

## 17. `coupons`
```sql
CREATE TABLE coupons (
  coupon_id        TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  kind             coupon_kind_t NOT NULL,
  value            NUMERIC(10,2) NOT NULL,
  min_booking      NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount     NUMERIC(10,2),
  valid_from       TIMESTAMPTZ NOT NULL,
  valid_to         TIMESTAMPTZ NOT NULL,
  usage_limit      INTEGER,
  used_count       INTEGER NOT NULL DEFAULT 0,
  applicable_plans booking_plan_t[] NOT NULL DEFAULT '{}',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Supabase RLS (Row-Level Security) sketch

```sql
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;

-- Customer can see only their own bookings:
CREATE POLICY bk_self ON bookings FOR SELECT
  USING (user_id = auth.uid() OR owner_id = auth.uid()
         OR EXISTS (SELECT 1 FROM users WHERE user_id = auth.uid() AND 'admin' = ANY(roles)));

-- Append-only ledgers are admin/service-role only:
REVOKE INSERT, UPDATE, DELETE ON ride_miles_ledger, wallet_ledger, gps_tracks, admin_audit, agent_runs FROM PUBLIC;
GRANT INSERT ON ride_miles_ledger, wallet_ledger, gps_tracks, admin_audit, agent_runs TO service_role;
```

(Full RLS suite to be authored in Supabase migration file when we cut over.)

---

## Mongo → PostgreSQL migration plan (reference)

| Mongo collection (current) | PG table (target) | Notes |
|---|---|---|
| `users` | `users` | `roles` array of enum, drop nested `geo` → `last_lat/lng/at` cols |
| `kyc_submissions` | `kyc_submissions` | URLs/base64 same shape |
| `vehicles` | `vehicles` + `vehicle_availability_blocks` | extract nested `availability_blocks` into child table |
| `bookings` | `bookings` | JSONB for `vehicle_snapshot` only |
| `payments` | `payments` | metadata → JSONB |
| `inspections` | `inspections` | photos array → discrete columns + `extra_photos` array |
| `gps_tracks` | `gps_tracks` | `BIGSERIAL` PK; preserve `recorded_at` for time-series |
| `geofence_events` | `geofence_events` | direct |
| `ride_miles_ledger` | `ride_miles_ledger` | direct |
| `wallet_ledger` | `wallet_ledger` | direct |
| `notifications` | `notifications` | direct |
| `support_threads/messages` | same | direct |
| `agent_runs` | `agent_runs` | direct |
| `admin_audit` | `admin_audit` | direct |
| `coupons` | `coupons` | direct |
| `payouts` | `payouts` | direct |

Runtime discipline (Mongo today) that keeps the path open:
1. **No nested arrays of objects** that you cannot project into a child table (vehicle availability is the only one — we already plan a child table).
2. **All FKs are string IDs**, never embedded documents.
3. **Ledgers are append-only** (no `update_one` on existing ledger rows).
4. **No Mongo-only operators in business code** (`$pull`, `$elemMatch`) — keep queries simple equality/range so the SQL equivalent is obvious.
5. **Timestamps stored as ISO-8601 UTC strings** in Mongo — direct conversion to `TIMESTAMPTZ`.

Migration tool: `pgloader` for bulk copy + a thin Python script to coerce enums and arrays.
