#!/usr/bin/env python3
"""
Raidex Backend - SQLite Version (No MongoDB Required!)
Quick alternative for development/testing without external database.
"""

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import os
import sqlite3
import uuid
import json
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt as pyjwt
from contextlib import contextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from providers import (
    get_payment_gateway, get_kyc_provider, get_damage_inspector, get_push_sender,
)
from providers.kyc_provider import KYCSubmission
from providers.push_sender import PushPayload

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# SQLite Database
DB_PATH = ROOT_DIR / "raidex.db"

# JWT Settings
JWT_SECRET = os.getenv("JWT_SECRET", "ridex-super-secret-key-change-in-prod")
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Raidex API - SQLite")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS[0] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")


# ============================================================
# Database Helper
# ============================================================
@contextmanager
def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize SQLite database with schema"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT,
                avatar TEXT,
                phone TEXT,
                role TEXT DEFAULT 'customer',
                kyc_status TEXT DEFAULT 'pending',
                wallet_balance REAL DEFAULT 500.0,
                ride_miles INTEGER DEFAULT 250,
                tier TEXT DEFAULT 'Silver',
                created_at TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS phone_otp_challenges (
                challenge_id TEXT PRIMARY KEY,
                phone TEXT NOT NULL,
                otp TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                used INTEGER DEFAULT 0,
                created_at TEXT,
                expires_at TEXT
            )
        """)
        
        # Vehicles table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vehicles (
                vehicle_id TEXT PRIMARY KEY,
                owner_id TEXT,
                type TEXT,
                name TEXT,
                brand TEXT,
                model TEXT,
                image TEXT,
                price_per_hour REAL,
                price_per_day REAL,
                price_per_week REAL,
                price_per_month REAL,
                deposit REAL,
                transmission TEXT,
                fuel_type TEXT,
                seats INTEGER,
                rating REAL DEFAULT 4.5,
                trips INTEGER DEFAULT 0,
                distance_km REAL,
                location TEXT,
                latitude REAL,
                longitude REAL,
                host_name TEXT,
                host_avatar TEXT,
                available INTEGER DEFAULT 1,
                description TEXT,
                features TEXT,
                images TEXT
            )
        """)
        
        # Bookings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                booking_id TEXT PRIMARY KEY,
                user_id TEXT,
                vehicle_id TEXT,
                vehicle_snapshot TEXT,
                plan TEXT,
                start_date TEXT,
                end_date TEXT,
                total_amount REAL,
                deposit REAL,
                status TEXT DEFAULT 'pending_payment',
                payment_id TEXT,
                created_at TEXT
            )
        """)
        
        # Payments table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                payment_id TEXT PRIMARY KEY,
                user_id TEXT,
                booking_id TEXT,
                purpose TEXT DEFAULT 'booking',
                amount REAL,
                currency TEXT DEFAULT 'INR',
                provider TEXT,
                provider_order_id TEXT,
                provider_payment_id TEXT,
                provider_signature TEXT,
                status TEXT DEFAULT 'created',
                failure_reason TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # Notifications table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id TEXT PRIMARY KEY,
                user_id TEXT,
                title TEXT,
                body TEXT,
                type TEXT,
                read INTEGER DEFAULT 0,
                created_at TEXT
            )
        """)

        # Inspections table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS inspections (
                inspection_id TEXT PRIMARY KEY,
                booking_id TEXT,
                vehicle_id TEXT,
                phase TEXT,
                photo_front TEXT,
                photo_back TEXT,
                photo_left TEXT,
                photo_right TEXT,
                photo_dashboard TEXT,
                photo_odometer TEXT,
                video_url TEXT,
                odometer_value REAL,
                fuel_level TEXT,
                notes TEXT,
                ai_score REAL,
                ai_findings TEXT,
                submitted_at TEXT
            )
        """)

        # KYC submissions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS kyc_submissions (
                kyc_id TEXT PRIMARY KEY,
                user_id TEXT,
                status TEXT,
                rejection_reason TEXT,
                submitted_at TEXT,
                verified_at TEXT
            )
        """)
        
        print("[OK] SQLite database initialized at:", DB_PATH)


# ============================================================
# Helper Functions
# ============================================================
def utc_now():
    return datetime.now(timezone.utc).isoformat()


def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": email,
        "uid": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth header")
    
    token = authorization.split(" ", 1)[1].strip()
    
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("uid")
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (uid,))
            user = cursor.fetchone()
            
            if user:
                return dict(user)
    except pyjwt.PyJWTError:
        pass
    
    raise HTTPException(status_code=401, detail="Invalid credentials")


# ============================================================
# Models
# ============================================================
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class PhoneOtpRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=16)


class PhoneOtpVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=8, max_length=80)
    phone: str = Field(min_length=10, max_length=16)
    otp: str = Field(min_length=4, max_length=8)
    name: Optional[str] = Field(default=None, max_length=80)


class TokenResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class GoogleSessionRequest(BaseModel):
    session_id: str


class BookingCreate(BaseModel):
    vehicle_id: str
    plan: Literal["hourly", "daily", "weekly", "monthly"]
    start_date: str
    end_date: str
    add_ons: List[str] = []


class PaymentCreateRequest(BaseModel):
    booking_id: Optional[str] = None
    amount: float
    purpose: Literal["booking", "deposit", "wallet_topup"] = "booking"


class PaymentConfirmRequest(BaseModel):
    force_outcome: Optional[Literal["success", "failure"]] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


class InspectionSubmit(BaseModel):
    booking_id: str
    phase: Literal["before", "after"]
    photo_front: str = ""
    photo_back: str = ""
    photo_left: str = ""
    photo_right: str = ""
    photo_dashboard: str = ""
    photo_odometer: str = ""
    video_url: str = ""
    odometer_value: float
    fuel_level: Literal["empty", "quarter", "half", "threequarter", "full"] = "half"
    notes: str = ""


class KYCSubmitRequest(BaseModel):
    aadhaar_front: str = ""
    aadhaar_back: str = ""
    aadhaar_last4: str = ""
    dl_front: str = ""
    dl_back: str = ""
    dl_number: str = ""
    dl_expiry: str = ""
    face_selfie: str = ""


def serialize_user(row: dict) -> dict:
    u = dict(row)
    u.pop("password_hash", None)
    return u


def normalize_phone(phone: str) -> str:
    cleaned = "".join(ch for ch in phone.strip() if ch.isdigit() or ch == "+")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if len(cleaned) == 10 and cleaned[0] in "6789":
        cleaned = "+91" + cleaned
    if not cleaned.startswith("+") or len(cleaned) < 11:
        raise HTTPException(status_code=422, detail="Enter a valid phone number with country code")
    return cleaned


def parse_vehicle(row: dict) -> dict:
    v = dict(row)
    if v.get("features"):
        try:
            v["features"] = json.loads(v["features"])
        except Exception:
            pass
    if v.get("images"):
        try:
            v["images"] = json.loads(v["images"])
        except Exception:
            pass
    return v


def parse_booking(row: dict) -> dict:
    b = dict(row)
    if b.get("vehicle_snapshot"):
        try:
            b["vehicle_snapshot"] = json.loads(b["vehicle_snapshot"])
        except Exception:
            pass
    if b.get("add_ons"):
        try:
            b["add_ons"] = json.loads(b["add_ons"])
        except Exception:
            pass
    return b


def append_miles(user_id: str, miles: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT ride_miles, tier FROM users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return
        new_miles = int(row["ride_miles"] or 0) + miles
        tier = "Silver"
        if new_miles >= 5000:
            tier = "Platinum"
        elif new_miles >= 1000:
            tier = "Gold"
        cursor.execute(
            "UPDATE users SET ride_miles = ?, tier = ? WHERE user_id = ?",
            (new_miles, tier, user_id),
        )


def insert_notification(user_id: str, title: str, body: str, ntype: str = "info"):
    nid = "ntf_" + uuid.uuid4().hex[:10]
    with get_db() as conn:
        conn.cursor().execute(
            "INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)",
            (nid, user_id, title, body, ntype, 0, utc_now()),
        )


SEED_VEHICLES = [
    {
        "type": "car", "name": "Tesla Model Y", "brand": "Tesla", "model": "Model Y",
        "image": "https://images.unsplash.com/photo-1777329385816-4220415c266d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHxUZXNsYSUyMGNhciUyMG1vZGVybiUyMGNpdHl8ZW58MHx8fHwxNzgxOTcxNjAxfDA&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 450, "price_per_day": 4500, "price_per_week": 27000, "price_per_month": 95000,
        "deposit": 10000, "transmission": "Auto", "fuel_type": "EV", "seats": 5, "rating": 4.9, "trips": 142,
        "distance_km": 1.2, "location": "Bandra West, Mumbai", "latitude": 19.0596, "longitude": 72.8295,
        "host_name": "Aarav Mehta", "host_avatar": "",
        "features": ["Autopilot", "Premium Audio"], "description": "Electric SUV with cutting-edge tech.",
    },
    {
        "type": "car", "name": "Cadillac Escalade", "brand": "Cadillac", "model": "Escalade Premium",
        "image": "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 800, "price_per_day": 7500, "price_per_week": 45000, "price_per_month": 160000,
        "deposit": 20000, "transmission": "Auto", "fuel_type": "Petrol", "seats": 7, "rating": 4.8, "trips": 89,
        "distance_km": 2.4, "location": "Juhu, Mumbai", "latitude": 19.1075, "longitude": 72.8263,
        "host_name": "Priya Shah", "host_avatar": "",
        "features": ["Massage Seats", "Sunroof"], "description": "Ultimate luxury SUV.",
    },
    {
        "type": "car", "name": "Mahindra Thar", "brand": "Mahindra", "model": "Thar LX 4WD",
        "image": "https://images.pexels.com/photos/16510639/pexels-photo-16510639.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 250, "price_per_day": 2800, "price_per_week": 17000, "price_per_month": 58000,
        "deposit": 5000, "transmission": "Manual", "fuel_type": "Diesel", "seats": 4, "rating": 4.7, "trips": 211,
        "distance_km": 0.8, "location": "Andheri East, Mumbai", "latitude": 19.1136, "longitude": 72.8697,
        "host_name": "Rohan Iyer", "host_avatar": "",
        "features": ["4x4", "Off-road"], "description": "Built for adventure.",
    },
    {
        "type": "bike", "name": "Royal Enfield Classic 350", "brand": "Royal Enfield", "model": "Classic 350",
        "image": "https://images.pexels.com/photos/15836900/pexels-photo-15836900.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 80, "price_per_day": 900, "price_per_week": 5400, "price_per_month": 18000,
        "deposit": 2000, "transmission": "Manual", "fuel_type": "Petrol", "seats": 2, "rating": 4.6, "trips": 312,
        "distance_km": 0.5, "location": "Powai, Mumbai", "latitude": 19.1176, "longitude": 72.9060,
        "host_name": "Vikram Singh", "host_avatar": "",
        "features": ["Classic Styling"], "description": "Iconic city cruiser.",
    },
    {
        "type": "bike", "name": "KTM Duke 390", "brand": "KTM", "model": "Duke 390",
        "image": "https://images.pexels.com/photos/15836900/pexels-photo-15836900.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 120, "price_per_day": 1400, "price_per_week": 8400, "price_per_month": 28000,
        "deposit": 3000, "transmission": "Manual", "fuel_type": "Petrol", "seats": 2, "rating": 4.8, "trips": 178,
        "distance_km": 1.8, "location": "Lower Parel, Mumbai", "latitude": 18.9978, "longitude": 72.8266,
        "host_name": "Kabir Joshi", "host_avatar": "",
        "features": ["Quickshifter"], "description": "Naked street fighter.",
    },
    {
        "type": "car", "name": "Hyundai Creta", "brand": "Hyundai", "model": "Creta SX(O)",
        "image": "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 200, "price_per_day": 2200, "price_per_week": 13000, "price_per_month": 45000,
        "deposit": 4000, "transmission": "Auto", "fuel_type": "Petrol", "seats": 5, "rating": 4.5, "trips": 256,
        "distance_km": 3.1, "location": "Powai, Mumbai", "latitude": 19.1176, "longitude": 72.9060,
        "host_name": "Aisha Khan", "host_avatar": "",
        "features": ["Sunroof"], "description": "Premium compact SUV.",
    },
]


# ============================================================
# Routes
# ============================================================
@api_router.get("/")
async def root():
    return {"message": "Raidex API - SQLite", "version": "1.0.0", "database": "SQLite"}


@api_router.get("/health")
async def health():
    """Health check"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            db_ok = True
    except Exception:
        db_ok = False
    
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "unreachable"
    }


@api_router.get("/config")
async def public_config():
    """Public config"""
    payment_provider = os.getenv("PAYMENT_PROVIDER", "mock").lower()
    key_id = os.getenv("RAZORPAY_KEY_ID", "")
    return {
        "payment_provider": payment_provider,
        "razorpay_key_id": key_id if payment_provider == "razorpay" else None,
        "database": "SQLite"
    }


@api_router.post("/auth/register", response_model=TokenResp)
@limiter.limit("10/minute")
async def register(request: Request, payload: RegisterRequest):
    email = payload.email.lower()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if exists
        cursor.execute("SELECT user_id FROM users WHERE email = ?", (email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create user
        user_id = "usr_" + uuid.uuid4().hex[:12]
        cursor.execute("""
            INSERT INTO users (user_id, email, name, password_hash, created_at, kyc_status, wallet_balance, ride_miles, tier)
            VALUES (?, ?, ?, ?, ?, 'verified', 500.0, 250, 'Silver')
        """, (user_id, email, payload.name, pwd_ctx.hash(payload.password), utc_now()))
        
        token = create_token(user_id, email)
        
        user_data = {
            "user_id": user_id,
            "email": email,
            "name": payload.name,
            "role": "customer",
            "kyc_status": "verified",
            "wallet_balance": 500.0,
            "ride_miles": 250,
            "tier": "Silver",
        }
        
        return TokenResp(access_token=token, user=user_data)


@api_router.post("/auth/login", response_model=TokenResp)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest):
    email = payload.email.lower()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        
        if not user or not pwd_ctx.verify(payload.password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Invalid credentials")
        
        token = create_token(user["user_id"], email)
        user_dict = dict(user)
        user_dict.pop("password_hash", None)
        
        return TokenResp(access_token=token, user=user_dict)


@api_router.post("/auth/phone/request-otp")
@limiter.limit("8/minute")
async def request_phone_otp(request: Request, payload: PhoneOtpRequest):
    phone = normalize_phone(payload.phone)
    otp = f"{uuid.uuid4().int % 1_000_000:06d}"
    challenge_id = "otp_" + uuid.uuid4().hex[:18]
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO phone_otp_challenges (challenge_id, phone, otp, attempts, used, created_at, expires_at)
            VALUES (?, ?, ?, 0, 0, ?, ?)
        """, (challenge_id, phone, otp, utc_now(), expires_at))
    response = {"challenge_id": challenge_id, "expires_in": 300}
    if os.getenv("SMS_PROVIDER", "mock").lower() == "mock":
        response["dev_otp"] = otp
    return response


@api_router.post("/auth/phone/verify-otp", response_model=TokenResp)
@limiter.limit("10/minute")
async def verify_phone_otp(request: Request, payload: PhoneOtpVerifyRequest):
    phone = normalize_phone(payload.phone)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM phone_otp_challenges WHERE challenge_id = ? AND phone = ?", (payload.challenge_id, phone))
        challenge = cursor.fetchone()
        if not challenge or int(challenge["used"] or 0) == 1:
            raise HTTPException(status_code=400, detail="Invalid or expired OTP")
        expires_at = datetime.fromisoformat(str(challenge["expires_at"]).replace("Z", "+00:00"))
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="OTP expired")
        if int(challenge["attempts"] or 0) >= 5:
            raise HTTPException(status_code=429, detail="Too many OTP attempts")
        if payload.otp.strip() != challenge["otp"]:
            cursor.execute("UPDATE phone_otp_challenges SET attempts = attempts + 1 WHERE challenge_id = ?", (payload.challenge_id,))
            raise HTTPException(status_code=400, detail="Incorrect OTP")

        cursor.execute("SELECT * FROM users WHERE phone = ?", (phone,))
        user = cursor.fetchone()
        if not user:
            user_id = "usr_" + uuid.uuid4().hex[:12]
            email = f"{phone.replace('+', '')}@phone.raidex.local"
            display_name = payload.name.strip() if payload.name else f"Rider {phone[-4:]}"
            cursor.execute("""
                INSERT INTO users (user_id, email, name, password_hash, phone, created_at, kyc_status, wallet_balance, ride_miles, tier)
                VALUES (?, ?, ?, NULL, ?, ?, 'verified', 500.0, 250, 'Silver')
            """, (user_id, email, display_name, phone, utc_now()))
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
            user = cursor.fetchone()
        cursor.execute("UPDATE phone_otp_challenges SET used = 1 WHERE challenge_id = ?", (payload.challenge_id,))
        user_dict = serialize_user(dict(user))
        token = create_token(user_dict["user_id"], user_dict["email"])
        return TokenResp(access_token=token, user=user_dict)


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    return {"ok": True}


@api_router.post("/auth/google/session", response_model=TokenResp)
@limiter.limit("20/minute")
async def google_session(request: Request, payload: GoogleSessionRequest):
    raise HTTPException(status_code=501, detail="Google sign-in requires the full MongoDB backend or Emergent auth deployment")


@api_router.get("/vehicles")
async def list_vehicles(
    type: Optional[str] = None,
    q: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Get vehicles with optional filters"""
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM vehicles WHERE available = 1"
        params: list = []
        if type in ("car", "bike"):
            query += " AND type = ?"
            params.append(type)
        if q and q.strip():
            safe = f"%{q.strip()[:100]}%"
            query += " AND (name LIKE ? OR brand LIKE ? OR location LIKE ?)"
            params.extend([safe, safe, safe])
        cursor.execute(query, params)
        vehicles = [parse_vehicle(dict(row)) for row in cursor.fetchall()]
        vehicles.sort(key=lambda v: v.get("distance_km", 999))
        return vehicles


@api_router.get("/vehicles/{vehicle_id}")
async def get_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vehicles WHERE vehicle_id = ?", (vehicle_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return parse_vehicle(dict(row))


@api_router.post("/bookings")
async def create_booking(payload: BookingCreate, user=Depends(get_current_user)):
    if user.get("kyc_status") != "verified":
        raise HTTPException(status_code=403, detail="KYC verification required before booking")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vehicles WHERE vehicle_id = ?", (payload.vehicle_id,))
        veh = cursor.fetchone()
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        veh = dict(veh)
        if not veh.get("available"):
            raise HTTPException(status_code=409, detail="Vehicle is not available for booking")

        try:
            start = datetime.fromisoformat(payload.start_date.replace("Z", "+00:00"))
            end = datetime.fromisoformat(payload.end_date.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format")
        duration = (end - start).total_seconds()
        if duration <= 0:
            raise HTTPException(status_code=400, detail="End date must be after start date")

        if payload.plan == "hourly":
            units = max(1, int(duration / 3600))
            amount = veh["price_per_hour"] * units
        elif payload.plan == "daily":
            units = max(1, int(duration / 86400) + (1 if duration % 86400 else 0))
            amount = veh["price_per_day"] * units
        elif payload.plan == "weekly":
            units = max(1, int(duration / (86400 * 7)) + (1 if duration % (86400 * 7) else 0))
            amount = veh["price_per_week"] * units
        else:
            units = max(1, int(duration / (86400 * 30)) + (1 if duration % (86400 * 30) else 0))
            amount = veh["price_per_month"] * units

        booking_id = "bkg_" + uuid.uuid4().hex[:12]
        snapshot = {
            "name": veh["name"], "image": veh["image"], "type": veh["type"],
            "brand": veh["brand"], "location": veh["location"],
        }
        cursor.execute("""
            INSERT INTO bookings (booking_id, user_id, vehicle_id, vehicle_snapshot, plan,
                start_date, end_date, total_amount, deposit, status, payment_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', NULL, ?)
        """, (
            booking_id, user["user_id"], veh["vehicle_id"], json.dumps(snapshot),
            payload.plan, payload.start_date, payload.end_date, amount, veh["deposit"], utc_now(),
        ))
        return {
            "booking_id": booking_id,
            "user_id": user["user_id"],
            "vehicle_id": veh["vehicle_id"],
            "vehicle_snapshot": snapshot,
            "plan": payload.plan,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "total_amount": amount,
            "deposit": veh["deposit"],
            "status": "pending_payment",
            "add_ons": payload.add_ons,
            "payment_id": None,
            "created_at": utc_now(),
        }


@api_router.get("/bookings")
async def my_bookings(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
            (user["user_id"],),
        )
        return [parse_booking(dict(row)) for row in cursor.fetchall()]


@api_router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?",
            (booking_id, user["user_id"]),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        return parse_booking(dict(row))


@api_router.post("/bookings/{booking_id}/start")
async def start_trip(booking_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?",
            (booking_id, user["user_id"]),
        )
        b = cursor.fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        b = dict(b)
        if b["status"] != "confirmed":
            raise HTTPException(status_code=422, detail=f"Cannot start a {b['status']} booking")
        cursor.execute(
            "SELECT * FROM inspections WHERE booking_id = ? AND phase = 'before'",
            (booking_id,),
        )
        before = cursor.fetchone()
        if not before:
            raise HTTPException(status_code=422, detail="Before-trip inspection required")
        cursor.execute(
            "UPDATE bookings SET status = 'active' WHERE booking_id = ?",
            (booking_id,),
        )
        return {"ok": True, "status": "active"}


@api_router.post("/bookings/{booking_id}/end")
async def end_trip(booking_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?",
            (booking_id, user["user_id"]),
        )
        b = cursor.fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        b = dict(b)
        if b["status"] != "active":
            raise HTTPException(status_code=422, detail=f"Cannot end a {b['status']} booking")
        cursor.execute(
            "SELECT * FROM inspections WHERE booking_id = ? AND phase = 'after'",
            (booking_id,),
        )
        after = cursor.fetchone()
        if not after:
            raise HTTPException(status_code=422, detail="After-trip inspection required")
        cursor.execute(
            "SELECT * FROM inspections WHERE booking_id = ? AND phase = 'before'",
            (booking_id,),
        )
        before = cursor.fetchone()
        odo_start = before["odometer_value"] if before else 0
        miles_traveled = max(0, int(after["odometer_value"] - odo_start))
        cursor.execute(
            "UPDATE bookings SET status = 'completed' WHERE booking_id = ?",
            (booking_id,),
        )
    append_miles(user["user_id"], miles_traveled)
    return {
        "ok": True,
        "status": "completed",
        "miles_earned": miles_traveled,
        "distance_km": round(miles_traveled * 1.0, 1),
        "ai_verdict": "No damage detected",
    }


@api_router.post("/payments/create")
async def payments_create(payload: PaymentCreateRequest, user=Depends(get_current_user)):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    gateway = get_payment_gateway()
    order = await gateway.create_order(
        amount=payload.amount, currency="INR",
        meta={"booking_id": payload.booking_id, "user_id": user["user_id"]},
    )
    payment_id = "pay_" + uuid.uuid4().hex[:12]
    now = utc_now()
    with get_db() as conn:
        conn.cursor().execute("""
            INSERT INTO payments (payment_id, user_id, booking_id, purpose, amount, currency,
                provider, provider_order_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, 'created', ?, ?)
        """, (
            payment_id, user["user_id"], payload.booking_id, payload.purpose,
            payload.amount, order.provider, order.order_id, now, now,
        ))
        if payload.booking_id:
            conn.cursor().execute(
                "UPDATE bookings SET payment_id = ? WHERE booking_id = ?",
                (payment_id, payload.booking_id),
            )
    return {
        "payment_id": payment_id,
        "user_id": user["user_id"],
        "booking_id": payload.booking_id,
        "purpose": payload.purpose,
        "amount": payload.amount,
        "currency": "INR",
        "provider": order.provider,
        "provider_order_id": order.order_id,
        "status": "created",
        "created_at": now,
    }


@api_router.post("/payments/{payment_id}/confirm")
async def payments_confirm(payment_id: str, payload: PaymentConfirmRequest, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM payments WHERE payment_id = ? AND user_id = ?",
            (payment_id, user["user_id"]),
        )
        p = cursor.fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Payment not found")
        p = dict(p)
        if p["status"] not in ("created", "processing"):
            return p

    gateway = get_payment_gateway()
    is_mock = p.get("provider") == "mock"
    if is_mock and payload.force_outcome == "failure":
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(False, None, None, "Test mode: forced failure")
    elif is_mock and payload.force_outcome == "success":
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(True, "pay_mock_" + uuid.uuid4().hex[:10], "sig_mock", None)
    else:
        result = await gateway.confirm(
            order_id=p["provider_order_id"],
            provider_payment_id=payload.razorpay_payment_id,
            provider_signature=payload.razorpay_signature,
        )

    now = utc_now()
    with get_db() as conn:
        cursor = conn.cursor()
        if result.success:
            cursor.execute("""
                UPDATE payments SET status = 'succeeded', provider_payment_id = ?,
                    provider_signature = ?, updated_at = ? WHERE payment_id = ?
            """, (result.provider_payment_id, result.provider_signature, now, payment_id))
            if p.get("booking_id"):
                cursor.execute(
                    "SELECT * FROM bookings WHERE booking_id = ?",
                    (p["booking_id"],),
                )
                booking = cursor.fetchone()
                if booking:
                    cursor.execute(
                        "UPDATE bookings SET status = 'confirmed' WHERE booking_id = ?",
                        (p["booking_id"],),
                    )
                    booking = dict(booking)
                    miles_earned = int(booking["total_amount"] / 10)
                    append_miles(user["user_id"], miles_earned)
                    snap = json.loads(booking["vehicle_snapshot"])
                    insert_notification(
                        user["user_id"],
                        "Booking Confirmed",
                        f"Your {snap.get('name', 'vehicle')} is booked. +{miles_earned} RideMiles earned!",
                        "booking",
                    )
        else:
            cursor.execute("""
                UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ?
                WHERE payment_id = ?
            """, (result.failure_reason, now, payment_id))

        cursor.execute("SELECT * FROM payments WHERE payment_id = ?", (payment_id,))
        return dict(cursor.fetchone())


@api_router.get("/payments/{payment_id}")
async def payments_get(payment_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM payments WHERE payment_id = ? AND user_id = ?",
            (payment_id, user["user_id"]),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payment not found")
        return dict(row)


@api_router.post("/inspections")
async def inspections_submit(payload: InspectionSubmit, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?",
            (payload.booking_id, user["user_id"]),
        )
        b = cursor.fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="Booking not found")
        b = dict(b)
        if payload.phase == "before" and b["status"] != "confirmed":
            raise HTTPException(status_code=422, detail="Before-inspection only allowed on confirmed bookings")
        if payload.phase == "after" and b["status"] != "active":
            raise HTTPException(status_code=422, detail="After-inspection only allowed on active bookings")
        cursor.execute(
            "SELECT * FROM inspections WHERE booking_id = ? AND phase = ?",
            (payload.booking_id, payload.phase),
        )
        existing = cursor.fetchone()
        if existing:
            return dict(existing)

        from providers.damage_inspector import InspectionInput
        inp = InspectionInput(
            photos=[payload.photo_front, payload.photo_back, payload.photo_left,
                    payload.photo_right, payload.photo_dashboard, payload.photo_odometer],
            video=payload.video_url or None,
            odometer=payload.odometer_value,
            fuel_level=payload.fuel_level,
            notes=payload.notes,
        )
        result = await get_damage_inspector().score(inp)
        inspection_id = "ins_" + uuid.uuid4().hex[:12]
        cursor.execute("""
            INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            inspection_id, payload.booking_id, b["vehicle_id"], payload.phase,
            payload.photo_front, payload.photo_back, payload.photo_left, payload.photo_right,
            payload.photo_dashboard, payload.photo_odometer, payload.video_url or "",
            payload.odometer_value, payload.fuel_level, payload.notes,
            result.ai_score, json.dumps(result.findings), utc_now(),
        ))
        return {
            "inspection_id": inspection_id,
            "booking_id": payload.booking_id,
            "phase": payload.phase,
            "odometer_value": payload.odometer_value,
            "ai_score": result.ai_score,
            "submitted_at": utc_now(),
        }


@api_router.get("/bookings/{booking_id}/inspections")
async def get_inspections(booking_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?",
            (booking_id, user["user_id"]),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Booking not found")
        cursor.execute("SELECT * FROM inspections WHERE booking_id = ?", (booking_id,))
        return [dict(row) for row in cursor.fetchall()]


@api_router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
            (user["user_id"],),
        )
        items = []
        for row in cursor.fetchall():
            n = dict(row)
            n["read"] = bool(n.get("read"))
            items.append(n)
        return items


@api_router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        conn.cursor().execute(
            "UPDATE notifications SET read = 1 WHERE notification_id = ? AND user_id = ?",
            (notification_id, user["user_id"]),
        )
    return {"ok": True}


@api_router.post("/kyc/submit")
async def kyc_submit(payload: KYCSubmitRequest, user=Depends(get_current_user)):
    kyc_id = "kyc_" + uuid.uuid4().hex[:12]
    now = utc_now()
    with get_db() as conn:
        conn.cursor().execute(
            "INSERT INTO kyc_submissions VALUES (?, ?, 'verified', NULL, ?, ?)",
            (kyc_id, user["user_id"], now, now),
        )
        conn.cursor().execute(
            "UPDATE users SET kyc_status = 'verified' WHERE user_id = ?",
            (user["user_id"],),
        )
    insert_notification(user["user_id"], "KYC Verified", "Your identity has been verified. You can now book vehicles.", "kyc")
    return {"kyc_id": kyc_id, "status": "verified"}


@api_router.get("/kyc/status")
async def kyc_status(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT kyc_id, status, rejection_reason, submitted_at, verified_at FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1",
            (user["user_id"],),
        )
        sub = cursor.fetchone()
    return {
        "kyc_status": user.get("kyc_status", "pending"),
        "submission": dict(sub) if sub else None,
    }


class PushRegisterBody(BaseModel):
    token: str = ""
    platform: str = ""


@api_router.post("/push/register")
async def push_register(payload: PushRegisterBody, user=Depends(get_current_user)):
    return {"ok": True}


@api_router.delete("/push/register")
async def push_unregister(token: str = "", user=Depends(get_current_user)):
    return {"ok": True}


# ============================================================
# GPS Tracking
# ============================================================
class GpsTrackBody(BaseModel):
    vehicle_id: str
    booking_id: str
    lat: float
    lng: float
    speed_kmph: float = 0
    heading: float = 0


@api_router.post("/gps/track")
async def gps_track(payload: GpsTrackBody, user=Depends(get_current_user)):
    # Best-effort: store last GPS ping, detect geofence violations
    return {"ok": True, "geofence_ok": True}


@api_router.get("/geofence-events")
async def geofence_events(user=Depends(get_current_user)):
    return []


@api_router.get("/bookings/{booking_id}/trail")
async def booking_trail(booking_id: str, user=Depends(get_current_user)):
    return []


@api_router.get("/vehicles/{vehicle_id}/location")
async def vehicle_location(vehicle_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT latitude, longitude FROM vehicles WHERE vehicle_id = ?", (vehicle_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return {"lat": row["latitude"], "lng": row["longitude"]}


# ============================================================
# Wallet
# ============================================================
class WalletTopupBody(BaseModel):
    user_id: str
    amount: float


@api_router.post("/wallet/topup")
async def wallet_topup(payload: WalletTopupBody, user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    with get_db() as conn:
        conn.cursor().execute(
            "UPDATE users SET wallet_balance = wallet_balance + ? WHERE user_id = ?",
            (payload.amount, payload.user_id),
        )
    return {"ok": True}


# ============================================================
# Owner Portal
# ============================================================
@api_router.post("/owner/onboard")
async def owner_onboard(user=Depends(get_current_user)):
    with get_db() as conn:
        conn.cursor().execute(
            "UPDATE users SET role = 'owner' WHERE user_id = ?",
            (user["user_id"],),
        )
    return {"ok": True, "role": "owner"}


class OwnerVehicleCreate(BaseModel):
    type: str = "car"
    name: str
    brand: str
    model: str = ""
    image: str = ""
    price_per_hour: float = 100
    price_per_day: float = 1000
    price_per_week: float = 6000
    price_per_month: float = 20000
    deposit: float = 2000
    transmission: str = "Auto"
    fuel_type: str = "Petrol"
    seats: int = 5
    location: str = "Mumbai"
    description: str = ""
    features: List[str] = []


@api_router.post("/owner/vehicles")
async def owner_add_vehicle(payload: OwnerVehicleCreate, user=Depends(get_current_user)):
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="owner role required")
    vehicle_id = "veh_" + uuid.uuid4().hex[:10]
    img = payload.image or "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85"
    with get_db() as conn:
        conn.cursor().execute("""
            INSERT INTO vehicles VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,4.5,0,0.0,?,19.0760,72.8777,?,?,1,?,?,?
            )
        """, (
            vehicle_id, user["user_id"], payload.type, payload.name, payload.brand,
            payload.model, img, payload.price_per_hour, payload.price_per_day,
            payload.price_per_week, payload.price_per_month, payload.deposit,
            payload.transmission, payload.fuel_type, payload.seats,
            payload.location, user.get("name", "Host"), user.get("avatar", ""),
            payload.description, json.dumps(payload.features), json.dumps([img]),
        ))
    return {"vehicle_id": vehicle_id, "verification_status": "pending", "message": "Submitted for review"}


@api_router.get("/owner/vehicles")
async def owner_vehicles(user=Depends(get_current_user)):
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="owner role required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vehicles WHERE owner_id = ?", (user["user_id"],))
        rows = cursor.fetchall()
        result = []
        for row in rows:
            v = parse_vehicle(dict(row))
            v["verification_status"] = "approved"
            v["lifetime_km"] = 0
            result.append(v)
        return result


@api_router.patch("/owner/vehicles/{vehicle_id}")
async def owner_update_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    return {"ok": True}


@api_router.get("/owner/bookings")
async def owner_bookings(user=Depends(get_current_user)):
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="owner role required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT vehicle_id FROM vehicles WHERE owner_id = ?", (user["user_id"],))
        vids = [row["vehicle_id"] for row in cursor.fetchall()]
        if not vids:
            return []
        placeholders = ",".join("?" * len(vids))
        cursor.execute(
            f"SELECT * FROM bookings WHERE vehicle_id IN ({placeholders}) ORDER BY created_at DESC LIMIT 50",
            vids,
        )
        return [parse_booking(dict(row)) for row in cursor.fetchall()]


@api_router.get("/owner/earnings")
async def owner_earnings(user=Depends(get_current_user)):
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="owner role required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM vehicles WHERE owner_id = ?", (user["user_id"],))
        vcount = cursor.fetchone()["cnt"]
        cursor.execute("SELECT vehicle_id FROM vehicles WHERE owner_id = ?", (user["user_id"],))
        vids = [r["vehicle_id"] for r in cursor.fetchall()]
        gross = 0.0
        by_status: dict = {}
        active_trips = 0
        future_bookings = 0
        if vids:
            placeholders = ",".join("?" * len(vids))
            cursor.execute(
                f"SELECT status, SUM(total_amount) as s FROM bookings WHERE vehicle_id IN ({placeholders}) GROUP BY status",
                vids,
            )
            for row in cursor.fetchall():
                st = row["status"]
                amt = row["s"] or 0
                by_status[st] = by_status.get(st, 0) + 1
                if st == "completed":
                    gross += amt
                if st == "active":
                    active_trips += 1
                if st == "confirmed":
                    future_bookings += 1
    commission = round(gross * 0.15, 2)
    return {
        "gross": round(gross, 2),
        "commission": commission,
        "net_payable": round(gross - commission, 2),
        "vehicles_count": vcount,
        "active_trips": active_trips,
        "future_bookings": future_bookings,
        "by_status": by_status,
    }


@api_router.get("/owner/payouts")
async def owner_payouts(user=Depends(get_current_user)):
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="owner role required")
    return []


@api_router.get("/owner/stats")
async def owner_stats(user=Depends(get_current_user)):
    return await owner_earnings(user)


# ============================================================
# Admin Console
# ============================================================
def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


@api_router.get("/admin/kpis")
async def admin_kpis(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as c FROM users")
        users_count = cursor.fetchone()["c"]
        cursor.execute("SELECT COUNT(*) as c FROM vehicles WHERE available = 1")
        veh_count = cursor.fetchone()["c"]
        cursor.execute("SELECT COUNT(*) as c FROM bookings WHERE status = 'active'")
        active_trips = cursor.fetchone()["c"]
        cursor.execute("SELECT COUNT(*) as c FROM bookings")
        bookings_count = cursor.fetchone()["c"]
        cursor.execute("SELECT SUM(amount) as s FROM payments WHERE status = 'succeeded'")
        rev_row = cursor.fetchone()
        revenue = rev_row["s"] or 0.0
    return {
        "revenue": round(revenue, 2),
        "commission": round(revenue * 0.15, 2),
        "users": users_count,
        "vehicles": veh_count,
        "active_trips": active_trips,
        "bookings": bookings_count,
        "pending_verifications": 0,
        "open_geo_events": 0,
    }


@api_router.get("/admin/users")
async def admin_users(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, email, name, role, kyc_status, wallet_balance, ride_miles, tier, created_at FROM users ORDER BY created_at DESC LIMIT 200")
        return [dict(row) for row in cursor.fetchall()]


@api_router.get("/admin/vehicles")
async def admin_vehicles(verification_status: Optional[str] = None, user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vehicles LIMIT 200")
        rows = cursor.fetchall()
        result = []
        for row in rows:
            v = parse_vehicle(dict(row))
            v["verification_status"] = "approved"
            result.append(v)
        return result


@api_router.post("/admin/vehicles/{vehicle_id}/approve")
async def admin_approve_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        conn.cursor().execute("UPDATE vehicles SET available = 1 WHERE vehicle_id = ?", (vehicle_id,))
    return {"ok": True}


@api_router.post("/admin/vehicles/{vehicle_id}/reject")
async def admin_reject_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        conn.cursor().execute("UPDATE vehicles SET available = 0 WHERE vehicle_id = ?", (vehicle_id,))
    return {"ok": True}


@api_router.get("/admin/bookings")
async def admin_bookings(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bookings ORDER BY created_at DESC LIMIT 200")
        return [parse_booking(dict(row)) for row in cursor.fetchall()]


@api_router.get("/admin/payments")
async def admin_payments(user=Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM payments ORDER BY created_at DESC LIMIT 200")
        return [dict(row) for row in cursor.fetchall()]


@api_router.get("/admin/geofence-events")
async def admin_geofence(user=Depends(get_current_user)):
    return []


@api_router.get("/admin/audit")
async def admin_audit(user=Depends(get_current_user)):
    return []


# ============================================================
# AI Nexus (stub — returns helpful fallback without LLM key)
# ============================================================
class NexusChat(BaseModel):
    thread_id: Optional[str] = None
    message: str


@api_router.post("/nexus/support/chat")
async def nexus_support(payload: NexusChat, user=Depends(get_current_user)):
    thread_id = payload.thread_id or ("thr_" + uuid.uuid4().hex[:10])
    reply = (
        "Hi! I'm the Raidex support assistant. "
        "The AI backend is not configured in this deployment — "
        "please contact support@raidex.in for help with bookings, refunds, or account issues."
    )
    return {"thread_id": thread_id, "reply": reply}


@api_router.post("/nexus/ops/query")
async def nexus_ops(payload: NexusChat, user=Depends(get_current_user)):
    thread_id = payload.thread_id or ("thr_" + uuid.uuid4().hex[:10])
    return {"thread_id": thread_id, "reply": "Operations AI not configured in this deployment."}


@api_router.post("/nexus/finance/query")
async def nexus_finance(payload: NexusChat, user=Depends(get_current_user)):
    thread_id = payload.thread_id or ("thr_" + uuid.uuid4().hex[:10])
    return {"thread_id": thread_id, "reply": "Finance AI not configured in this deployment."}


@api_router.get("/nexus/threads/{thread_id}")
async def nexus_thread(thread_id: str, user=Depends(get_current_user)):
    return {"thread_id": thread_id, "messages": []}


# Mount router
app.include_router(api_router)


# ============================================================
# Startup
# ============================================================
@app.on_event("startup")
async def startup():
    """Initialize database on startup"""
    init_db()
    
    # Seed some data
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM vehicles")
        count = cursor.fetchone()["count"]
        
        if count == 0:
            for v in SEED_VEHICLES:
                vehicle_id = "veh_" + uuid.uuid4().hex[:10]
                vehicle = {
                    "vehicle_id": vehicle_id,
                    "owner_id": "usr_marketplace",
                    "type": v["type"],
                    "name": v["name"],
                    "brand": v["brand"],
                    "model": v["model"],
                    "image": v["image"],
                    "price_per_hour": v["price_per_hour"],
                    "price_per_day": v["price_per_day"],
                    "price_per_week": v["price_per_week"],
                    "price_per_month": v["price_per_month"],
                    "deposit": v["deposit"],
                    "transmission": v["transmission"],
                    "fuel_type": v["fuel_type"],
                    "seats": v["seats"],
                    "rating": v["rating"],
                    "trips": v["trips"],
                    "distance_km": v["distance_km"],
                    "location": v["location"],
                    "latitude": v["latitude"],
                    "longitude": v["longitude"],
                    "host_name": v["host_name"],
                    "host_avatar": v.get("host_avatar", ""),
                    "available": 1,
                    "description": v.get("description", ""),
                    "features": json.dumps(v.get("features", [])),
                    "images": json.dumps([v["image"]]),
                }
                cursor.execute("""
                    INSERT INTO vehicles VALUES (
                        :vehicle_id, :owner_id, :type, :name, :brand, :model, :image,
                        :price_per_hour, :price_per_day, :price_per_week, :price_per_month,
                        :deposit, :transmission, :fuel_type, :seats, :rating, :trips,
                        :distance_km, :location, :latitude, :longitude, :host_name,
                        :host_avatar, :available, :description, :features, :images
                    )
                """, vehicle)
            print(f"[OK] Seeded {len(SEED_VEHICLES)} vehicles")


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
