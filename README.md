# Raidex

Raidex is a vehicle rental platform with a React Native Expo mobile app and a FastAPI backend. This README is the main map for the project. For deeper details, use the three focused docs:

- [Backend Guide](docs/BACKEND.md)
- [Frontend Guide](docs/FRONTEND.md)
- [Database Guide](docs/DATABASE.md)

## Project Structure

```text
Raidex-main/
  backend/        FastAPI API, auth, bookings, payments, admin, owner, jobs
  frontend/       Expo React Native app
  docs/           Backend, frontend, and database documentation
  scripts/        Operational helper scripts
  load-tests/     Load testing scenarios
```

## Quick Start

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```powershell
cd frontend
npm install
copy .env.example .env
npx expo start
```

Android local build:

```powershell
cd frontend
npx expo prebuild --platform android --clean
.\android\gradlew.bat -p android :app:assembleDebug
```

EAS build:

```powershell
cd frontend
npx eas-cli build --platform android --profile preview
```

## Required Environment

Backend `.env`:

```env
MONGO_URL=mongodb+srv://...
DB_NAME=raidex
JWT_SECRET=replace_with_strong_secret
ALLOWED_ORIGINS=http://localhost:8081
PAYMENT_PROVIDER=mock
KYC_PROVIDER=stub
```

Frontend `.env`:

```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
EXPO_PUBLIC_SENTRY_DSN=
```

For production, do not use mock payment/KYC providers and do not use localhost in `ALLOWED_ORIGINS`.

## Main Search Tags In Code

Use these tags in search:

- `RAIDEX_BACKEND_ENTRYPOINT` - backend app startup, API routes, health, middleware
- `RAIDEX_BOOKING_SERVICE` - booking create/cancel/extend/invoice/disputes
- `RAIDEX_FRONTEND_API_CLIENT` - frontend API requests, auth token, timeout, offline retry
- `RAIDEX_FRONTEND_ROOT_LAYOUT` - app startup, protected routes, auth redirects
- `RAIDEX_DATABASE_SCHEMA` - database tables and indexes

## Core Flows

- Authentication: register, login, refresh token, logout, session revoke
- KYC: submit documents, check status, admin approve/reject
- Vehicle discovery: list, filters, detail, availability, reviews
- Booking: create, pay, confirm, start trip, end trip, cancel, extend
- Payments: create, confirm, refund, webhook handling
- Owner: vehicles, bookings, earnings, fleet health, calendar
- Admin: users, KYC, vehicles, bookings, payments, disputes, health, audit

## Tests

Backend:

```powershell
pytest
```

Frontend:

```powershell
cd frontend
npm test
```

## Documentation Policy

Documentation is intentionally consolidated. Keep new project guidance inside:

- `README.md`
- `docs/BACKEND.md`
- `docs/FRONTEND.md`
- `docs/DATABASE.md`

Avoid creating separate one-off setup, summary, or phase report files unless they are temporary and not committed.
