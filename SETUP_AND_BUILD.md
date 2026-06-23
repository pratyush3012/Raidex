# Raidex — Complete Setup & Build Guide

## STEP 1: Create a free MongoDB Atlas database (~5 min)

1. Go to https://cloud.mongodb.com → Sign up / Log in (it's free)

2. Click **Build a Database** → Choose **M0 FREE** tier → Region: **AWS / Singapore** → Create

3. On "Security Quickstart":
   - Create a database user:
     - Username: `raidex`
     - Password: click **Autogenerate** → copy and save it
   - Click **Create User**
   - Under "Where would you like to connect from?" → choose **My Local Environment**
   - In the IP Address field type `0.0.0.0/0` → click **Add Entry** (allows Render to connect)
   - Click **Finish and Close**

4. Click **Connect** on your cluster → **Drivers** → Driver: Python, Version: 3.12+
   - Copy the connection string. It looks like:
     ```
     mongodb+srv://raidex:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
     ```
   - Replace `<password>` with the password you saved above

---

## STEP 2: Deploy backend to Render (~5 min)

1. Go to https://github.com → Create a new repo called `raidex-backend` (public)

2. Open **Command Prompt** in `C:\Users\Pratyush\Desktop\Raidex-main\backend` and run:
   ```
   git init
   git add .
   git commit -m "Initial backend"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/raidex-backend.git
   git push -u origin main
   ```

3. Go to https://render.com → Log in → **New** → **Web Service**
   - Connect GitHub → select `raidex-backend`
   - Render auto-detects `render.yaml` — click **Apply**

4. Before clicking Deploy, set the secret environment variables:
   - In the Render dashboard for your service → **Environment** tab
   - Add: `MONGO_URL` = your Atlas connection string from Step 1
   - The other vars (`JWT_SECRET`, `ENV`, etc.) are already in `render.yaml`

5. Click **Deploy** — wait ~3 minutes. Your backend URL will be:
   ```
   https://raidex-backend.onrender.com
   ```
   Test it: open `https://raidex-backend.onrender.com/api/health` in your browser — you should see `{"status":"ok","database":"connected"}`

6. Open `C:\Users\Pratyush\Desktop\Raidex-main\frontend\.env` and update:
   ```
   EXPO_PUBLIC_BACKEND_URL=https://raidex-backend.onrender.com
   ```

---

## STEP 3: EAS Login & Init (~2 min)

Open **Command Prompt** in `C:\Users\Pratyush\Desktop\Raidex-main\frontend` and run:

```
npx eas login
```
→ Browser opens → Log in with your Expo account (pratyush3012)

Then:
```
npx eas init
```
→ When asked "Would you like to create a new EAS project?", say **Yes**
→ This fills in the `projectId` in `app.json` automatically

---

## STEP 4: Build Android APK (~10 min, cloud build)

```
npx eas build --platform android --profile preview
```

- Builds on Expo's servers (your machine doesn't need Android Studio)
- When done, you get a download link for the `.apk`
- **Install on Android**: Transfer the `.apk` to your phone → tap to install
  (You may need to enable "Install from unknown sources" in Settings → Security)

---

## STEP 5: Build iOS IPA (~15 min, cloud build)

You need an **Apple Developer account** ($99/year) for real device install without App Store.

**With Apple Developer account (TestFlight):**
```
npx eas build --platform ios --profile preview
npx eas submit --platform ios
```
- Installs TestFlight on your iPhone → install app from there

**Without Apple Developer account:**
- You cannot install on a real iPhone without one (Apple restriction)
- Alternative: test on iOS Simulator on a Mac, or use an Android device for now

---

## STEP 6: Test the app

1. Open the installed app on your phone
2. Register with any email + password
3. Browse 6 seeded vehicles on the Explore tab
4. All users are KYC auto-verified in stub mode
5. Payments use mock gateway (no real charges)

---

## Notes on free tier limits

| Service | Limit | Impact |
|---|---|---|
| Render free | Spins down after 15 min idle | First request ~30s cold start |
| MongoDB Atlas M0 | 512 MB storage, shared CPU | Fine for testing |
| EAS Build free | 30 builds/month | Plenty for testing |

---

## Troubleshooting

**"Network request failed" in app** → Your Render service is cold-starting, wait 30 sec and retry

**"database unreachable" in /health** → Check MONGO_URL in Render Environment tab — make sure password has no special chars that need URL-encoding

**Build fails on EAS** → Run `npx eas build:inspect` to see detailed logs
