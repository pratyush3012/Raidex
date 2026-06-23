# Raidex — Device Testing & Production Setup Guide

Install Raidex on your own Android and iPhone **without** publishing to the Play Store or App Store, then complete MongoDB, Razorpay, and push setup for a production-ready launch.

---

## Part 1: Install on Your Devices (No Store Required)

### Why not Expo Go?

Expo Go is fine for quick UI checks, but **cannot fully test**:

- Background GPS during trips
- Push notifications (reliably)
- Camera/KYC on all devices

**Use an EAS Preview build** — a real `.apk` (Android) or installable iOS build you sideload or install via QR code.

---

### Prerequisites

| Item | Android | iPhone |
|------|---------|--------|
| Free account | [expo.dev](https://expo.dev) | Same |
| Paid account | Not required for APK sideload | **Apple Developer $99/yr** required for device installs lasting >7 days |
| CLI | `npm install -g eas-cli` | Same |

---

### Step 1 — One-time EAS setup

```bash
cd frontend
npm install
eas login
eas init          # links project; writes real projectId into app.json
```

After `eas init`, verify `app.json` → `extra.eas.projectId` is no longer `REPLACE_AFTER_eas_init`.

---

### Step 2 — Point the app at your backend

Create `frontend/.env`:

```bash
EXPO_PUBLIC_BACKEND_URL=https://YOUR-BACKEND-URL
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx   # when using Razorpay test mode
```

For EAS cloud builds, also set secrets:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_BACKEND_URL --value https://YOUR-BACKEND-URL
eas secret:create --scope project --name EXPO_PUBLIC_RAZORPAY_KEY_ID --value rzp_test_xxxx
```

---

### Step 3 — Build for your devices

#### Android (easiest — no paid account needed)

```bash
cd frontend
yarn build:android
# or: eas build --platform android --profile preview
```

When the build finishes (~10–20 min):

1. Open the link EAS prints (or go to [expo.dev](https://expo.dev) → your project → Builds)
2. Download the **APK**
3. Transfer to your Android phone (USB, email, or scan QR on the build page)
4. Enable **Install unknown apps** for your browser/files app
5. Tap the APK to install

#### iPhone (requires Apple Developer Program)

```bash
cd frontend
yarn build:ios
# or: eas build --platform ios --profile preview
```

1. EAS will ask you to sign in with your Apple Developer account
2. Register your device UDID when prompted (or run `eas device:create`)
3. When the build completes, scan the **QR code** on your iPhone to install
4. If iOS blocks the app: **Settings → General → VPN & Device Management → Trust**

**Alternative for iOS without paying $99:** Use the **iOS Simulator** on a Mac (`eas build --platform ios --profile preview` won't help on simulator with internal distribution — use `npx expo run:ios` locally with Xcode instead). Physical iPhone installs beyond 7 days require the paid developer account.

---

### Step 4 — Test every feature on device

| Feature | How to test |
|---------|-------------|
| Auth | Register / login / Google sign-in |
| KYC | Profile → KYC → upload photos from camera |
| Booking | Pick vehicle → dates → checkout |
| Payment | Mock (default) or Razorpay test cards |
| Trip GPS | Start trip → grant location → watch live map |
| Inspection | Before/after photos + odometer |
| Push | Login → complete payment → notification should appear |
| Owner | Profile → Owner dashboard |
| Admin | Login as admin → Admin console |

---

## Part 2: Complete Backend Setup

### A. MongoDB Atlas (free tier works for testing)

1. Create account at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a **free M0 cluster**
3. Database Access → Add user (username + password)
4. Network Access → **Add IP Address** → `0.0.0.0/0` (testing) or your server IP (production)
5. Connect → Drivers → copy connection string:

```
mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

6. Create `backend/.env`:

```bash
MONGO_URL=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=raidex
ENV=production
JWT_SECRET=<run: python3 -c "import secrets; print(secrets.token_hex(32))">
ALLOWED_ORIGINS=https://your-web-app.com,http://localhost:8081
ADMIN_EMAIL=admin@raidex.io
ADMIN_PASSWORD=<strong-password>
PAYMENT_PROVIDER=mock          # switch to razorpay when ready
PUSH_PROVIDER=expo
EMERGENT_LLM_KEY=<your-key>    # optional; for AI support chat
```

7. Start locally to verify:

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

8. Check: `curl http://localhost:8000/api/health` → `{"status":"ok","database":"connected"}`

---

### B. Deploy backend to the internet

Your phones cannot reach `localhost`. Pick one host:

| Provider | Difficulty | Notes |
|----------|------------|-------|
| [Render.com](https://render.com) | Easy | Free tier; add env vars in dashboard |
| [Railway.app](https://railway.app) | Easy | Good for FastAPI |
| [Fly.io](https://fly.io) | Medium | Global edge |
| VPS (DigitalOcean, etc.) | Medium | Run uvicorn + nginx |

**Start command:**

```bash
uvicorn server:app --host 0.0.0.0 --port $PORT
```

Set all `backend/.env` variables in the host's environment/secrets panel.

**After deploy:** use your public URL as `EXPO_PUBLIC_BACKEND_URL` (e.g. `https://raidex-api.onrender.com`).

---

### C. Razorpay (test mode first)

1. Sign up at [dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Stay in **Test Mode** (toggle top-left)
3. Settings → API Keys → Generate → copy Key ID + Secret
4. Update `backend/.env`:

```bash
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=xxxx
```

5. Update `frontend/.env`:

```bash
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxx
```

6. **Rebuild the app** (env vars are baked in at build time):

```bash
eas build --platform android --profile preview
```

7. Test payment with Razorpay test card: `4111 1111 1111 1111`, any future expiry, any CVV

8. **Webhook (recommended before live):**

   - Razorpay Dashboard → Webhooks → Add
   - URL: `https://YOUR-API/api/webhooks/razorpay`
   - Event: `payment.captured`
   - Copy webhook secret → `RAZORPAY_WEBHOOK_SECRET` in backend `.env`

---

### D. Push notifications

1. After `eas init`, go to [expo.dev](https://expo.dev) → Project → Credentials
2. **iOS:** Upload APNs Auth Key (.p8 from Apple Developer → Keys)
3. **Android:** Expo configures FCM automatically during EAS build
4. Backend:

```bash
PUSH_PROVIDER=expo
```

5. Rebuild app, login on device, check MongoDB `push_tokens` collection for your token
6. Complete a booking payment → you should receive a push

---

## Part 3: Production Readiness Checklist

Use this before Play Store / App Store submission.

### Infrastructure

- [ ] MongoDB Atlas M10+ with backups enabled
- [ ] Backend on HTTPS with `ENV=production`
- [ ] Strong `JWT_SECRET` set
- [ ] `ALLOWED_ORIGINS` lists only your domains
- [ ] `/api/health` returns `ok` from monitoring
- [ ] Admin password set via env (not random from logs)

### Payments

- [ ] `PAYMENT_PROVIDER=razorpay` with **live** keys
- [ ] Razorpay merchant KYC completed
- [ ] Webhook registered and `RAZORPAY_WEBHOOK_SECRET` set
- [ ] End-to-end test: book → pay → confirmed → refund

### Mobile app

- [ ] `eas init` completed, real `projectId` in `app.json`
- [ ] `EXPO_PUBLIC_BACKEND_URL` points to production API
- [ ] Production build: `eas build --platform all --profile production`
- [ ] Privacy policy URL published (required by both stores)
- [ ] Background location justification written for store forms

### Identity (before scaling users)

- [ ] Switch `KYC_PROVIDER=karza` or `idfy` with production API keys
- [ ] Or keep stub + manual admin review for beta only

### Store accounts

- [ ] Google Play Console ($25 one-time)
- [ ] Apple Developer Program ($99/year)
- [ ] Submit: `eas submit --platform android` / `eas submit --platform ios`

---

## Quick Reference Commands

```bash
# Backend local
cd backend && source venv/bin/activate && uvicorn server:app --reload

# Frontend local (web only — limited features)
cd frontend && yarn start

# Android test APK (no store)
cd frontend && eas build -p android --profile preview

# iPhone test build (needs Apple Developer)
cd frontend && eas build -p ios --profile preview

# Production store build
cd frontend && eas build -p all --profile production
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App can't reach API | Check `EXPO_PUBLIC_BACKEND_URL`; rebuild app after changing |
| CORS error on web | Add your web URL to backend `ALLOWED_ORIGINS` |
| Razorpay doesn't open | Verify `EXPO_PUBLIC_RAZORPAY_KEY_ID` matches backend test key |
| Payment succeeds but booking not confirmed | Check webhook + confirm endpoint logs |
| No push notifications | Set `PUSH_PROVIDER=expo`, upload APNs key, rebuild with real `projectId` |
| iOS install blocked | Trust developer cert in Settings |
| Android "App not installed" | Uninstall old version; ensure APK matches architecture |

---

## Recommended Timeline

| Week | Goal |
|------|------|
| 1 | MongoDB + backend deployed; Android preview APK on your phone |
| 2 | Razorpay test payments working; iOS preview on iPhone |
| 3 | Push notifications; full feature test pass |
| 4 | Privacy policy; production builds; store submission |

You do **not** need the Play Store or App Store to fully test the app. Use **EAS preview builds** until everything works, then submit to stores when ready.
