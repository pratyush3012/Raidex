# 🚗 Raidex - Vehicle Rental App

Complete vehicle rental platform with payments, bookings, and real-time tracking.

---

## 🎯 Current Status

✅ **Backend:** Ready (SQLite + Razorpay configured)  
✅ **Frontend:** Ready (React Native + Expo)  
✅ **Payments:** Razorpay Test Mode configured  
✅ **Database:** SQLite (MongoDB alternative for quick testing)  

---

## 🚀 Quick Start (Local Testing)

### 1. Backend
```bash
cd backend
python3 server_sqlite.py
```

### 2. Frontend (new terminal)
```bash
cd frontend
npm start
```

### 3. Phone
- Install Expo Go app
- Scan QR code
- Test the app!

---

## ☁️ Deploy Backend 24/7 (FREE - Render.com)

### Step 1: Push to GitHub (Already Done!)
```bash
git push origin main
```

### Step 2: Sign Up on Render
1. Open: https://render.com/
2. Click "Get Started" 
3. Sign up with GitHub
4. Authorize Render

### Step 3: Create Web Service
1. Click "New +" → "Web Service"
2. Connect repository: "Raidex"
3. Configure:
   - **Name:** `raidex-backend`
   - **Region:** `Singapore`
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements-deploy.txt`
   - **Start Command:** `python3 server_sqlite.py`
   - **Instance Type:** `Free`

### Step 4: Environment Variables
Add these in Render dashboard:
```
ENV=production
JWT_SECRET=27af448ca424550e1e6a5b9a6b7ff0d0f07b3047c692b563a3c45d38715e654a
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_T4HI8ZpICYPosz
RAZORPAY_KEY_SECRET=zWvDdh0A2wsws7zXx1jxKak2
ALLOWED_ORIGINS=*
PORT=10000
```

### Step 5: Deploy
- Click "Create Web Service"
- Wait 5-10 minutes
- Your backend is live at: `https://raidex-backend-xxxx.onrender.com`

### Step 6: Update Frontend
Edit `frontend/.env`:
```bash
EXPO_PUBLIC_BACKEND_URL=https://raidex-backend-xxxx.onrender.com
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_T4HI8ZpICYPosz
```

Restart frontend:
```bash
cd frontend
npm start -- --clear
```

### ✅ Done! Backend is 24/7 online!

---

## 📱 Testing

### Test Cards (Razorpay)
- **Success:** 4111 1111 1111 1111
- **CVV:** 123
- **Expiry:** Any future date

### Test Flow
1. Register new user
2. Browse vehicles
3. Create booking
4. Complete payment
5. View booking status

---

## 🔧 Tech Stack

- **Backend:** Python + FastAPI + SQLite
- **Frontend:** React Native + Expo
- **Payments:** Razorpay
- **Hosting:** Render.com (Free)
- **Database:** SQLite (portable, no external service)

---

## 💰 Cost

Everything is FREE:
- Render.com: Free tier (750 hrs/month)
- SQLite: Free (file-based)
- Expo Go: Free
- GitHub: Free

---

## 🐛 Troubleshooting

**Backend not starting?**
```bash
cd backend
pip install fastapi uvicorn python-dotenv pydantic pyjwt bcrypt passlib slowapi
python3 server_sqlite.py
```

**Frontend can't connect?**
- Check `frontend/.env` has correct backend URL
- Restart: `npm start -- --clear`

**Render deployment failed?**
- Check logs in Render dashboard
- Verify `requirements-deploy.txt` exists
- Redeploy manually

---

## 📞 Links

- **GitHub:** https://github.com/pratyush3012/Raidex
- **Render:** https://render.com/
- **Razorpay Docs:** https://razorpay.com/docs/

---

**Last Updated:** June 2026
