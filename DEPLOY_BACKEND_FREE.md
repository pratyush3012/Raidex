# 🚀 Deploy Backend FREE - 24/7 Running

## 🎯 Goal
Backend ko free cloud pe deploy karo taaki:
- ✅ 24/7 online rahe
- ✅ iPhone se access kar sako
- ✅ Android se access kar sako
- ✅ Laptop band bhi ho to chale

---

## 🆓 **BEST FREE OPTIONS**

### **Option 1: Render.com (RECOMMENDED)** ⭐
- ✅ Free tier forever
- ✅ Automatic deploys from GitHub
- ✅ 750 hours/month free (enough for testing)
- ✅ Sleeps after 15 min inactivity (but wakes up automatically)
- ✅ SQLite works
- ✅ HTTPS included

### **Option 2: Railway.app**
- ✅ $5 free credit monthly
- ✅ Better performance
- ✅ No sleep mode
- ⚠️ Needs credit card (not charged)

### **Option 3: Fly.io**
- ✅ Free tier
- ✅ Multiple regions
- ✅ Good for production
- ⚠️ Slightly complex setup

---

## 🚀 **DEPLOY ON RENDER (Easiest)**

### **Step 1: Prepare Code for Deployment**

I'll create the necessary files for you...

### **Step 2: Push to GitHub (Already Done!)**
Your code is already on GitHub: https://github.com/pratyush3012/Raidex

### **Step 3: Sign Up on Render**
1. Go to: https://render.com/
2. Click "Get Started"
3. Sign up with GitHub (easiest)
4. Authorize Render to access your repos

### **Step 4: Create Web Service**
1. Dashboard → Click "New +"
2. Select "Web Service"
3. Connect your repository: `Raidex`
4. Settings:
   - **Name:** raidex-backend
   - **Region:** Choose closest to India (Singapore)
   - **Branch:** main
   - **Root Directory:** backend
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python3 server_sqlite.py`
   - **Instance Type:** Free

### **Step 5: Add Environment Variables**
In Render dashboard → Environment:
```
ENV=production
JWT_SECRET=27af448ca424550e1e6a5b9a6b7ff0d0f07b3047c692b563a3c45d38715e654a
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_T4HI8ZpICYPosz
RAZORPAY_KEY_SECRET=zWvDdh0A2wsws7zXx1jxKak2
ALLOWED_ORIGINS=*
PORT=8000
```

### **Step 6: Deploy!**
Click "Create Web Service"

Wait 5-10 minutes for first deploy.

Your backend will be live at:
```
https://raidex-backend.onrender.com
```

---

## 📱 **UPDATE FRONTEND FOR DEPLOYED BACKEND**

### **Edit frontend/.env:**
```bash
# Replace localhost with your Render URL
EXPO_PUBLIC_BACKEND_URL=https://raidex-backend.onrender.com
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_T4HI8ZpICYPosz
```

### **Restart Frontend:**
```bash
cd frontend
npm start -- --clear
```

---

## 📱 **BUILD APK/IPA FOR TESTING**

### **For Android APK (Testing):**

**Step 1: Install EAS CLI**
```bash
npm install -g eas-cli
```

**Step 2: Login to Expo**
```bash
eas login
```
(Create free Expo account if needed)

**Step 3: Configure Project**
```bash
cd frontend
eas build:configure
```

**Step 4: Build APK**
```bash
eas build --platform android --profile preview
```

This creates a download link for APK. Install on any Android phone!

### **For iOS (Testing via TestFlight):**

**Step 1: Build for iOS**
```bash
eas build --platform ios --profile preview
```

**Step 2: Submit to TestFlight**
```bash
eas submit --platform ios
```

You'll need Apple Developer account ($99/year) for iOS.

**Alternative for iOS Testing:**
Use Expo Go app (free, no build needed!)

---

## 🎯 **COMPLETE DEPLOYMENT FLOW**

### **Backend Deployment:**
```
GitHub (your code)
    ↓
Render.com (free hosting)
    ↓
https://raidex-backend.onrender.com (live 24/7)
```

### **Mobile App:**
```
Option A: Expo Go App (Quickest)
- Install Expo Go
- Scan QR code
- Works on both iOS & Android

Option B: Standalone APK (Android)
- Build with EAS
- Download APK
- Install on phone
- Works without Expo Go

Option C: TestFlight (iOS)
- Build with EAS
- Submit to TestFlight
- Install via TestFlight
- Works without Expo Go
```

---

## ⚡ **FASTEST SETUP (Both Phones)**

### **1. Deploy Backend to Render (10 min)**
Follow Render steps above → Backend live at URL

### **2. Update Frontend .env**
```bash
EXPO_PUBLIC_BACKEND_URL=https://your-app.onrender.com
```

### **3. Test with Expo Go (Instant)**
```bash
cd frontend
npm start
```

**On iPhone:**
- Install Expo Go from App Store
- Open Camera app
- Scan QR code
- App opens in Expo Go ✅

**On Android:**
- Install Expo Go from Play Store
- Open Expo Go app
- Scan QR code
- App opens ✅

**Done! Both phones can use the app!** 🎉

---

## 📋 **RENDER DEPLOYMENT CHECKLIST**

- [ ] Sign up on Render.com
- [ ] Connect GitHub repository
- [ ] Create Web Service
- [ ] Set environment variables
- [ ] Wait for deployment (5-10 min)
- [ ] Test: Open https://your-app.onrender.com/api/health
- [ ] Update frontend .env with new URL
- [ ] Test on iPhone with Expo Go
- [ ] Test on Android with Expo Go

---

## 🆓 **FREE TIER LIMITS**

### **Render.com Free Plan:**
- ✅ 750 hours/month (enough for 24/7!)
- ✅ Automatic HTTPS
- ✅ Auto-deploy from GitHub
- ⚠️ Sleeps after 15 min inactivity (wakes in 30 sec on first request)
- ⚠️ 512MB RAM (enough for SQLite)

### **How to Keep Backend Always Awake:**
Use a cron job to ping every 10 minutes:

**Create on cron-job.org (free):**
1. Sign up at https://cron-job.org/
2. Create job: `https://your-app.onrender.com/api/health`
3. Schedule: Every 10 minutes
4. Done! Backend stays awake 24/7 ✅

---

## 🔧 **TROUBLESHOOTING**

### **"Build failed on Render"**
Check these files exist in backend/:
- requirements.txt
- server_sqlite.py
- .env (don't need, use Render env vars)

### **"Cannot connect from phone"**
- Check backend URL is HTTPS (not HTTP)
- Check CORS allows all origins (ALLOWED_ORIGINS=*)
- Test in browser: https://your-app.onrender.com/api/health

### **"App crashes on open"**
- Check frontend/.env has correct EXPO_PUBLIC_BACKEND_URL
- Restart frontend: `npm start -- --clear`
- Check backend logs in Render dashboard

---

## 💰 **COST BREAKDOWN**

| Service | Cost | What You Get |
|---------|------|--------------|
| Render Backend | FREE | 750 hrs/month, 512MB RAM |
| SQLite Database | FREE | Unlimited (file-based) |
| Expo Go App | FREE | Test on both phones |
| GitHub | FREE | Code hosting |
| **TOTAL** | **₹0** | **Full working app!** |

### **Optional (Not Needed for Testing):**
| Service | Cost | When Needed |
|---------|------|-------------|
| Standalone Android APK | FREE | Share with others |
| iOS TestFlight | $99/year | iOS distribution |
| Custom Domain | ~$10/year | Production |
| MongoDB Atlas | FREE | If you prefer MongoDB |

---

## 🎉 **EXPECTED RESULT**

After setup:
- ✅ Backend running 24/7 at https://raidex-backend.onrender.com
- ✅ Can test on iPhone (Expo Go)
- ✅ Can test on Android (Expo Go)
- ✅ Razorpay payments work
- ✅ Data persists (SQLite database)
- ✅ Laptop can be turned off - app still works!
- ✅ Share with friends - they can test too!

---

## 📱 **SHARING WITH TESTERS**

### **Via Expo Go (Easiest):**
```bash
cd frontend
npm start
```

Share the QR code or Expo link with anyone:
```
exp://u.expo.dev/your-project-id
```

They install Expo Go → Scan → Test!

### **Via APK (Android Only):**
After building APK on EAS:
- Download APK file
- Share via WhatsApp/Email
- They install directly
- No Expo Go needed!

---

## 🚀 **NEXT STEPS AFTER DEPLOYMENT**

1. **Test Everything:**
   - [ ] User registration
   - [ ] Login
   - [ ] Vehicle browsing
   - [ ] Booking creation
   - [ ] Razorpay payment (test card)
   - [ ] Profile updates

2. **Monitor:**
   - Check Render dashboard for logs
   - Monitor API requests
   - Check database size

3. **Improve:**
   - Add more vehicles
   - Test edge cases
   - Fix bugs
   - Add features

4. **Production Ready:**
   - Switch to PostgreSQL/MongoDB
   - Use live Razorpay keys
   - Custom domain
   - Remove test data

---

## 🎓 **LEARNING PATH**

**Phase 1 (Now):** Deploy with SQLite
- ✅ Quick setup
- ✅ Test all features
- ✅ Learn deployment process

**Phase 2 (Later):** Upgrade Database
- Migrate to PostgreSQL (Supabase)
- Better for scaling
- Production-ready

**Phase 3 (Before Launch):** Polish
- Custom domain
- Live payments
- App store submission
- Marketing

---

## 📞 **SUPPORT RESOURCES**

- **Render Docs:** https://render.com/docs
- **EAS Build Docs:** https://docs.expo.dev/build/introduction/
- **Expo Go:** https://expo.dev/client
- **Your Backend GitHub:** https://github.com/pratyush3012/Raidex

---

## ✅ **SUMMARY**

**Goal:** Backend 24/7 online + Test on both phones

**Solution:**
1. Deploy backend to Render (free, 24/7)
2. Use Expo Go on both phones (free, instant)
3. Test everything without laptop running

**Time:** 15-20 minutes total
**Cost:** ₹0 (completely free!)

**Result:** Professional testing setup! 🎉

---

Want me to create the deployment files for Render?
