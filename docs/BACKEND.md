# Backend Guide

## Purpose

The backend is a FastAPI service for Raidex customer, owner, and admin operations. The main entrypoint is `backend/server.py`.

Search `RAIDEX_BACKEND_ENTRYPOINT` to jump directly to the backend app setup.

## Run Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```powershell
curl http://localhost:8000/api/health
```

## Important Files

| Area | File |
| --- | --- |
| FastAPI app and routes | `backend/server.py` |
| Booking business rules | `backend/features/booking/service.py` |
| Providers | `backend/providers/` |
| Analytics, audit, events, jobs | `backend/raidex_platform/` |
| Tests | `backend/tests/` |
| Supabase SQL schema | `backend/supabase/migrations/001_initial_schema.sql` |

## Environment

Required:

```env
MONGO_URL=
DB_NAME=
JWT_SECRET=
ALLOWED_ORIGINS=
```

Optional:

```env
ENV=development
SENTRY_DSN=
PAYMENT_PROVIDER=mock
KYC_PROVIDER=stub
RAIDEX_GSTIN=
```

Production rules:

- `JWT_SECRET` must be strong and unique.
- `ALLOWED_ORIGINS` must be deployed domains, not localhost.
- `PAYMENT_PROVIDER` must not be `mock`.
- `KYC_PROVIDER` must not be `stub`.

## API Map

Base path: `/api`

Version aliases: `/api/v1`, `/api/v2`

| Flow | Routes |
| --- | --- |
| Health/config | `/health`, `/config` |
| Realtime | `/ws` |
| Auth | `/auth/register`, `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`, `/auth/sessions` |
| KYC | `/kyc/submit`, `/kyc/status`, `/admin/kyc` |
| Vehicles | `/vehicles`, `/vehicles/{id}`, `/vehicles/{id}/availability`, `/vehicles/compare` |
| Reviews | `/vehicles/{id}/reviews` |
| Wishlist | `/wishlist`, `/wishlist/{vehicle_id}` |
| Bookings | `/bookings`, `/bookings/{id}`, `/bookings/{id}/cancel`, `/bookings/{id}/extend`, `/bookings/{id}/invoice` |
| Payments | `/payments/create`, `/payments/{id}/confirm`, `/payments/{id}/refund`, `/webhooks/razorpay` |
| Trips | `/bookings/{id}/start`, `/bookings/{id}/end`, `/gps/track`, `/bookings/{id}/trail` |
| Owner | `/owner/stats`, `/owner/vehicles`, `/owner/bookings`, `/owner/earnings`, `/owner/calendar` |
| Admin | `/admin/kpis`, `/admin/users`, `/admin/bookings`, `/admin/payments`, `/admin/disputes`, `/admin/system-health` |

## Business Logic

Booking logic lives in `backend/features/booking/service.py`.

Search `RAIDEX_BOOKING_SERVICE` for booking creation, KYC guard, availability conflicts, cancellation, extension, invoice, GST invoice, and disputes.

## Security

Implemented protections include JWT access tokens, refresh tokens, bcrypt password hashing, role checks, rate limiting, production environment validation, audit records, and optional Sentry.

## Tests

```powershell
pytest
pytest backend/tests -q
pytest -k auth
pytest -k booking
pytest -k payment
pytest -k kyc
```

## Deployment Checklist

- Set production `.env`.
- Verify `/api/health`.
- Run backend tests.
- Confirm payment provider keys.
- Confirm KYC provider keys.
- Confirm CORS origins.
- Confirm Sentry DSN.
