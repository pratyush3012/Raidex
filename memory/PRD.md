# RIDEX — Product Requirements Document (MVP)

**Tagline:** Drive More. Own Less.

**Mission:** Asset-light mobility marketplace connecting customers with cars and bikes from individual owners, fleet operators, and showrooms. Customers can rent (hourly/daily/weekly/monthly), subscribe, or eventually purchase vehicles.

## Stack
- Frontend: Expo (React Native) SDK 54, expo-router file-based routing
- Backend: FastAPI + Motor (async MongoDB)
- DB: MongoDB
- Auth: JWT (email/password) + Emergent Google Auth
- Payments: Mocked (Razorpay planned)
- Maps: Static (react-native-maps planned for native build)

## MVP Scope (Customer App)
1. **Splash & Onboarding** — Cinematic hero "Drive More. Own Less." CTA → auth
2. **Auth** — Email/password signup & login; Continue with Google (Emergent-managed)
3. **Home / Discovery** — Greeting, RideMiles tier banner, search, category chip row (All / Cars / Bikes / Subscriptions / Swap), scrollable vehicle list with rich cards (image, rating, location, seats, fuel, transmission, distance, price/day, View CTA)
4. **Vehicle Details** — Full-bleed hero, brand+name, distance, rating, specs strip, About, Features, Host card, refundable deposit, sticky "Book now" CTA
5. **Booking Flow** — Plan picker (hourly/daily/weekly/monthly), duration stepper, computed pickup/return dates, add-ons (helmet, insurance, delivery), itemized price breakdown with 18% tax & deposit, sticky Confirm & Pay
6. **Trips** — All / Active / Past filter tabs, status-coloured booking cards, "Start trip" then "End trip" controls. Ending awards RideMiles based on simulated distance.
7. **RideMiles Rewards** — Tier card (Silver / Gold / Platinum), progress to next tier, perks, redeemable rewards list (locked/unlocked)
8. **Profile** — Avatar, KYC status, mock KYC verification button, wallet balance + top-up CTA, menu (payments, coupons, SOS, support), Owner Dashboard mock (earnings/utilization/listings), Sign out

## Backend API
- `POST /api/auth/register` — Email + password + name → JWT
- `POST /api/auth/login` — JWT
- `POST /api/auth/google/session` — Exchange Emergent session_id → token + user
- `GET /api/auth/me` — Current user
- `POST /api/auth/logout`
- `POST /api/auth/kyc` — Mark KYC verified (mock)
- `GET /api/vehicles?type=&q=&sort=` — List, filter, sort
- `GET /api/vehicles/{id}` — Detail
- `POST /api/bookings` — Create booking, auto-award RideMiles (10/₹100)
- `GET /api/bookings` — My bookings
- `POST /api/bookings/{id}/start` — Start trip
- `POST /api/bookings/{id}/end` — End trip + award km-based miles
- `GET /api/notifications`, `POST /api/notifications/{id}/read`
- `POST /api/wallet/topup`
- `GET /api/owner/stats` — Mock owner dashboard

## Data Models (MongoDB)
- `users` — `user_id`, `email` (unique), `name`, `password_hash`, `avatar`, `role`, `kyc_status`, `wallet_balance`, `ride_miles`, `tier`
- `vehicles` — `vehicle_id`, `type` (car/bike), `name`, `brand`, `model`, `image`, `images`, `price_per_*`, `deposit`, `transmission`, `fuel_type`, `seats`, `rating`, `trips`, `distance_km`, `location`, lat/lng, `host_name`, `host_avatar`, `features`, `description`, `available`
- `bookings` — `booking_id`, `user_id`, `vehicle_id`, `vehicle_snapshot`, `plan`, dates, `total_amount`, `deposit`, `status`, inspection arrays, odometers, `add_ons`
- `notifications` — `notification_id`, `user_id`, `title`, `body`, `type`, `read`
- `user_sessions` — Emergent Google session storage (TTL via `expires_at`)

## Roles Roadmap (Future Phases)
- Vehicle Owner — Onboarding, listings, earnings, calendar, payouts
- Fleet Owner — Bulk listings, fleet analytics, drivers
- Showroom — Try Before Buy, lead tracking, conversion
- Service Center — Appointments, milestone services
- Admin — Users, vehicles, bookings, payments, disputes, partners, revenue dashboards
- AI Agents — Support, Operations, Finance, Marketing, Owner Success, Analytics — orchestrated by RIDEX Nexus

## Seeded Vehicles (6)
Tesla Model Y · Cadillac Escalade · Mahindra Thar · Royal Enfield Classic 350 · KTM Duke 390 · Hyundai Creta
