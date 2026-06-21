-- ============================================================
-- Raidex — Supabase (PostgreSQL) Initial Schema
-- ============================================================
-- Run order matters: referenced tables first.
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── users ────────────────────────────────────────────────────

create table if not exists users (
    user_id         text        primary key default 'usr_' || encode(gen_random_bytes(6), 'hex'),
    email           text        not null unique,
    name            text        not null,
    password_hash   text,
    avatar          text,
    phone           text,
    role            text        not null default 'customer'
                                check (role in ('customer', 'owner', 'admin')),
    roles           text[]      not null default array['customer'],
    kyc_status      text        not null default 'pending'
                                check (kyc_status in ('pending', 'submitted', 'verified', 'rejected')),
    current_kyc_id  text,
    wallet_balance  numeric(12,2) not null default 500.00,
    ride_miles      integer     not null default 250,
    tier            text        not null default 'Silver'
                                check (tier in ('Silver', 'Gold', 'Platinum')),
    created_at      timestamptz not null default now()
);

create index if not exists idx_users_email on users (email);

-- ── user_sessions (Google OAuth / Emergent) ─────────────────

create table if not exists user_sessions (
    session_token   text        primary key,
    user_id         text        not null references users (user_id) on delete cascade,
    expires_at      timestamptz not null,
    created_at      timestamptz not null default now()
);

-- ── push_tokens ──────────────────────────────────────────────

create table if not exists push_tokens (
    id          bigserial   primary key,
    user_id     text        not null references users (user_id) on delete cascade,
    token       text        not null,
    platform    text        not null default 'unknown',
    updated_at  timestamptz not null default now(),
    unique (user_id, token)
);

-- ── vehicles ─────────────────────────────────────────────────

create table if not exists vehicles (
    vehicle_id              text        primary key default 'veh_' || encode(gen_random_bytes(5), 'hex'),
    owner_id                text        not null references users (user_id),
    type                    text        not null check (type in ('car', 'bike')),
    name                    text        not null,
    brand                   text        not null,
    model                   text        not null,
    image                   text        not null,
    images                  text[]      not null default '{}',
    price_per_hour          numeric(10,2) not null,
    price_per_day           numeric(10,2) not null,
    price_per_week          numeric(10,2) not null,
    price_per_month         numeric(10,2) not null,
    deposit                 numeric(10,2) not null,
    transmission            text        not null,
    fuel_type               text        not null,
    seats                   integer     not null,
    rating                  numeric(3,2) not null default 4.5,
    trips                   integer     not null default 0,
    lifetime_km             integer     not null default 0,
    distance_km             numeric(6,2) not null default 1.0,
    location                text        not null,
    latitude                numeric(9,6) not null,
    longitude               numeric(9,6) not null,
    host_name               text        not null,
    host_avatar             text        not null default '',
    available               boolean     not null default true,
    features                text[]      not null default '{}',
    description             text        not null default '',
    verification_status     text        not null default 'pending'
                                        check (verification_status in ('pending', 'approved', 'rejected')),
    home_geofence_radius_m  integer     not null default 25000,
    last_track_lat          numeric(9,6),
    last_track_lng          numeric(9,6),
    last_track_speed        numeric(6,2),
    last_track_at           timestamptz,
    created_at              timestamptz not null default now()
);

create index if not exists idx_vehicles_owner on vehicles (owner_id);
create index if not exists idx_vehicles_available on vehicles (available, type);

-- ── bookings ─────────────────────────────────────────────────

create table if not exists bookings (
    booking_id          text        primary key default 'bkg_' || encode(gen_random_bytes(6), 'hex'),
    user_id             text        not null references users (user_id),
    vehicle_id          text        not null references vehicles (vehicle_id),
    owner_id            text        not null references users (user_id),
    vehicle_snapshot    jsonb       not null default '{}',
    plan                text        not null check (plan in ('hourly', 'daily', 'weekly', 'monthly')),
    start_date          timestamptz not null,
    end_date            timestamptz not null,
    total_amount        numeric(12,2) not null,
    deposit             numeric(10,2) not null,
    status              text        not null default 'pending_payment'
                                    check (status in ('pending_payment', 'confirmed', 'active', 'completed', 'cancelled')),
    add_ons             text[]      not null default '{}',
    payment_id          text,
    odometer_start      numeric(8,1),
    odometer_end        numeric(8,1),
    inspection_before_id text,
    inspection_after_id  text,
    miles_earned        integer,
    started_at          timestamptz,
    ended_at            timestamptz,
    created_at          timestamptz not null default now()
);

create index if not exists idx_bookings_user on bookings (user_id, created_at desc);
create index if not exists idx_bookings_owner on bookings (owner_id, created_at desc);
create index if not exists idx_bookings_vehicle on bookings (vehicle_id);
create index if not exists idx_bookings_status on bookings (status);

-- ── payments ─────────────────────────────────────────────────

create table if not exists payments (
    payment_id          text        primary key default 'pay_' || encode(gen_random_bytes(6), 'hex'),
    user_id             text        not null references users (user_id),
    booking_id          text        references bookings (booking_id),
    purpose             text        not null default 'booking'
                                    check (purpose in ('booking', 'deposit', 'wallet_topup')),
    amount              numeric(12,2) not null,
    currency            text        not null default 'INR',
    provider            text        not null default 'mock',
    provider_order_id   text,
    provider_payment_id text,
    provider_signature  text,
    status              text        not null default 'created'
                                    check (status in ('created', 'processing', 'succeeded', 'failed', 'refunded')),
    failure_reason      text,
    refund_amount       numeric(12,2) not null default 0,
    refund_status       text        not null default 'none'
                                    check (refund_status in ('none', 'pending', 'processed', 'failed')),
    refunded_at         timestamptz,
    metadata            jsonb       not null default '{}',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_payments_user on payments (user_id, created_at desc);
create index if not exists idx_payments_booking on payments (booking_id);
create index if not exists idx_payments_status on payments (status);
create index if not exists idx_payments_provider_order on payments (provider_order_id);

-- ── kyc_submissions ──────────────────────────────────────────

create table if not exists kyc_submissions (
    kyc_id              text        primary key default 'kyc_' || encode(gen_random_bytes(6), 'hex'),
    user_id             text        not null references users (user_id),
    -- Document images stored as base64 data URIs (large — consider moving to Supabase Storage)
    aadhaar_front       text,
    aadhaar_back        text,
    aadhaar_last4       char(4),
    dl_front            text,
    dl_back             text,
    dl_number           text,
    dl_expiry           text,
    face_selfie         text,
    provider            text        not null default 'stub',
    status              text        not null default 'processing'
                                    check (status in ('processing', 'verified', 'rejected')),
    face_match_score    numeric(4,3),
    liveness_score      numeric(4,3),
    rejection_reason    text,
    submitted_at        timestamptz not null default now(),
    verified_at         timestamptz
);

create index if not exists idx_kyc_user on kyc_submissions (user_id, submitted_at desc);

-- ── inspections ──────────────────────────────────────────────

create table if not exists inspections (
    inspection_id   text        primary key default 'ins_' || encode(gen_random_bytes(6), 'hex'),
    booking_id      text        not null references bookings (booking_id),
    vehicle_id      text        not null references vehicles (vehicle_id),
    phase           text        not null check (phase in ('before', 'after')),
    photo_front     text,
    photo_back      text,
    photo_left      text,
    photo_right     text,
    photo_dashboard text,
    photo_odometer  text,
    video_url       text,
    odometer_value  numeric(8,1) not null,
    fuel_level      text        not null
                                check (fuel_level in ('empty', 'quarter', 'half', 'threequarter', 'full')),
    notes           text        not null default '',
    ai_score        numeric(4,3),
    ai_findings     jsonb       not null default '[]',
    damage_comparison jsonb,
    submitted_at    timestamptz not null default now(),
    unique (booking_id, phase)
);

-- ── gps_tracks ───────────────────────────────────────────────

create table if not exists gps_tracks (
    track_id    text        primary key default 'trk_' || encode(gen_random_bytes(6), 'hex'),
    vehicle_id  text        not null references vehicles (vehicle_id),
    booking_id  text        references bookings (booking_id),
    lat         numeric(9,6) not null,
    lng         numeric(9,6) not null,
    speed_kmph  numeric(6,2) not null default 0,
    heading     integer     not null default 0,
    recorded_at timestamptz not null default now()
);

create index if not exists idx_gps_booking on gps_tracks (booking_id, recorded_at);
create index if not exists idx_gps_vehicle on gps_tracks (vehicle_id, recorded_at desc);

-- ── geofence_events ──────────────────────────────────────────

create table if not exists geofence_events (
    event_id        text        primary key default 'evt_' || encode(gen_random_bytes(5), 'hex'),
    vehicle_id      text        not null references vehicles (vehicle_id),
    owner_id        text        not null references users (user_id),
    booking_id      text        references bookings (booking_id),
    kind            text        not null check (kind in ('exit_home', 'excess_speed')),
    lat             numeric(9,6),
    lng             numeric(9,6),
    meta            jsonb       not null default '{}',
    acknowledged    boolean     not null default false,
    created_at      timestamptz not null default now()
);

create index if not exists idx_geo_owner on geofence_events (owner_id, created_at desc);
create index if not exists idx_geo_acked on geofence_events (acknowledged);

-- ── notifications ────────────────────────────────────────────

create table if not exists notifications (
    notification_id text        primary key default 'ntf_' || encode(gen_random_bytes(5), 'hex'),
    user_id         text        not null references users (user_id),
    title           text        not null,
    body            text        not null,
    type            text        not null,
    read            boolean     not null default false,
    created_at      timestamptz not null default now()
);

create index if not exists idx_notif_user on notifications (user_id, created_at desc);

-- ── wallet_ledger ────────────────────────────────────────────

create table if not exists wallet_ledger (
    ledger_id       text        primary key default 'wl_' || encode(gen_random_bytes(6), 'hex'),
    user_id         text        not null references users (user_id),
    delta           numeric(12,2) not null,
    reason          text        not null,
    payment_id      text        references payments (payment_id),
    ref_id          text,
    balance_after   numeric(12,2) not null,
    created_at      timestamptz not null default now()
);

create index if not exists idx_wallet_user on wallet_ledger (user_id, created_at desc);

-- ── ride_miles_ledger ────────────────────────────────────────

create table if not exists ride_miles_ledger (
    ledger_id       text        primary key default 'ml_' || encode(gen_random_bytes(6), 'hex'),
    user_id         text        not null references users (user_id),
    delta           integer     not null,
    reason          text        not null,
    ref_type        text,
    ref_id          text,
    balance_after   integer     not null,
    created_at      timestamptz not null default now()
);

create index if not exists idx_miles_user on ride_miles_ledger (user_id, created_at desc);

-- ── support_threads ──────────────────────────────────────────

create table if not exists support_threads (
    thread_id       text        primary key default 'thr_' || encode(gen_random_bytes(6), 'hex'),
    user_id         text        not null references users (user_id),
    subject         text        not null default '',
    status          text        not null default 'open' check (status in ('open', 'resolved', 'escalated')),
    assigned_agent  text        not null default 'support',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ── support_messages ─────────────────────────────────────────

create table if not exists support_messages (
    message_id  text        primary key default 'msg_' || encode(gen_random_bytes(5), 'hex'),
    thread_id   text        not null references support_threads (thread_id) on delete cascade,
    role        text        not null check (role in ('user', 'assistant')),
    content     text        not null,
    created_at  timestamptz not null default now()
);

create index if not exists idx_msgs_thread on support_messages (thread_id, created_at);

-- ── agent_runs ───────────────────────────────────────────────

create table if not exists agent_runs (
    run_id      text        primary key default 'run_' || encode(gen_random_bytes(5), 'hex'),
    agent       text        not null,
    user_id     text        references users (user_id),
    owner_id    text        references users (user_id),
    input       text,
    output      text,
    model       text,
    latency_ms  integer,
    error       text,
    created_at  timestamptz not null default now()
);

-- ── admin_audit ──────────────────────────────────────────────

create table if not exists admin_audit (
    audit_id        text        primary key default 'aud_' || encode(gen_random_bytes(5), 'hex'),
    admin_id        text        not null references users (user_id),
    action          text        not null,
    target_type     text        not null,
    target_id       text        not null,
    before_state    jsonb,
    after_state     jsonb,
    created_at      timestamptz not null default now()
);

-- ── payouts (owner payouts) ──────────────────────────────────

create table if not exists payouts (
    payout_id       text        primary key default 'po_' || encode(gen_random_bytes(6), 'hex'),
    owner_id        text        not null references users (user_id),
    gross_amount    numeric(12,2) not null,
    commission      numeric(12,2) not null,
    net_amount      numeric(12,2) not null,
    status          text        not null default 'pending'
                                check (status in ('pending', 'processing', 'paid', 'failed')),
    period_start    timestamptz not null,
    period_end      timestamptz not null,
    paid_at         timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists idx_payouts_owner on payouts (owner_id, period_end desc);

-- ============================================================
-- Row-Level Security (enable after validating with service role)
-- ============================================================
-- Uncomment when ready to enforce RLS through Supabase Auth:
--
-- alter table users enable row level security;
-- create policy "Users can read own row"
--   on users for select using (auth.uid()::text = user_id);
--
-- alter table bookings enable row level security;
-- create policy "Users can read own bookings"
--   on bookings for select using (auth.uid()::text = user_id);
-- create policy "Owners can read their bookings"
--   on bookings for select using (auth.uid()::text = owner_id);
