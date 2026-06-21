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
                status TEXT DEFAULT 'created',
                created_at TEXT
            )
        """)
        
        print("✓ SQLite database initialized at:", DB_PATH)


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


class TokenResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


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
            INSERT INTO users (user_id, email, name, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, email, payload.name, pwd_ctx.hash(payload.password), utc_now()))
        
        token = create_token(user_id, email)
        
        user_data = {
            "user_id": user_id,
            "email": email,
            "name": payload.name,
            "role": "customer",
            "kyc_status": "pending"
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


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api_router.get("/vehicles")
async def list_vehicles():
    """Get all vehicles"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vehicles WHERE available = 1")
        vehicles = [dict(row) for row in cursor.fetchall()]
        
        # Parse JSON fields
        for v in vehicles:
            if v.get("features"):
                v["features"] = json.loads(v["features"])
            if v.get("images"):
                v["images"] = json.loads(v["images"])
        
        return vehicles


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
            # Add sample vehicle
            vehicle = {
                "vehicle_id": "veh_sample1",
                "owner_id": "usr_admin",
                "type": "car",
                "name": "Tesla Model Y",
                "brand": "Tesla",
                "model": "Model Y",
                "image": "https://images.unsplash.com/photo-1777329385816-4220415c266d",
                "price_per_hour": 450,
                "price_per_day": 4500,
                "price_per_week": 27000,
                "price_per_month": 95000,
                "deposit": 10000,
                "transmission": "Auto",
                "fuel_type": "EV",
                "seats": 5,
                "rating": 4.9,
                "trips": 142,
                "distance_km": 1.2,
                "location": "Mumbai",
                "latitude": 19.0596,
                "longitude": 72.8295,
                "host_name": "Admin",
                "host_avatar": "",
                "available": 1,
                "description": "Tesla Model Y - Electric SUV",
                "features": json.dumps(["Autopilot", "Premium Audio"]),
                "images": json.dumps(["https://images.unsplash.com/photo-1777329385816-4220415c266d"])
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
            
            print("✓ Sample vehicle added")


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
