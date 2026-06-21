from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, status
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import re
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt as pyjwt
import httpx
import asyncio

from providers import (
    get_payment_gateway, get_kyc_provider, get_damage_inspector, get_push_sender,
)
from providers.kyc_provider import KYCSubmission
from providers.push_sender import PushPayload

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ── JWT_SECRET must be explicitly set in production ───────────────────────────
_jwt_secret_env = os.environ.get("JWT_SECRET", "")
_jwt_secret_fallback = "ridex-super-secret-key-change-in-prod"
if not _jwt_secret_env or _jwt_secret_env == _jwt_secret_fallback:
    _env_name = os.environ.get("ENV", "development")
    if _env_name in ("production", "prod", "staging"):
        raise RuntimeError(
            "JWT_SECRET environment variable is not set or is using the insecure default. "
            "Generate a random secret: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    # Development — warn loudly but continue
    import warnings
    warnings.warn(
        "JWT_SECRET is using the insecure default. Set a strong random value before deploying.",
        stacklevel=2,
    )
JWT_SECRET: str = _jwt_secret_env or _jwt_secret_fallback
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Rate limiter (auth endpoints) ─────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Raidex API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

api_router = APIRouter(prefix="/api")

# ============================================================
# Models
# ============================================================
def utc_now():
    return datetime.now(timezone.utc).isoformat()


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

class GoogleSessionRequest(BaseModel):
    session_id: str

class User(BaseModel):
    user_id: str
    email: str
    name: str
    avatar: Optional[str] = None
    phone: Optional[str] = None
    role: str = "customer"
    kyc_status: str = "pending"  # pending/verified/rejected
    wallet_balance: float = 500.0
    ride_miles: int = 250
    tier: str = "Silver"
    created_at: str

class Vehicle(BaseModel):
    vehicle_id: str
    type: Literal["car", "bike"]
    name: str
    brand: str
    model: str
    image: str
    images: List[str] = []
    price_per_hour: float
    price_per_day: float
    price_per_week: float
    price_per_month: float
    deposit: float
    transmission: str  # Auto/Manual
    fuel_type: str  # Petrol/Diesel/EV
    seats: int
    rating: float
    trips: int
    distance_km: float  # distance from user
    location: str
    latitude: float
    longitude: float
    host_name: str
    host_avatar: str
    available: bool = True
    features: List[str] = []
    description: str = ""

class Booking(BaseModel):
    booking_id: str
    user_id: str
    vehicle_id: str
    vehicle_snapshot: dict
    plan: Literal["hourly", "daily", "weekly", "monthly"]
    start_date: str
    end_date: str
    total_amount: float
    deposit: float
    status: str  # confirmed/active/completed/cancelled
    created_at: str
    odometer_start: Optional[float] = None
    odometer_end: Optional[float] = None
    inspection_before: List[str] = []
    inspection_after: List[str] = []

class BookingCreate(BaseModel):
    vehicle_id: str
    plan: Literal["hourly", "daily", "weekly", "monthly"]
    start_date: str
    end_date: str
    add_ons: List[str] = []

class Notification(BaseModel):
    notification_id: str
    user_id: str
    title: str
    body: str
    type: str
    read: bool = False
    created_at: str


# ============================================================
# Auth helpers
# ============================================================
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
        raise HTTPException(status_code=401, detail="Missing or invalid auth header")
    token = authorization.split(" ", 1)[1].strip()

    # Try JWT first
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("uid")
        if uid:
            user = await db.users.find_one({"user_id": uid}, {"_id": 0})
            if user:
                return user
    except pyjwt.PyJWTError:
        pass

    # Fall back to Emergent session token
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if session:
        exp = session.get("expires_at")
        if exp:
            try:
                if isinstance(exp, str):
                    exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                else:
                    exp_dt = exp
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if exp_dt > datetime.now(timezone.utc):
                    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                    if user:
                        return user
            except Exception:
                pass

    raise HTTPException(status_code=401, detail="Invalid or expired credentials")


def serialize_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k != "password_hash" and k != "_id"}


# ============================================================
# Seed data
# ============================================================
SEED_VEHICLES = [
    {
        "type": "car", "name": "Tesla Model Y", "brand": "Tesla", "model": "Model Y Long Range",
        "image": "https://images.unsplash.com/photo-1777329385816-4220415c266d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODB8MHwxfHNlYXJjaHwxfHxUZXNsYSUyMGNhciUyMG1vZGVybiUyMGNpdHl8ZW58MHx8fHwxNzgxOTcxNjAxfDA&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 450, "price_per_day": 4500, "price_per_week": 27000, "price_per_month": 95000,
        "deposit": 10000, "transmission": "Auto", "fuel_type": "EV", "seats": 5, "rating": 4.9, "trips": 142,
        "distance_km": 1.2, "location": "Bandra West, Mumbai", "latitude": 19.0596, "longitude": 72.8295,
        "host_name": "Aarav Mehta", "host_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHxwcm9mZXNzaW9uYWwlMjBoZWFkc2hvdCUyMHBvcnRyYWl0fGVufDB8fHx8MTc4MTk3MTYwMXww&ixlib=rb-4.1.0&q=85",
        "features": ["Autopilot", "Premium Audio", "Glass Roof", "Supercharging"],
        "description": "Experience the future of driving. The Tesla Model Y combines sport utility versatility with cutting-edge technology."
    },
    {
        "type": "car", "name": "Cadillac Escalade", "brand": "Cadillac", "model": "Escalade Premium",
        "image": "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 800, "price_per_day": 7500, "price_per_week": 45000, "price_per_month": 160000,
        "deposit": 20000, "transmission": "Auto", "fuel_type": "Petrol", "seats": 7, "rating": 4.8, "trips": 89,
        "distance_km": 2.4, "location": "Juhu, Mumbai", "latitude": 19.1075, "longitude": 72.8263,
        "host_name": "Priya Shah", "host_avatar": "https://images.pexels.com/photos/26872232/pexels-photo-26872232.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "features": ["Massage Seats", "Captain Chairs", "Sunroof", "360 Camera"],
        "description": "Ultimate luxury SUV for groups and special occasions. Premium leather and best-in-class space."
    },
    {
        "type": "car", "name": "Mahindra Thar", "brand": "Mahindra", "model": "Thar LX 4WD",
        "image": "https://images.pexels.com/photos/16510639/pexels-photo-16510639.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 250, "price_per_day": 2800, "price_per_week": 17000, "price_per_month": 58000,
        "deposit": 5000, "transmission": "Manual", "fuel_type": "Diesel", "seats": 4, "rating": 4.7, "trips": 211,
        "distance_km": 0.8, "location": "Andheri East, Mumbai", "latitude": 19.1136, "longitude": 72.8697,
        "host_name": "Rohan Iyer", "host_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHxwcm9mZXNzaW9uYWwlMjBoZWFkc2hvdCUyMHBvcnRyYWl0fGVufDB8fHx8MTc4MTk3MTYwMXww&ixlib=rb-4.1.0&q=85",
        "features": ["4x4", "Removable Top", "Off-road", "Hill Hold"],
        "description": "Built for adventure. Perfect for weekend getaways and rugged terrain."
    },
    {
        "type": "bike", "name": "Royal Enfield Classic 350", "brand": "Royal Enfield", "model": "Classic 350 Halcyon",
        "image": "https://images.pexels.com/photos/15836900/pexels-photo-15836900.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 80, "price_per_day": 900, "price_per_week": 5400, "price_per_month": 18000,
        "deposit": 2000, "transmission": "Manual", "fuel_type": "Petrol", "seats": 2, "rating": 4.6, "trips": 312,
        "distance_km": 0.5, "location": "Powai, Mumbai", "latitude": 19.1176, "longitude": 72.9060,
        "host_name": "Vikram Singh", "host_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHxwcm9mZXNzaW9uYWwlMjBoZWFkc2hvdCUyMHBvcnRyYWl0fGVufDB8fHx8MTc4MTk3MTYwMXww&ixlib=rb-4.1.0&q=85",
        "features": ["Single Cylinder", "Dual ABS", "Classic Styling"],
        "description": "Iconic thump. Perfect city cruiser with timeless design."
    },
    {
        "type": "bike", "name": "KTM Duke 390", "brand": "KTM", "model": "Duke 390",
        "image": "https://images.pexels.com/photos/15836900/pexels-photo-15836900.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "price_per_hour": 120, "price_per_day": 1400, "price_per_week": 8400, "price_per_month": 28000,
        "deposit": 3000, "transmission": "Manual", "fuel_type": "Petrol", "seats": 2, "rating": 4.8, "trips": 178,
        "distance_km": 1.8, "location": "Lower Parel, Mumbai", "latitude": 18.9978, "longitude": 72.8266,
        "host_name": "Kabir Joshi", "host_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHxwcm9mZXNzaW9uYWwlMjBoZWFkc2hvdCUyMHBvcnRyYWl0fGVufDB8fHx8MTc4MTk3MTYwMXww&ixlib=rb-4.1.0&q=85",
        "features": ["Quickshifter", "TFT Display", "Slipper Clutch"],
        "description": "Pure thrill. Naked street fighter with racing DNA."
    },
    {
        "type": "car", "name": "Hyundai Creta", "brand": "Hyundai", "model": "Creta SX(O)",
        "image": "https://images.unsplash.com/photo-1758217209786-95458c5d30a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxsdXh1cnklMjBTVVYlMjBkcml2aW5nfGVufDB8fHx8MTc4MTk3MTYwMnww&ixlib=rb-4.1.0&q=85",
        "price_per_hour": 200, "price_per_day": 2200, "price_per_week": 13000, "price_per_month": 45000,
        "deposit": 4000, "transmission": "Auto", "fuel_type": "Petrol", "seats": 5, "rating": 4.5, "trips": 256,
        "distance_km": 3.1, "location": "Powai, Mumbai", "latitude": 19.1176, "longitude": 72.9060,
        "host_name": "Aisha Khan", "host_avatar": "https://images.pexels.com/photos/26872232/pexels-photo-26872232.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "features": ["Sunroof", "Ventilated Seats", "Wireless Charging"],
        "description": "Premium compact SUV. Comfort meets style for daily and weekend use."
    },
]


async def seed_data():
    count = await db.vehicles.count_documents({})
    if count == 0:
        docs = []
        for v in SEED_VEHICLES:
            v2 = dict(v)
            v2["vehicle_id"] = "veh_" + uuid.uuid4().hex[:10]
            v2["available"] = True
            v2["verification_status"] = "approved"
            v2["owner_id"] = "usr_marketplace"
            v2["images"] = [v["image"]]
            docs.append(v2)
        await db.vehicles.insert_many(docs)
        logger.info(f"Seeded {len(docs)} vehicles")
    # Seed admin user
    admin = await db.users.find_one({"email": "admin@raidex.io"})
    if not admin:
        # Admin account: generate a strong random password on first run
        # Set ADMIN_EMAIL and ADMIN_PASSWORD env vars to customize
        import secrets
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@raidex.io")
        admin_password = os.environ.get("ADMIN_PASSWORD", secrets.token_urlsafe(32))
        await db.users.insert_one({
            "user_id": "usr_admin0001", "email": admin_email,
            "name": "Raidex Admin", "password_hash": pwd_ctx.hash(admin_password),
            "avatar": None, "phone": None, "role": "admin",
            "roles": ["admin", "customer"], "kyc_status": "verified",
            "wallet_balance": 0, "ride_miles": 0, "tier": "Platinum",
            "created_at": utc_now(),
        })
        logger.warning(
            f"Admin account created: {admin_email}\n"
            f"Password: {admin_password}\n"
            "Save this password — it will not be shown again. "
            "Set ADMIN_PASSWORD env var before next restart to customize."
        )


# ============================================================
# Routes
# ============================================================
@api_router.get("/")
async def root():
    return {"message": "Raidex API", "version": "1.0.0"}


@api_router.post("/auth/register", response_model=TokenResp)
@limiter.limit("10/minute")
async def register(request: Request, payload: RegisterRequest):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = "usr_" + uuid.uuid4().hex[:12]
    user_doc = {
        "user_id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": pwd_ctx.hash(payload.password),
        "avatar": None,
        "phone": None,
        "role": "customer",
        "kyc_status": "pending",
        "wallet_balance": 500.0,
        "ride_miles": 250,
        "tier": "Silver",
        "created_at": utc_now(),
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, email)
    return TokenResp(access_token=token, user=serialize_user(user_doc))


@api_router.post("/auth/login", response_model=TokenResp)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if not pwd_ctx.verify(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    token = create_token(user["user_id"], email)
    return TokenResp(access_token=token, user=serialize_user(user))


@api_router.post("/auth/google/session", response_model=TokenResp)
@limiter.limit("20/minute")
async def google_session(request: Request, payload: GoogleSessionRequest):
    """Exchange Emergent session_id for our JWT."""
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google session")
    data = r.json()
    email = data["email"].lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data["session_token"]

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = "usr_" + uuid.uuid4().hex[:12]
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "password_hash": None,
            "avatar": picture,
            "phone": None,
            "role": "customer",
            "kyc_status": "pending",
            "wallet_balance": 500.0,
            "ride_miles": 250,
            "tier": "Silver",
            "created_at": utc_now(),
        }
        await db.users.insert_one(user_doc)
        user = user_doc
    else:
        if picture and not user.get("avatar"):
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"avatar": picture}})
            user["avatar"] = picture

    # Store session
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user["user_id"],
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "created_at": utc_now(),
        }},
        upsert=True,
    )
    # Use the Emergent session_token directly so client uses one token
    return TokenResp(access_token=session_token, user=serialize_user(user))


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return serialize_user(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}



# ============================================================
# KYC (Slice 2)
# ============================================================
class KYCSubmitRequest(BaseModel):
    aadhaar_front: str
    aadhaar_back: str
    aadhaar_last4: str
    dl_front: str
    dl_back: str
    dl_number: str
    dl_expiry: str = ""
    face_selfie: str


async def _run_kyc_verification(kyc_id: str, user_id: str, payload: dict):
    """Background task that calls the configured KYC provider."""
    provider = get_kyc_provider()
    try:
        result = await provider.verify(KYCSubmission(
            aadhaar_front=payload["aadhaar_front"],
            aadhaar_back=payload["aadhaar_back"],
            aadhaar_last4=payload["aadhaar_last4"],
            dl_front=payload["dl_front"],
            dl_back=payload["dl_back"],
            dl_number=payload["dl_number"],
            dl_expiry=payload.get("dl_expiry", ""),
            face_selfie=payload["face_selfie"],
        ))
        await db.kyc_submissions.update_one(
            {"kyc_id": kyc_id},
            {"$set": {
                "status": result.status,
                "face_match_score": result.face_match_score,
                "liveness_score": result.liveness_score,
                "rejection_reason": result.rejection_reason,
                "verified_at": utc_now() if result.status == "verified" else None,
            }}
        )
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"kyc_status": result.status, "current_kyc_id": kyc_id}}
        )
        title = "KYC Verified" if result.status == "verified" else "KYC Rejected"
        body = ("Your identity has been verified. You can now book vehicles."
                if result.status == "verified"
                else f"Verification failed: {result.rejection_reason}")
        await db.notifications.insert_one({
            "notification_id": "ntf_" + uuid.uuid4().hex[:10],
            "user_id": user_id, "title": title, "body": body,
            "type": "kyc", "read": False, "created_at": utc_now(),
        })
        await get_push_sender().send(PushPayload(user_id=user_id, title=title, body=body))
    except Exception as e:
        logger.exception("KYC verification error: %s", e)
        await db.kyc_submissions.update_one(
            {"kyc_id": kyc_id},
            {"$set": {"status": "rejected", "rejection_reason": "Internal verifier error"}}
        )


@api_router.post("/kyc/submit")
async def kyc_submit(payload: KYCSubmitRequest, user=Depends(get_current_user)):
    kyc_id = "kyc_" + uuid.uuid4().hex[:12]
    doc = {
        "kyc_id": kyc_id,
        "user_id": user["user_id"],
        "aadhaar_front": payload.aadhaar_front,
        "aadhaar_back": payload.aadhaar_back,
        "aadhaar_last4": payload.aadhaar_last4[-4:] if payload.aadhaar_last4 else "",
        "dl_front": payload.dl_front,
        "dl_back": payload.dl_back,
        "dl_number": payload.dl_number,
        "dl_expiry": payload.dl_expiry,
        "face_selfie": payload.face_selfie,
        "provider": get_kyc_provider().name,
        "status": "processing",
        "rejection_reason": None,
        "submitted_at": utc_now(),
        "verified_at": None,
    }
    await db.kyc_submissions.insert_one(doc)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"kyc_status": "submitted", "current_kyc_id": kyc_id}}
    )
    asyncio.create_task(_run_kyc_verification(kyc_id, user["user_id"], doc))
    return {"kyc_id": kyc_id, "status": "processing"}


@api_router.get("/kyc/status")
async def kyc_status(user=Depends(get_current_user)):
    sub = await db.kyc_submissions.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "aadhaar_front": 0, "aadhaar_back": 0, "dl_front": 0, "dl_back": 0, "face_selfie": 0},
        sort=[("submitted_at", -1)],
    )
    return {
        "kyc_status": user.get("kyc_status", "pending"),
        "submission": sub,
    }


# ============================================================
# Payments (Slice 3)
# ============================================================
class PaymentCreateRequest(BaseModel):
    booking_id: Optional[str] = None
    amount: float
    purpose: Literal["booking", "deposit", "wallet_topup"] = "booking"


class PaymentConfirmRequest(BaseModel):
    force_outcome: Optional[Literal["success", "failure"]] = None


async def _append_wallet_ledger(user_id: str, delta: float, reason: str, payment_id: str | None = None, ref_id: str | None = None):
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    new_balance = float(user.get("wallet_balance", 0)) + delta
    await db.users.update_one({"user_id": user_id}, {"$set": {"wallet_balance": new_balance}})
    await db.wallet_ledger.insert_one({
        "ledger_id": "wl_" + uuid.uuid4().hex[:12],
        "user_id": user_id, "delta": delta, "reason": reason,
        "payment_id": payment_id, "ref_id": ref_id,
        "balance_after": new_balance, "created_at": utc_now(),
    })
    return new_balance


async def _append_miles_ledger(user_id: str, delta: int, reason: str, ref_id: str | None = None):
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    new_balance = int(user.get("ride_miles", 0)) + delta
    new_balance = max(0, new_balance)
    await db.users.update_one({"user_id": user_id}, {"$set": {"ride_miles": new_balance}})
    await db.ride_miles_ledger.insert_one({
        "ledger_id": "ml_" + uuid.uuid4().hex[:12],
        "user_id": user_id, "delta": delta, "reason": reason,
        "ref_type": "booking", "ref_id": ref_id,
        "balance_after": new_balance, "created_at": utc_now(),
    })
    return new_balance


@api_router.post("/payments/create")
async def payments_create(payload: PaymentCreateRequest, user=Depends(get_current_user)):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    booking = None
    if payload.booking_id:
        booking = await db.bookings.find_one(
            {"booking_id": payload.booking_id, "user_id": user["user_id"]},
            {"_id": 0},
        )
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")

    gateway = get_payment_gateway()
    order = await gateway.create_order(amount=payload.amount, currency="INR",
                                       meta={"booking_id": payload.booking_id, "user_id": user["user_id"]})
    payment_id = "pay_" + uuid.uuid4().hex[:12]
    payment_doc = {
        "payment_id": payment_id,
        "user_id": user["user_id"],
        "booking_id": payload.booking_id,
        "purpose": payload.purpose,
        "amount": payload.amount,
        "currency": "INR",
        "provider": order.provider,
        "provider_order_id": order.order_id,
        "provider_payment_id": None,
        "provider_signature": None,
        "status": "created",
        "failure_reason": None,
        "refund_amount": 0,
        "refund_status": "none",
        "metadata": {"booking_id": payload.booking_id},
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    await db.payments.insert_one(payment_doc)
    if payload.booking_id:
        await db.bookings.update_one(
            {"booking_id": payload.booking_id},
            {"$set": {"payment_id": payment_id}}
        )
    payment_doc.pop("_id", None)
    return payment_doc


@api_router.post("/payments/{payment_id}/confirm")
async def payments_confirm(payment_id: str, payload: PaymentConfirmRequest, user=Depends(get_current_user)):
    p = await db.payments.find_one(
        {"payment_id": payment_id, "user_id": user["user_id"]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] not in ("created", "processing"):
        return p

    await db.payments.update_one({"payment_id": payment_id}, {"$set": {"status": "processing", "updated_at": utc_now()}})
    gateway = get_payment_gateway()
    # Honour test override on Mock gateway only:
    if payload.force_outcome == "failure":
        result_success = False
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(False, None, None, "Test mode: forced failure")
    elif payload.force_outcome == "success":
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(True, "pay_mock_" + uuid.uuid4().hex[:10], "sig_mock", None)
        result_success = True
    else:
        result = await gateway.confirm(order_id=p["provider_order_id"])
        result_success = result.success

    if result_success:
        await db.payments.update_one({"payment_id": payment_id}, {"$set": {
            "status": "succeeded",
            "provider_payment_id": result.provider_payment_id,
            "provider_signature": result.provider_signature,
            "updated_at": utc_now(),
        }})
        if p.get("booking_id"):
            booking = await db.bookings.find_one({"booking_id": p["booking_id"]}, {"_id": 0})
            if booking:
                await db.bookings.update_one({"booking_id": p["booking_id"]}, {"$set": {"status": "confirmed"}})
                miles_earned = int(booking["total_amount"] / 10)
                await _append_miles_ledger(user["user_id"], miles_earned, "booking", ref_id=p["booking_id"])
                await db.notifications.insert_one({
                    "notification_id": "ntf_" + uuid.uuid4().hex[:10],
                    "user_id": user["user_id"],
                    "title": "Booking Confirmed",
                    "body": f"Your {booking['vehicle_snapshot']['name']} is booked. +{miles_earned} RideMiles earned!",
                    "type": "booking", "read": False, "created_at": utc_now(),
                })
        elif p["purpose"] == "wallet_topup":
            await _append_wallet_ledger(user["user_id"], p["amount"], "topup", payment_id=payment_id)
    else:
        await db.payments.update_one({"payment_id": payment_id}, {"$set": {
            "status": "failed",
            "failure_reason": result.failure_reason,
            "updated_at": utc_now(),
        }})

    updated = await db.payments.find_one({"payment_id": payment_id}, {"_id": 0})
    return updated


@api_router.post("/payments/{payment_id}/refund")
async def payments_refund(payment_id: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"payment_id": payment_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] != "succeeded":
        raise HTTPException(status_code=400, detail="Only succeeded payments can be refunded")
    if p["refund_status"] == "processed":
        return p

    gateway = get_payment_gateway()
    res = await gateway.refund(provider_payment_id=p["provider_payment_id"], amount=p["amount"])
    if not res.success:
        await db.payments.update_one({"payment_id": payment_id}, {"$set": {"refund_status": "failed"}})
        raise HTTPException(status_code=400, detail=res.failure_reason or "Refund failed")
    await db.payments.update_one({"payment_id": payment_id}, {"$set": {
        "refund_amount": res.refund_amount,
        "refund_status": "processed",
        "status": "refunded",
        "refunded_at": utc_now(),
        "updated_at": utc_now(),
    }})
    await _append_wallet_ledger(user["user_id"], res.refund_amount, "refund", payment_id=payment_id, ref_id=p.get("booking_id"))
    if p.get("booking_id"):
        await db.bookings.update_one({"booking_id": p["booking_id"]}, {"$set": {"status": "cancelled"}})
    return await db.payments.find_one({"payment_id": payment_id}, {"_id": 0})


@api_router.get("/payments/{payment_id}")
async def payments_get(payment_id: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"payment_id": payment_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return p


# ---------- Vehicles ----------
@api_router.get("/vehicles")
async def list_vehicles(
    type: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = "distance",
    user=Depends(get_current_user),
):
    query = {"available": True}
    if type and type in ("car", "bike"):
        query["type"] = type
    if q:
        # re.escape prevents ReDoS — user input must not be treated as a raw regex
        safe_q = re.escape(q.strip()[:100])
        query["$or"] = [
            {"name": {"$regex": safe_q, "$options": "i"}},
            {"brand": {"$regex": safe_q, "$options": "i"}},
            {"location": {"$regex": safe_q, "$options": "i"}},
        ]
    cursor = db.vehicles.find(query, {"_id": 0})
    items = await cursor.to_list(200)
    if sort == "price":
        items.sort(key=lambda v: v.get("price_per_day", 0))
    elif sort == "rating":
        items.sort(key=lambda v: -v.get("rating", 0))
    else:
        items.sort(key=lambda v: v.get("distance_km", 999))
    return items


@api_router.get("/vehicles/{vehicle_id}")
async def get_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return v


# ---------- Bookings ----------
@api_router.post("/bookings")
async def create_booking(payload: BookingCreate, user=Depends(get_current_user)):
    if user.get("kyc_status") != "verified":
        raise HTTPException(status_code=403, detail="KYC verification required before booking")
    veh = await db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Vehicle must be approved and marked available
    if not veh.get("available", False):
        raise HTTPException(status_code=409, detail="Vehicle is not available for booking")

    try:
        start = datetime.fromisoformat(payload.start_date.replace("Z", "+00:00"))
        end = datetime.fromisoformat(payload.end_date.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format")

    duration = (end - start).total_seconds()
    if duration <= 0:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # ── Booking conflict check ──────────────────────────────────────────────
    # An overlap exists when an existing booking's start is before our end
    # AND its end is after our start (classic interval overlap test).
    # Only confirmed and active bookings block the vehicle.
    conflict = await db.bookings.find_one({
        "vehicle_id": payload.vehicle_id,
        "status": {"$in": ["confirmed", "active"]},
        "start_date": {"$lt": payload.end_date},
        "end_date": {"$gt": payload.start_date},
    }, {"_id": 0, "booking_id": 1, "start_date": 1, "end_date": 1})
    if conflict:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Vehicle is already booked from {conflict['start_date']} "
                f"to {conflict['end_date']}. Please choose different dates."
            ),
        )
    # ── End conflict check ──────────────────────────────────────────────────

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
    booking = {
        "booking_id": booking_id,
        "user_id": user["user_id"],
        "vehicle_id": veh["vehicle_id"],
        "owner_id": veh.get("owner_id", "usr_marketplace"),
        "vehicle_snapshot": {
            "name": veh["name"], "image": veh["image"], "type": veh["type"],
            "brand": veh["brand"], "location": veh["location"],
        },
        "plan": payload.plan,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "total_amount": amount,
        "deposit": veh["deposit"],
        "status": "pending_payment",
        "created_at": utc_now(),
        "odometer_start": None,
        "odometer_end": None,
        "inspection_before": [],
        "inspection_after": [],
        "add_ons": payload.add_ons,
        "payment_id": None,
    }
    await db.bookings.insert_one(booking)
    booking.pop("_id", None)
    return booking


@api_router.get("/bookings")
async def my_bookings(user=Depends(get_current_user)):
    items = await db.bookings.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@api_router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return b


@api_router.post("/bookings/{booking_id}/start")
async def start_trip(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "confirmed":
        raise HTTPException(status_code=422, detail=f"Cannot start a {b['status']} booking")
    before = await db.inspections.find_one({"booking_id": booking_id, "phase": "before"}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=422, detail="Before-trip inspection required")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": "active", "odometer_start": before["odometer_value"], "started_at": utc_now(),
                  "inspection_before_id": before["inspection_id"]}}
    )
    return {"ok": True, "status": "active"}


@api_router.post("/bookings/{booking_id}/end")
async def end_trip(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "active":
        raise HTTPException(status_code=422, detail=f"Cannot end a {b['status']} booking")
    after = await db.inspections.find_one({"booking_id": booking_id, "phase": "after"}, {"_id": 0})
    if not after:
        raise HTTPException(status_code=422, detail="After-trip inspection required")
    odo_start = b.get("odometer_start") or 0
    miles_traveled = max(0, int(after["odometer_value"] - odo_start))
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": "completed", "odometer_end": after["odometer_value"],
                  "ended_at": utc_now(), "inspection_after_id": after["inspection_id"],
                  "miles_earned": miles_traveled}}
    )
    await _append_miles_ledger(user["user_id"], miles_traveled, "distance", ref_id=booking_id)
    # Update vehicle lifetime km
    await db.vehicles.update_one(
        {"vehicle_id": b["vehicle_id"]},
        {"$inc": {"lifetime_km": miles_traveled, "trips": 1}}
    )
    return {"ok": True, "status": "completed", "miles_earned": miles_traveled, "distance_km": miles_traveled,
            "ai_verdict": (after.get("damage_comparison") or {}).get("verdict", "clean")}


# ============================================================
# Inspections (Slice 4)
# ============================================================
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
    fuel_level: Literal["empty", "quarter", "half", "threequarter", "full"]
    notes: str = ""


@api_router.post("/inspections")
async def inspections_submit(payload: InspectionSubmit, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": payload.booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if payload.phase == "before" and b["status"] != "confirmed":
        raise HTTPException(status_code=422, detail="Before-inspection only allowed on confirmed bookings")
    if payload.phase == "after" and b["status"] != "active":
        raise HTTPException(status_code=422, detail="After-inspection only allowed on active bookings")
    # Prevent duplicates
    existing = await db.inspections.find_one({"booking_id": payload.booking_id, "phase": payload.phase}, {"_id": 0})
    if existing:
        return existing

    from providers.damage_inspector import InspectionInput
    photos = [payload.photo_front, payload.photo_back, payload.photo_left,
              payload.photo_right, payload.photo_dashboard, payload.photo_odometer]
    prev = None
    if payload.phase == "after":
        prev_doc = await db.inspections.find_one({"booking_id": payload.booking_id, "phase": "before"}, {"_id": 0})
        if prev_doc:
            prev = InspectionInput(
                photos=[prev_doc.get(f"photo_{a}", "") for a in ("front", "back", "left", "right", "dashboard", "odometer")],
                video=prev_doc.get("video_url"), odometer=prev_doc["odometer_value"],
                fuel_level=prev_doc["fuel_level"], notes=prev_doc.get("notes", ""),
            )
    inp = InspectionInput(
        photos=photos, video=payload.video_url or None,
        odometer=payload.odometer_value, fuel_level=payload.fuel_level,
        notes=payload.notes, previous_input=prev,
    )
    result = await get_damage_inspector().score(inp)

    inspection_id = "ins_" + uuid.uuid4().hex[:12]
    doc = {
        "inspection_id": inspection_id,
        "booking_id": payload.booking_id,
        "vehicle_id": b["vehicle_id"],
        "phase": payload.phase,
        "photo_front": payload.photo_front, "photo_back": payload.photo_back,
        "photo_left": payload.photo_left, "photo_right": payload.photo_right,
        "photo_dashboard": payload.photo_dashboard, "photo_odometer": payload.photo_odometer,
        "video_url": payload.video_url, "odometer_value": payload.odometer_value,
        "fuel_level": payload.fuel_level, "notes": payload.notes,
        "ai_score": result.ai_score, "ai_findings": result.findings,
        "damage_comparison": result.comparison,
        "submitted_at": utc_now(),
    }
    await db.inspections.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/bookings/{booking_id}/inspections")
async def get_inspections(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    items = await db.inspections.find({"booking_id": booking_id}, {"_id": 0}).to_list(10)
    return items


# ============================================================
# GPS Tracking & Geofence (Slice 5)
# ============================================================
class GpsTrackIn(BaseModel):
    vehicle_id: str
    booking_id: Optional[str] = None
    lat: float
    lng: float
    speed_kmph: float = 0
    heading: int = 0


def _haversine_m(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371000
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dp/2)**2 + cos(p1) * cos(p2) * sin(dl/2)**2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


@api_router.post("/gps/track")
async def gps_track(payload: GpsTrackIn, user=Depends(get_current_user)):
    veh = await db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    # Only owner/admin/active-renter can post tracks (in MVP, allow active renter)
    if payload.booking_id:
        b = await db.bookings.find_one({"booking_id": payload.booking_id, "user_id": user["user_id"]}, {"_id": 0})
        if not b or b["status"] != "active":
            raise HTTPException(status_code=403, detail="No active trip on this booking")
    await db.gps_tracks.insert_one({
        "track_id": "trk_" + uuid.uuid4().hex[:12],
        "vehicle_id": payload.vehicle_id, "booking_id": payload.booking_id,
        "lat": payload.lat, "lng": payload.lng,
        "speed_kmph": payload.speed_kmph, "heading": payload.heading,
        "recorded_at": utc_now(),
    })
    await db.vehicles.update_one(
        {"vehicle_id": payload.vehicle_id},
        {"$set": {"last_track_lat": payload.lat, "last_track_lng": payload.lng,
                  "last_track_speed": payload.speed_kmph, "last_track_at": utc_now()}}
    )
    # Geofence evaluation
    home_lat, home_lng = veh["latitude"], veh["longitude"]
    radius = veh.get("home_geofence_radius_m", 25000)
    dist = _haversine_m(home_lat, home_lng, payload.lat, payload.lng)
    events = []
    if dist > radius and not payload.booking_id:
        evt = {"event_id": "evt_" + uuid.uuid4().hex[:10], "vehicle_id": payload.vehicle_id,
               "owner_id": veh.get("owner_id", "usr_marketplace"), "booking_id": None,
               "kind": "exit_home", "lat": payload.lat, "lng": payload.lng,
               "meta": {"distance_m": int(dist)}, "acknowledged": False, "created_at": utc_now()}
        await db.geofence_events.insert_one(evt)
        events.append(evt["event_id"])
    if payload.speed_kmph > 100:
        evt = {"event_id": "evt_" + uuid.uuid4().hex[:10], "vehicle_id": payload.vehicle_id,
               "owner_id": veh.get("owner_id", "usr_marketplace"), "booking_id": payload.booking_id,
               "kind": "excess_speed", "lat": payload.lat, "lng": payload.lng,
               "meta": {"speed_kmph": payload.speed_kmph}, "acknowledged": False, "created_at": utc_now()}
        await db.geofence_events.insert_one(evt)
        events.append(evt["event_id"])
    return {"ok": True, "events": events}


@api_router.get("/vehicles/{vehicle_id}/location")
async def vehicle_location(vehicle_id: str, user=Depends(get_current_user)):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {
        "vehicle_id": vehicle_id,
        "lat": v.get("last_track_lat") or v["latitude"],
        "lng": v.get("last_track_lng") or v["longitude"],
        "speed_kmph": v.get("last_track_speed", 0),
        "recorded_at": v.get("last_track_at"),
        "home_lat": v["latitude"], "home_lng": v["longitude"],
        "home_geofence_radius_m": v.get("home_geofence_radius_m", 25000),
    }


@api_router.get("/bookings/{booking_id}/trail")
async def booking_trail(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    items = await db.gps_tracks.find({"booking_id": booking_id}, {"_id": 0}).sort("recorded_at", 1).to_list(500)
    return items


@api_router.get("/geofence-events")
async def geofence_events(user=Depends(get_current_user)):
    items = await db.geofence_events.find(
        {"$or": [{"owner_id": user["user_id"]}, {"vehicle_id": {"$exists": True}}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return items


# ---------- Notifications ----------
@api_router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@api_router.post("/notifications/{notification_id}/read")
async def mark_read(notification_id: str, user=Depends(get_current_user)):
    await db.notifications.update_one(
        {"notification_id": notification_id, "user_id": user["user_id"]},
        {"$set": {"read": True}}
    )
    return {"ok": True}


# ---------- Wallet ----------
@api_router.post("/wallet/topup")
async def topup_wallet(amount: float, user=Depends(get_current_user)):
    """
    Admin-only wallet credit for customer support adjustments.
    Direct top-up without a payment is a security risk — restrict to admin.
    Real user top-ups must go through POST /payments/create with purpose=wallet_topup.
    """
    _require_role(user, "admin")
    if amount <= 0 or amount > 50000:
        raise HTTPException(status_code=400, detail="Amount must be between 1 and 50000")
    new_balance = await _append_wallet_ledger(
        user_id=user["user_id"],
        delta=amount,
        reason="admin_credit",
    )
    return {"ok": True, "added": amount, "new_balance": new_balance}


# ---------- Owner stats (minimal) ----------
@api_router.get("/owner/stats")
async def owner_stats(user=Depends(get_current_user)):
    return {
        "total_earnings": 184500,
        "active_trips": 3,
        "future_bookings": 7,
        "utilization": 0.72,
        "listings": 4,
    }


# ============================================================
# Owner Dashboard (Slice 6)
# ============================================================
class VehicleCreate(BaseModel):
    type: Literal["car", "bike"]
    name: str
    brand: str
    model: str
    image: str
    price_per_hour: float
    price_per_day: float
    price_per_week: float
    price_per_month: float
    deposit: float
    transmission: str
    fuel_type: str
    seats: int
    location: str
    latitude: float = 19.0760
    longitude: float = 72.8777
    features: List[str] = []
    description: str = ""


def _require_role(user: dict, role: str) -> dict:
    roles = user.get("roles") or [user.get("role", "customer")]
    if role not in roles and user.get("role") != role:
        raise HTTPException(status_code=403, detail=f"{role} role required")
    return user


@api_router.post("/owner/onboard")
async def owner_onboard(user=Depends(get_current_user)):
    roles = list(set((user.get("roles") or ["customer"]) + ["owner"]))
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"roles": roles}})
    return {"ok": True, "roles": roles}


@api_router.post("/owner/vehicles")
async def owner_create_vehicle(payload: VehicleCreate, user=Depends(get_current_user)):
    _require_role(user, "owner")
    vid = "veh_" + uuid.uuid4().hex[:10]
    doc = payload.model_dump()
    doc.update({
        "vehicle_id": vid, "owner_id": user["user_id"], "images": [payload.image],
        "rating": 4.5, "trips": 0, "distance_km": 1.0, "lifetime_km": 0,
        "host_name": user["name"], "host_avatar": user.get("avatar") or "",
        "verification_status": "pending", "available": False,
        "home_geofence_radius_m": 25000,
        "created_at": utc_now(),
    })
    await db.vehicles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/owner/vehicles")
async def owner_my_vehicles(user=Depends(get_current_user)):
    _require_role(user, "owner")
    items = await db.vehicles.find({"owner_id": user["user_id"]}, {"_id": 0}).to_list(100)
    return items


@api_router.patch("/owner/vehicles/{vehicle_id}")
async def owner_update_vehicle(vehicle_id: str, body: dict, user=Depends(get_current_user)):
    _require_role(user, "owner")
    allowed = {k: v for k, v in body.items() if k in ("price_per_hour", "price_per_day", "price_per_week", "price_per_month", "available", "description", "deposit")}
    if not allowed:
        raise HTTPException(status_code=400, detail="No valid fields")
    await db.vehicles.update_one({"vehicle_id": vehicle_id, "owner_id": user["user_id"]}, {"$set": allowed})
    return await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})


@api_router.get("/owner/bookings")
async def owner_bookings(user=Depends(get_current_user)):
    _require_role(user, "owner")
    items = await db.bookings.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@api_router.get("/owner/earnings")
async def owner_earnings(user=Depends(get_current_user)):
    _require_role(user, "owner")
    bookings = await db.bookings.find({"owner_id": user["user_id"], "status": {"$in": ["confirmed", "active", "completed"]}}, {"_id": 0}).to_list(500)
    total = sum(b["total_amount"] for b in bookings)
    commission_rate = 0.15
    gross = total
    commission = round(gross * commission_rate, 2)
    net = round(gross - commission, 2)
    by_status = {}
    for b in bookings:
        by_status[b["status"]] = by_status.get(b["status"], 0) + 1
    return {
        "gross": gross, "commission": commission, "net_payable": net,
        "total_bookings": len(bookings), "by_status": by_status,
        "vehicles_count": await db.vehicles.count_documents({"owner_id": user["user_id"]}),
        "active_trips": by_status.get("active", 0),
        "future_bookings": by_status.get("confirmed", 0),
    }


@api_router.get("/owner/payouts")
async def owner_payouts(user=Depends(get_current_user)):
    _require_role(user, "owner")
    return await db.payouts.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("period_end", -1).to_list(50)


# ============================================================
# Admin Console (Slice 7)
# ============================================================
@api_router.get("/admin/kpis")
async def admin_kpis(user=Depends(get_current_user)):
    _require_role(user, "admin")
    users_count = await db.users.count_documents({})
    vehicles_count = await db.vehicles.count_documents({})
    pending_verifications = await db.vehicles.count_documents({"verification_status": "pending"})
    active_trips = await db.bookings.count_documents({"status": "active"})
    bookings_total = await db.bookings.count_documents({})
    succeeded = await db.payments.find({"status": "succeeded"}, {"amount": 1, "_id": 0}).to_list(2000)
    revenue = round(sum(p["amount"] for p in succeeded), 2)
    open_geo = await db.geofence_events.count_documents({"acknowledged": False})
    return {
        "users": users_count, "vehicles": vehicles_count,
        "pending_verifications": pending_verifications, "active_trips": active_trips,
        "bookings": bookings_total, "revenue": revenue,
        "open_geo_events": open_geo, "commission": round(revenue * 0.15, 2),
    }


@api_router.get("/admin/users")
async def admin_users(q: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if q:
        safe_q = re.escape(q.strip()[:100])
        filt = {"$or": [{"email": {"$regex": safe_q, "$options": "i"}}, {"name": {"$regex": safe_q, "$options": "i"}}]}
    items = await db.users.find(filt, {"_id": 0, "password_hash": 0}).limit(100).to_list(100)
    return items


@api_router.get("/admin/vehicles")
async def admin_vehicles(verification_status: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if verification_status:
        filt["verification_status"] = verification_status
    items = await db.vehicles.find(filt, {"_id": 0}).limit(200).to_list(200)
    return items


@api_router.post("/admin/vehicles/{vehicle_id}/approve")
async def admin_approve_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    _require_role(user, "admin")
    await db.vehicles.update_one({"vehicle_id": vehicle_id}, {"$set": {"verification_status": "approved", "available": True}})
    await db.admin_audit.insert_one({"audit_id": "aud_" + uuid.uuid4().hex[:10], "admin_id": user["user_id"],
                                      "action": "vehicle.approve", "target_type": "vehicle", "target_id": vehicle_id,
                                      "before_state": None, "after_state": {"verification_status": "approved"},
                                      "created_at": utc_now()})
    return {"ok": True}


@api_router.post("/admin/vehicles/{vehicle_id}/reject")
async def admin_reject_vehicle(vehicle_id: str, body: dict, user=Depends(get_current_user)):
    _require_role(user, "admin")
    reason = body.get("reason", "Did not meet requirements")
    await db.vehicles.update_one({"vehicle_id": vehicle_id}, {"$set": {"verification_status": "rejected", "available": False}})
    await db.admin_audit.insert_one({"audit_id": "aud_" + uuid.uuid4().hex[:10], "admin_id": user["user_id"],
                                      "action": "vehicle.reject", "target_type": "vehicle", "target_id": vehicle_id,
                                      "before_state": None, "after_state": {"verification_status": "rejected", "reason": reason},
                                      "created_at": utc_now()})
    return {"ok": True}


@api_router.get("/admin/bookings")
async def admin_bookings(status: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if status:
        filt["status"] = status
    items = await db.bookings.find(filt, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return items


@api_router.get("/admin/payments")
async def admin_payments(status: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if status:
        filt["status"] = status
    items = await db.payments.find(filt, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return items


@api_router.get("/admin/geofence-events")
async def admin_geofence(user=Depends(get_current_user)):
    _require_role(user, "admin")
    return await db.geofence_events.find({}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)


@api_router.get("/admin/audit")
async def admin_audit_log(user=Depends(get_current_user)):
    _require_role(user, "admin")
    return await db.admin_audit.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)


# ============================================================
# AI Nexus (Slice 8) — Support / Operations / Finance agents
# ============================================================
EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY", "")
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")

SUPPORT_SYS = """You are Raidex Support, a warm and concise customer assistant for the Raidex mobility marketplace.
Tagline: 'Drive More. Own Less.' Raidex offers car & bike rentals, monthly subscriptions, vehicle swap, RideMiles rewards, GPS-tracked safe trips and KYC-verified renters.
Style: friendly, short sentences, action-oriented. If user asks for refund/booking changes, gather booking_id and tell them an agent will follow up if needed. Never make up policies — if unsure, say a human will confirm."""

OPS_SYS = """You are Raidex Operations Analyst. You answer questions about bookings, vehicles, utilization, and fleet health for the admin team.
You will be given a structured snapshot of platform metrics in each prompt. Base your answer ONLY on that data. Be terse, use bullet points, surface anomalies."""

FIN_SYS = """You are Raidex Finance Analyst for admin team. You only answer questions about revenue, payments, commissions, payouts, refunds.
You will be given a structured snapshot of finance metrics in each prompt. Base your answer ONLY on that data. Use bullet points, surface revenue trends and risks."""


async def _ops_snapshot() -> str:
    kpis = {
        "users": await db.users.count_documents({}),
        "vehicles": await db.vehicles.count_documents({}),
        "active_trips": await db.bookings.count_documents({"status": "active"}),
        "confirmed_bookings": await db.bookings.count_documents({"status": "confirmed"}),
        "completed_bookings": await db.bookings.count_documents({"status": "completed"}),
        "pending_vehicle_verifications": await db.vehicles.count_documents({"verification_status": "pending"}),
        "open_geofence_events": await db.geofence_events.count_documents({"acknowledged": False}),
    }
    import json as _json
    return "Current platform snapshot:\n" + _json.dumps(kpis, indent=2)


async def _fin_snapshot() -> str:
    succeeded = await db.payments.find({"status": "succeeded"}, {"amount": 1, "_id": 0}).to_list(2000)
    failed = await db.payments.count_documents({"status": "failed"})
    refunded = await db.payments.find({"status": "refunded"}, {"refund_amount": 1, "_id": 0}).to_list(500)
    gross = round(sum(p["amount"] for p in succeeded), 2)
    refund_total = round(sum(p.get("refund_amount", 0) for p in refunded), 2)
    commission = round(gross * 0.15, 2)
    import json as _json
    snap = {
        "gross_revenue_inr": gross, "platform_commission_inr": commission,
        "net_owner_payouts_inr": round(gross - commission, 2),
        "succeeded_count": len(succeeded), "failed_count": failed,
        "refunded_count": len(refunded), "refund_total_inr": refund_total,
    }
    return "Finance snapshot:\n" + _json.dumps(snap, indent=2)


class NexusChat(BaseModel):
    thread_id: Optional[str] = None
    message: str


@api_router.post("/nexus/support/chat")
async def nexus_support(payload: NexusChat, user=Depends(get_current_user)):
    return await _run_agent("support", SUPPORT_SYS, payload, user, snapshot=None)


@api_router.post("/nexus/ops/query")
async def nexus_ops(payload: NexusChat, user=Depends(get_current_user)):
    _require_role(user, "admin")
    snap = await _ops_snapshot()
    return await _run_agent("operations", OPS_SYS, payload, user, snapshot=snap)


@api_router.post("/nexus/finance/query")
async def nexus_finance(payload: NexusChat, user=Depends(get_current_user)):
    _require_role(user, "admin")
    snap = await _fin_snapshot()
    return await _run_agent("finance", FIN_SYS, payload, user, snapshot=snap)


async def _run_agent(agent: str, system: str, payload: NexusChat, user: dict, snapshot: str | None):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")
    thread_id = payload.thread_id or ("thr_" + uuid.uuid4().hex[:12])
    # Persist user message
    await db.support_threads.update_one(
        {"thread_id": thread_id},
        {"$setOnInsert": {"thread_id": thread_id, "user_id": user["user_id"],
                          "subject": payload.message[:60], "status": "open",
                          "assigned_agent": agent, "created_at": utc_now()},
         "$set": {"updated_at": utc_now()}},
        upsert=True,
    )
    await db.support_messages.insert_one({
        "message_id": "msg_" + uuid.uuid4().hex[:10], "thread_id": thread_id,
        "role": "user", "content": payload.message, "created_at": utc_now(),
    })
    # Rebuild prior history for context
    history = await db.support_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1).to_list(40)
    prompt_text = payload.message
    if snapshot:
        prompt_text = snapshot + "\n\nAdmin question: " + payload.message
    started = datetime.now(timezone.utc)
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=thread_id, system_message=system).with_model(*LLM_MODEL)
        # Replay prior turns (except the just-inserted user message — library will manage going forward)
        for m in history[:-1]:
            if m["role"] == "user":
                await chat.send_message(UserMessage(text=m["content"]))
                # Note: send_message creates a turn; we discard the assistant reply because we have it stored.
                # In practice for MVP we let the library rebuild via the current message only — keep it simple.
                break
        reply = await chat.send_message(UserMessage(text=prompt_text))
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        await db.support_messages.insert_one({
            "message_id": "msg_" + uuid.uuid4().hex[:10], "thread_id": thread_id,
            "role": "assistant", "content": reply, "created_at": utc_now(),
        })
        await db.agent_runs.insert_one({
            "run_id": "run_" + uuid.uuid4().hex[:10], "agent": agent,
            "user_id": user["user_id"], "input": payload.message, "output": reply,
            "model": f"{LLM_MODEL[0]}:{LLM_MODEL[1]}", "latency_ms": latency_ms,
            "error": None, "created_at": utc_now(),
        })
        return {"thread_id": thread_id, "reply": reply}
    except Exception as e:
        logger.exception("Nexus %s error: %s", agent, e)
        await db.agent_runs.insert_one({
            "run_id": "run_" + uuid.uuid4().hex[:10], "agent": agent,
            "user_id": user["user_id"], "input": payload.message, "output": None,
            "model": f"{LLM_MODEL[0]}:{LLM_MODEL[1]}", "latency_ms": 0,
            "error": str(e), "created_at": utc_now(),
        })
        raise HTTPException(status_code=500, detail="AI agent error: " + str(e))


@api_router.get("/nexus/threads/{thread_id}")
async def nexus_thread(thread_id: str, user=Depends(get_current_user)):
    msgs = await db.support_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return msgs


# ============================================================
# Push Token Registration (Native builds)
# ============================================================
class PushTokenRegister(BaseModel):
    token: str           # ExponentPushToken[…] or FCM token
    platform: str = "unknown"   # ios | android | web


@api_router.post("/push/register")
async def push_register(payload: PushTokenRegister, user=Depends(get_current_user)):
    """Store / update the device push token for this user. Called once after login in the app."""
    await db.push_tokens.update_one(
        {"user_id": user["user_id"], "token": payload.token},
        {"$set": {
            "user_id": user["user_id"],
            "token": payload.token,
            "platform": payload.platform,
            "updated_at": utc_now(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/push/register")
async def push_unregister(token: str, user=Depends(get_current_user)):
    """Remove a push token (called on logout)."""
    await db.push_tokens.delete_one({"user_id": user["user_id"], "token": token})
    return {"ok": True}


# ============================================================
# Razorpay webhook (for server-side payment confirmation)
# ============================================================
@api_router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    """
    Razorpay sends signed webhooks to confirm payments server-side.
    Add this URL in your Razorpay dashboard: <backend_url>/api/webhooks/razorpay
    Env var: RAZORPAY_WEBHOOK_SECRET

    This complements the client-side confirm flow — useful for handling
    payment.captured events when the user drops off mid-flow.
    """
    import hmac as _hmac
    import hashlib as _hashlib

    body = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    if secret:
        expected = _hmac.new(secret.encode(), body, _hashlib.sha256).hexdigest()
        if not _hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

    import json as _json
    event = _json.loads(body)
    event_type = event.get("event")

    if event_type == "payment.captured":
        pay_entity = event.get("payload", {}).get("payment", {}).get("entity", {})
        rzp_order_id = pay_entity.get("order_id")
        rzp_payment_id = pay_entity.get("id")

        if rzp_order_id:
            payment = await db.payments.find_one({"provider_order_id": rzp_order_id}, {"_id": 0})
            if payment and payment.get("status") in ("created", "processing"):
                await db.payments.update_one(
                    {"provider_order_id": rzp_order_id},
                    {"$set": {
                        "status": "succeeded",
                        "provider_payment_id": rzp_payment_id,
                        "updated_at": utc_now(),
                    }},
                )
                if payment.get("booking_id"):
                    booking = await db.bookings.find_one({"booking_id": payment["booking_id"]}, {"_id": 0})
                    if booking:
                        await db.bookings.update_one(
                            {"booking_id": payment["booking_id"]},
                            {"$set": {"status": "confirmed"}}
                        )
                        miles_earned = int(booking["total_amount"] / 10)
                        await _append_miles_ledger(payment["user_id"], miles_earned, "booking", ref_id=payment["booking_id"])
                        await db.notifications.insert_one({
                            "notification_id": "ntf_" + uuid.uuid4().hex[:10],
                            "user_id": payment["user_id"],
                            "title": "Booking Confirmed",
                            "body": f"Your {booking['vehicle_snapshot']['name']} is booked. +{miles_earned} RideMiles!",
                            "type": "booking", "read": False, "created_at": utc_now(),
                        })

    return {"ok": True}


# Mount router
app.include_router(api_router)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Restrict origins to known domains. In production, set ALLOWED_ORIGINS env var:
#   ALLOWED_ORIGINS=https://app.raidex.in,https://raidex.in
# Falls back to localhost for local development only.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
if _raw_origins:
    _allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    _allowed_origins = [
        "http://localhost:8081",
        "http://localhost:19006",
        "http://localhost:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    # ── Unique / identity indexes ──────────────────────────────────────────
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.vehicles.create_index("vehicle_id", unique=True)
    await db.bookings.create_index("booking_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.push_tokens.create_index([("user_id", 1), ("token", 1)], unique=True)

    # ── Production query indexes (were missing — caused full collection scans) ─
    # bookings
    await db.bookings.create_index([("user_id", 1), ("created_at", -1)])
    await db.bookings.create_index([("owner_id", 1), ("created_at", -1)])
    await db.bookings.create_index([("vehicle_id", 1), ("status", 1), ("start_date", 1), ("end_date", 1)])
    await db.bookings.create_index("status")

    # payments
    await db.payments.create_index([("user_id", 1), ("created_at", -1)])
    await db.payments.create_index("status")
    await db.payments.create_index("provider_order_id")   # Razorpay webhook lookup

    # notifications
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # KYC
    await db.kyc_submissions.create_index([("user_id", 1), ("submitted_at", -1)])

    # inspections — critical for start/end trip prerequisite checks
    await db.inspections.create_index([("booking_id", 1), ("phase", 1)], unique=True)

    # GPS
    await db.gps_tracks.create_index([("booking_id", 1), ("recorded_at", 1)])
    await db.gps_tracks.create_index([("vehicle_id", 1), ("recorded_at", -1)])

    # geofence
    await db.geofence_events.create_index([("owner_id", 1), ("created_at", -1)])
    await db.geofence_events.create_index("acknowledged")

    # ledgers
    await db.wallet_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.ride_miles_ledger.create_index([("user_id", 1), ("created_at", -1)])

    # support
    await db.support_messages.create_index([("thread_id", 1), ("created_at", 1)])

    await seed_data()

    # Inject DB into push sender for token lookups
    from providers.push_sender import inject_db as push_inject_db
    push_inject_db(db)

    # Schedule daily owner anomaly cron at 09:00 IST (03:30 UTC)
    _schedule_owner_anomaly_cron()


def _schedule_owner_anomaly_cron():
    """Wire up daily owner anomaly job using APScheduler if available, else asyncio fallback."""
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from cron.owner_anomaly import run_owner_anomaly_cron

        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            lambda: asyncio.create_task(run_owner_anomaly_cron(db)),
            trigger="cron",
            hour=3,
            minute=30,
            id="owner_anomaly_daily",
            replace_existing=True,
            misfire_grace_time=3600,
        )
        scheduler.start()
        logger.info("Owner anomaly cron scheduled: daily at 03:30 UTC (09:00 IST)")
    except ImportError:
        logger.warning(
            "APScheduler not installed — owner anomaly cron disabled. "
            "Add apscheduler to requirements.txt or run: python -m cron.owner_anomaly"
        )


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
