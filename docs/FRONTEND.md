# Frontend Guide

## Purpose

The frontend is an Expo React Native app for Android, iOS, and web preview. The app uses Expo Router.

Main app startup file: `frontend/app/_layout.tsx`

Search `RAIDEX_FRONTEND_ROOT_LAYOUT` to jump to startup and route guard code.

## Run Frontend

```powershell
cd frontend
npm install
copy .env.example .env
npx expo start
```

Android:

```powershell
npx expo start --android
```

Web:

```powershell
npx expo start --web
```

## Environment

Frontend `.env`:

```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
EXPO_PUBLIC_SENTRY_DSN=
```

Android emulator with local backend:

```env
EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8000
```

Physical phone with local backend:

```env
EXPO_PUBLIC_BACKEND_URL=http://192.168.x.x:8000
```

## Important Files

| Area | File |
| --- | --- |
| App startup and protected navigation | `frontend/app/_layout.tsx` |
| Login/register screen | `frontend/app/index.tsx` |
| Tabs | `frontend/app/(tabs)/` |
| Vehicle detail | `frontend/app/vehicle/[id].tsx` |
| Booking detail | `frontend/app/booking/[id].tsx` |
| Checkout | `frontend/app/checkout/[booking_id].tsx` |
| Payment | `frontend/app/pay/[payment_id].tsx` |
| Trip tracking | `frontend/app/trip/[booking_id].tsx` |
| KYC | `frontend/app/kyc/index.tsx` |
| Owner dashboard | `frontend/app/owner/index.tsx` |
| Admin dashboard | `frontend/app/admin/index.tsx` |
| API client | `frontend/src/api/client.ts` |
| Feature APIs | `frontend/src/features/*/api/` |
| Auth context | `frontend/src/context/AuthContext.tsx` |
| Offline utilities | `frontend/src/utils/offline.ts` |
| Sentry setup | `frontend/src/observability/sentry.ts` |

Search `RAIDEX_FRONTEND_API_CLIENT` for API calls, tokens, refresh flow, timeout handling, cache, and retry queue.

## Screens

| Screen | Path |
| --- | --- |
| Auth | `/` |
| Home/discovery | `/(tabs)` |
| Trips | `/(tabs)/trips` |
| Rewards | `/(tabs)/rewards` |
| Profile | `/(tabs)/profile` |
| Vehicle details | `/vehicle/[id]` |
| Booking | `/booking/[id]` |
| Checkout | `/checkout/[booking_id]` |
| Payment | `/pay/[payment_id]` |
| Trip | `/trip/[booking_id]` |
| Inspection | `/inspection/[booking_id]` |
| KYC | `/kyc` |
| Owner | `/owner` |
| Admin | `/admin` |
| Support | `/support` |
| Notifications | `/notifications` |

## Android Build

```powershell
cd frontend
npx expo-doctor
npx expo prebuild --platform android --clean
.\android\gradlew.bat -p android :app:assembleDebug
```

Preview EAS build:

```powershell
npx eas-cli build --platform android --profile preview
```

Production EAS build:

```powershell
npx eas-cli build --platform android --profile production
```

## Tests

```powershell
cd frontend
npm test
npm test -- vehicles
npm test -- bookings
npm test -- payments
npm test -- admin
```

## Feature Location Guide

| Feature | Folder |
| --- | --- |
| Admin APIs | `frontend/src/features/admin/` |
| Authentication | `frontend/src/features/authentication/` |
| Booking APIs | `frontend/src/features/booking/` |
| Maps types | `frontend/src/features/maps/` |
| Payments APIs | `frontend/src/features/payments/` |
| Reviews APIs | `frontend/src/features/reviews/` |
| Vehicles APIs | `frontend/src/features/vehicles/` |
| Wishlist APIs | `frontend/src/features/wishlist/` |

## Debug Checklist

- App opens but API fails: check `EXPO_PUBLIC_BACKEND_URL`.
- Login fails: check backend `/api/health`, `JWT_SECRET`, and database connection.
- Android emulator cannot reach backend: use `http://10.0.2.2:8000`.
- Physical phone cannot reach backend: use the computer LAN IP and same Wi-Fi.
- Build fails after package changes: run `npx expo-doctor`, then `npx expo prebuild --platform android --clean`.
