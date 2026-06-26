# RAIDEX_BACKEND_ENTRYPOINT
# Search tags: run backend, API routes, auth, KYC, payments, vehicles, bookings,
# owner dashboard, admin dashboard, websocket, health check.
# Start command: cd backend && uvicorn server:app --reload --host 0.0.0.0 --port 8000
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, WebSocket, WebSocketDisconnect, status
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
import bcrypt as _bcrypt_lib
import jwt as pyjwt
import httpx
import asyncio
try:
    import sentry_sdk
    from sentry_sdk.integrations.asgi import SentryAsgiMiddleware
except Exception:
    sentry_sdk = None
    SentryAsgiMiddleware = None

from providers import (
    get_payment_gateway, get_kyc_provider, get_damage_inspector, get_push_sender,
)
from features.booking import BookingService
from raidex_platform.analytics import AnalyticsEngine
from raidex_platform.audit import AuditLogger
from raidex_platform.events import DomainEvent, EventBus
from raidex_platform.feature_flags import FeatureFlagService
from raidex_platform.jobs import JobRunner, default_job_registry
from raidex_platform.notifications import NotificationService
from raidex_platform.observability import ObservabilityMetrics
from raidex_platform.pricing import DynamicPricingEngine
from raidex_platform.recommendations import RecommendationEngine
from providers.kyc_provider import KYCSubmission
from providers.push_sender import PushPayload

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

def _validate_env() -> None:
    env_name = os.environ.get("ENV", "development").lower()
    required = ["MONGO_URL", "DB_NAME"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    if env_name in ("production", "prod", "staging"):
        origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
        if not origins or any("localhost" in o or "127.0.0.1" in o for o in origins):
            raise RuntimeError("Production ALLOWED_ORIGINS must be explicitly set to deployed app domains")
        if os.environ.get("PAYMENT_PROVIDER", "mock").lower() == "mock":
            raise RuntimeError("Production PAYMENT_PROVIDER cannot be mock")
        if os.environ.get("KYC_PROVIDER", "stub").lower() == "stub":
            raise RuntimeError("Production KYC_PROVIDER cannot be stub")

_validate_env()
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
REFRESH_EXPIRE_DAYS = 60

def _hash_password(password: str) -> str:
    return _bcrypt_lib.hashpw(password.encode(), _bcrypt_lib.gensalt()).decode()

def _verify_password(password: str, hashed: str) -> bool:
    return _bcrypt_lib.checkpw(password.encode(), hashed.encode())

# ── Rate limiter (auth endpoints) ─────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Raidex API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

if os.getenv("SENTRY_DSN") and sentry_sdk:
    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        environment=os.getenv("ENV", "development"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
    )
    if SentryAsgiMiddleware:
        app.add_middleware(SentryAsgiMiddleware)

api_router = APIRouter(prefix="/api")

class RealtimeHub:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = {}

    async def connect(self, channel: str, websocket: WebSocket):
        await websocket.accept()
        self.connections.setdefault(channel, set()).add(websocket)

    def disconnect(self, channel: str, websocket: WebSocket):
        self.connections.get(channel, set()).discard(websocket)

    async def publish(self, channel: str, event: dict):
        stale: list[WebSocket] = []
        for websocket in list(self.connections.get(channel, set())):
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(channel, websocket)

realtime = RealtimeHub()
event_bus = EventBus(db)
job_registry = default_job_registry()


@app.middleware("http")
async def api_version_rewrite(request: Request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api/v1/") or path == "/api/v1":
        request.scope["path"] = "/api" + path.removeprefix("/api/v1")
    elif path.startswith("/api/v2/") or path == "/api/v2":
        request.scope["path"] = "/api" + path.removeprefix("/api/v2")
    return await call_next(request)


async def publish_event(user_id: str | None, event_type: str, payload: dict):
    event = {"type": event_type, "payload": payload, "created_at": utc_now()}
    if user_id:
        await realtime.publish(f"user:{user_id}", event)
    await realtime.publish("admin", event)


async def emit_domain_event(name: str, payload: dict, user_id: str | None = None) -> DomainEvent:
    event_bus.set_db(db)
    return await event_bus.publish(DomainEvent(name=name, payload=payload, user_id=user_id))


async def _analytics_event_subscriber(event: DomainEvent) -> None:
    await AnalyticsEngine(db).handle_domain_event(event)


async def _notification_event_subscriber(event: DomainEvent) -> None:
    titles = {
        "BookingCreated": "Booking Created",
        "BookingCancelled": "Booking Cancelled",
        "PaymentCompleted": "Payment Completed",
        "PaymentFailed": "Payment Failed",
        "KYCApproved": "KYC Approved",
        "VehicleApproved": "Vehicle Approved",
        "TripStarted": "Trip Started",
        "TripCompleted": "Trip Completed",
        "ReviewCreated": "Review Created",
        "ReferralUsed": "Referral Recorded",
        "CouponRedeemed": "Coupon Applied",
    }
    if not event.user_id or event.name not in titles:
        return
    await NotificationService(db, get_push_sender()).notify(
        user_id=event.user_id,
        title=titles[event.name],
        body=event.payload.get("message", "Your Raidex activity has been updated."),
        ntype=event.name,
    )


for _event_name in (
    "UserRegistered", "BookingCreated", "BookingCancelled", "PaymentCompleted",
    "PaymentFailed", "KYCApproved", "VehicleApproved", "TripStarted",
    "TripCompleted", "ReviewCreated", "ReferralUsed", "CouponRedeemed",
):
    event_bus.subscribe(_event_name, _analytics_event_subscriber)
    event_bus.subscribe(_event_name, _notification_event_subscriber)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or ("req_" + uuid.uuid4().hex[:12])
    started = datetime.now(timezone.utc)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request error", extra={"request_id": request_id, "path": request.url.path})
        raise
    elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    await ObservabilityMetrics(db).record_latency(
        metric="api.latency",
        elapsed_ms=elapsed_ms,
        tags={"method": request.method, "path": request.url.path, "status_code": response.status_code},
    )
    logger.info(
        "request",
        extra={"request_id": request_id, "method": request.method, "path": request.url.path,
               "status_code": response.status_code, "elapsed_ms": elapsed_ms},
    )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response

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
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user: dict

class GoogleSessionRequest(BaseModel):
    session_id: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

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

class BookingExtendRequest(BaseModel):
    end_date: str

class BookingCancelRequest(BaseModel):
    reason: str = Field(default="Customer requested cancellation", max_length=300)

class CompareRequest(BaseModel):
    vehicle_ids: List[str] = Field(min_length=2, max_length=4)

class ReviewCreate(BaseModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1000)

class CouponValidateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    amount: float = Field(gt=0)

class ReferralCreateRequest(BaseModel):
    referred_email: EmailStr

class DisputeCreateRequest(BaseModel):
    booking_id: str
    category: Literal["payment", "damage", "refund", "host", "vehicle", "other"] = "other"
    message: str = Field(min_length=10, max_length=1500)

class SignedUploadRequest(BaseModel):
    purpose: Literal["kyc", "inspection", "vehicle", "profile"]
    file_name: str = Field(min_length=3, max_length=180)
    content_type: str = Field(pattern=r"^(image|video|application)/(jpeg|jpg|png|webp|mp4|pdf)$")
    size_bytes: int = Field(gt=0, le=15_000_000)


class PricingQuoteRequest(BaseModel):
    vehicle_id: str
    start_date: str
    end_date: str
    demand_index: float = Field(default=1.0, ge=0.1, le=5)
    supply_index: float = Field(default=1.0, ge=0.1, le=5)
    festival: bool = False
    weather_risk: float = Field(default=0.0, ge=0, le=1)

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
        "jti": "atk_" + uuid.uuid4().hex,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def create_refresh_session(user: dict, request: Request) -> str:
    refresh_token = "rft_" + uuid.uuid4().hex + uuid.uuid4().hex
    await db.device_sessions.insert_one({
        "session_id": "ses_" + uuid.uuid4().hex[:12],
        "user_id": user["user_id"],
        "refresh_token": refresh_token,
        "user_agent": request.headers.get("user-agent", "unknown")[:300],
        "ip": get_remote_address(request),
        "revoked": False,
        "created_at": utc_now(),
        "last_seen_at": utc_now(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS)).isoformat(),
    })
    return refresh_token


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid auth header")
    token = authorization.split(" ", 1)[1].strip()

    # Try JWT first
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("uid")
        jti = payload.get("jti")
        if jti:
            revoked = await db.revoked_tokens.find_one({"jti": jti}, {"_id": 0})
            if revoked:
                raise HTTPException(status_code=401, detail="Token revoked")
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
        admin_password = admin_password[:72]  # bcrypt max is 72 bytes
        await db.users.insert_one({
            "user_id": "usr_admin0001", "email": admin_email,
            "name": "Raidex Admin", "password_hash": _hash_password(admin_password),
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


@api_router.get("/health")
@api_router.head("/health")
async def health():
    """Load balancer / uptime probe."""
    try:
        await db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    status = "ok" if db_ok else "degraded"
    return {"status": status, "database": "connected" if db_ok else "unreachable"}


@api_router.get("/config")
async def public_config():
    """Public client config (no secrets)."""
    payment_provider = os.getenv("PAYMENT_PROVIDER", "mock").lower()
    key_id = os.getenv("RAZORPAY_KEY_ID", "")
    return {
        "payment_provider": payment_provider,
        "push_provider": os.getenv("PUSH_PROVIDER", "log").lower(),
        "kyc_provider": os.getenv("KYC_PROVIDER", "stub").lower(),
        "razorpay_key_id": key_id if payment_provider == "razorpay" and key_id.startswith("rzp_") else None,
    }


@api_router.post("/media/signed-upload")
async def create_signed_upload(payload: SignedUploadRequest, user=Depends(get_current_user)):
    provider = os.getenv("MEDIA_PROVIDER", "local-signed").lower()
    asset_id = "med_" + uuid.uuid4().hex[:12]
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", payload.file_name)[:120]
    object_key = f"{payload.purpose}/{user['user_id']}/{asset_id}_{safe_name}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    # Provider adapters can replace this with Cloudinary/S3 signed URLs. The contract is production-safe:
    # the app uploads directly to storage, then confirms the resulting asset URL.
    upload_url = os.getenv("MEDIA_UPLOAD_BASE_URL", "https://storage.example.invalid/upload").rstrip("/") + f"/{object_key}"
    public_url = os.getenv("MEDIA_PUBLIC_BASE_URL", "https://storage.example.invalid").rstrip("/") + f"/{object_key}"
    doc = {
        "asset_id": asset_id,
        "user_id": user["user_id"],
        "purpose": payload.purpose,
        "provider": provider,
        "object_key": object_key,
        "content_type": payload.content_type,
        "size_bytes": payload.size_bytes,
        "status": "pending",
        "public_url": public_url,
        "created_at": utc_now(),
        "expires_at": expires_at.isoformat(),
    }
    await db.media_assets.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "upload_url": upload_url, "headers": {"Content-Type": payload.content_type}}


@api_router.post("/media/{asset_id}/confirm")
async def confirm_media_upload(asset_id: str, body: dict, user=Depends(get_current_user)):
    asset = await db.media_assets.find_one({"asset_id": asset_id, "user_id": user["user_id"]}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Media asset not found")
    public_url = str(body.get("public_url") or asset["public_url"])[:1000]
    await db.media_assets.update_one({"asset_id": asset_id}, {"$set": {"status": "uploaded", "public_url": public_url, "uploaded_at": utc_now()}})
    return await db.media_assets.find_one({"asset_id": asset_id}, {"_id": 0})


@api_router.websocket("/ws")
async def websocket_events(websocket: WebSocket, token: Optional[str] = None, channel: Optional[str] = None):
    resolved_channel = "admin" if channel == "admin" else None
    if token:
      try:
          payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
          resolved_channel = f"user:{payload.get('uid')}"
      except pyjwt.PyJWTError:
          await websocket.close(code=4401)
          return
    if not resolved_channel:
        await websocket.close(code=4401)
        return
    await realtime.connect(resolved_channel, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        realtime.disconnect(resolved_channel, websocket)


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
        "password_hash": _hash_password(payload.password),
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
    refresh_token = await create_refresh_session(user_doc, request)
    await emit_domain_event("UserRegistered", {"email": email, "message": "Welcome to Raidex."}, user_id)
    return TokenResp(access_token=token, refresh_token=refresh_token, user=serialize_user(user_doc))


@api_router.post("/auth/login", response_model=TokenResp)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    token = create_token(user["user_id"], email)
    refresh_token = await create_refresh_session(user, request)
    return TokenResp(access_token=token, refresh_token=refresh_token, user=serialize_user(user))


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
    token = create_token(user["user_id"], email)
    refresh_token = await create_refresh_session(user, request)
    return TokenResp(access_token=token, refresh_token=refresh_token, user=serialize_user(user))


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return serialize_user(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            if payload.get("jti"):
                await db.revoked_tokens.update_one(
                    {"jti": payload["jti"]},
                    {"$set": {"jti": payload["jti"], "user_id": payload.get("uid"), "revoked_at": utc_now()}},
                    upsert=True,
                )
        except pyjwt.PyJWTError:
            pass
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api_router.post("/auth/refresh", response_model=TokenResp)
async def refresh_token(payload: RefreshTokenRequest, request: Request):
    session = await db.device_sessions.find_one({"refresh_token": payload.refresh_token, "revoked": False}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    exp = datetime.fromisoformat(session["expires_at"].replace("Z", "+00:00"))
    if exp <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    await db.device_sessions.update_one({"session_id": session["session_id"]}, {"$set": {
        "last_seen_at": utc_now(),
        "ip": get_remote_address(request),
        "user_agent": request.headers.get("user-agent", "unknown")[:300],
    }})
    return TokenResp(access_token=create_token(user["user_id"], user["email"]), refresh_token=payload.refresh_token, user=serialize_user(user))


@api_router.get("/auth/sessions")
async def list_sessions(user=Depends(get_current_user)):
    return await db.device_sessions.find({"user_id": user["user_id"]}, {"_id": 0, "refresh_token": 0}).sort("last_seen_at", -1).to_list(20)


@api_router.post("/auth/sessions/{session_id}/revoke")
async def revoke_session(session_id: str, user=Depends(get_current_user)):
    await db.device_sessions.update_one({"session_id": session_id, "user_id": user["user_id"]}, {"$set": {"revoked": True, "revoked_at": utc_now()}})
    return {"ok": True}



# ============================================================
# KYC (Slice 2)
# ============================================================
class KYCSubmitRequest(BaseModel):
    aadhaar_front: str = Field(min_length=3, max_length=2000)
    aadhaar_back: str = Field(min_length=3, max_length=2000)
    aadhaar_last4: str = Field(pattern=r"^\d{4}$")
    dl_front: str = Field(min_length=3, max_length=2000)
    dl_back: str = Field(min_length=3, max_length=2000)
    dl_number: str = Field(min_length=6, max_length=40)
    dl_expiry: str = ""
    face_selfie: str = Field(min_length=3, max_length=2000)


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
        await publish_event(user_id, "kyc.updated", {"kyc_id": kyc_id, "status": result.status, "title": title})
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
    idempotency_key: Optional[str] = Field(default=None, max_length=120)


class PaymentConfirmRequest(BaseModel):
    force_outcome: Optional[Literal["success", "failure"]] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


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
    if payload.idempotency_key:
        existing_payment = await db.payments.find_one(
            {"user_id": user["user_id"], "idempotency_key": payload.idempotency_key},
            {"_id": 0},
        )
        if existing_payment:
            return existing_payment
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
        "idempotency_key": payload.idempotency_key,
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
    is_mock = p.get("provider") == "mock"
    # Honour test override on Mock gateway only:
    if is_mock and payload.force_outcome == "failure":
        result_success = False
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(False, None, None, "Test mode: forced failure")
    elif is_mock and payload.force_outcome == "success":
        from providers.payment_gateway import PaymentResult
        result = PaymentResult(True, "pay_mock_" + uuid.uuid4().hex[:10], "sig_mock", None)
        result_success = True
    else:
        result = await gateway.confirm(
            order_id=p["provider_order_id"],
            provider_payment_id=payload.razorpay_payment_id,
            provider_signature=payload.razorpay_signature,
        )
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
                await publish_event(user["user_id"], "booking.confirmed", {"booking_id": p["booking_id"], "payment_id": payment_id})
                await emit_domain_event("PaymentCompleted", {"payment_id": payment_id, "booking_id": p["booking_id"], "amount": p["amount"]}, user["user_id"])
        elif p["purpose"] == "wallet_topup":
            await _append_wallet_ledger(user["user_id"], p["amount"], "topup", payment_id=payment_id)
            await publish_event(user["user_id"], "wallet.topped_up", {"payment_id": payment_id, "amount": p["amount"]})
            await emit_domain_event("PaymentCompleted", {"payment_id": payment_id, "amount": p["amount"], "purpose": "wallet_topup"}, user["user_id"])
    else:
        await db.payments.update_one({"payment_id": payment_id}, {"$set": {
            "status": "failed",
            "failure_reason": result.failure_reason,
            "updated_at": utc_now(),
        }})
        await publish_event(user["user_id"], "payment.failed", {"payment_id": payment_id, "reason": result.failure_reason})
        await emit_domain_event("PaymentFailed", {"payment_id": payment_id, "reason": result.failure_reason}, user["user_id"])

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
    max_price: Optional[float] = None,
    max_distance: Optional[float] = None,
    fuel_type: Optional[str] = None,
    transmission: Optional[str] = None,
    min_rating: Optional[float] = None,
    available: Optional[bool] = True,
    instant_book: Optional[bool] = None,
    user=Depends(get_current_user),
):
    query = {"available": available is not False}
    inferred_q = q.strip()[:100] if q else ""
    q_lower = inferred_q.lower()
    if q_lower:
        if "bike" in q_lower or "scooter" in q_lower:
            type = "bike"
        elif "car" in q_lower or "suv" in q_lower:
            type = "car"
        price_match = re.search(r"(?:under|below|less than|<=?)\s*(?:rs\.?|inr|₹)?\s*(\d+)", q_lower)
        if price_match and max_price is None:
            max_price = float(price_match.group(1))
        distance_match = re.search(r"(?:within|under|below|<=?)\s*(\d+(?:\.\d+)?)\s*km", q_lower)
        if distance_match and max_distance is None:
            max_distance = float(distance_match.group(1))
    if type and type in ("car", "bike"):
        query["type"] = type
    if max_price is not None:
        query["price_per_day"] = {"$lte": max_price}
    if max_distance is not None:
        query["distance_km"] = {"$lte": max_distance}
    if fuel_type:
        query["fuel_type"] = {"$regex": f"^{re.escape(fuel_type.strip())}$", "$options": "i"}
    if transmission:
        query["transmission"] = {"$regex": f"^{re.escape(transmission.strip())}$", "$options": "i"}
    if min_rating is not None:
        query["rating"] = {"$gte": min_rating}
    if instant_book is not None:
        query["instant_book"] = instant_book
    if q:
        # re.escape prevents ReDoS — user input must not be treated as a raw regex
        safe_q = re.escape(q.strip()[:100])
        query["$or"] = [
            {"name": {"$regex": safe_q, "$options": "i"}},
            {"brand": {"$regex": safe_q, "$options": "i"}},
            {"model": {"$regex": safe_q, "$options": "i"}},
            {"location": {"$regex": safe_q, "$options": "i"}},
        ]
    cursor = db.vehicles.find(query, {"_id": 0})
    items = await cursor.to_list(200)
    for item in items:
        verification = 100 if item.get("verification_status", "approved") == "approved" else 60
        rating_score = min(100, float(item.get("rating", 0)) * 20)
        history_score = min(100, int(item.get("trips", 0)) * 2)
        doc_score = 100 if item.get("documents_verified", True) else 60
        trust_score = round((verification * 0.35) + (rating_score * 0.3) + (history_score * 0.2) + (doc_score * 0.15))
        item["trust_score"] = trust_score
        item["safety_score"] = max(70, min(99, trust_score - 2 + (5 if item.get("fuel_type") == "EV" else 0)))
        item["instant_book"] = item.get("instant_book", True)
        item["owner_profile"] = {
            "name": item.get("host_name", "Raidex Host"),
            "avatar": item.get("host_avatar", ""),
            "verification_badges": ["ID verified", "Vehicle verified"] if item.get("verification_status", "approved") == "approved" else ["Review pending"],
            "response_time": item.get("owner_response_time", "Usually replies in 10 min"),
            "rental_count": item.get("trips", 0),
            "joined_at": item.get("created_at", "2025-01-01T00:00:00+00:00"),
        }
        item["vehicle_history"] = {
            "previous_rentals": item.get("trips", 0),
            "inspection_status": "Clean latest inspection",
            "last_maintenance_date": item.get("last_maintenance_date", "2026-05-15"),
        }
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
    await db.recently_viewed.update_one(
        {"user_id": user["user_id"], "vehicle_id": vehicle_id},
        {"$set": {"user_id": user["user_id"], "vehicle_id": vehicle_id, "vehicle_snapshot": {
            "name": v["name"], "image": v["image"], "location": v["location"],
            "price_per_day": v["price_per_day"], "rating": v.get("rating", 0),
        }, "viewed_at": utc_now()}},
        upsert=True,
    )
    return v


@api_router.get("/vehicles/{vehicle_id}/availability")
async def vehicle_availability(vehicle_id: str, start_date: str, end_date: str, user=Depends(get_current_user)):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    try:
        start = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if end <= start:
        raise HTTPException(status_code=400, detail="End date must be after start date")
    conflict = await db.bookings.find_one({
        "vehicle_id": vehicle_id,
        "status": {"$in": ["confirmed", "active"]},
        "start_date": {"$lt": end_date},
        "end_date": {"$gt": start_date},
    }, {"_id": 0, "booking_id": 1, "start_date": 1, "end_date": 1})
    return {"vehicle_id": vehicle_id, "available": bool(v.get("available", False)) and conflict is None,
            "conflict": conflict}


@api_router.get("/vehicles/{vehicle_id}/reviews")
async def vehicle_reviews(vehicle_id: str, user=Depends(get_current_user)):
    items = await db.reviews.find({"vehicle_id": vehicle_id}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return items


@api_router.post("/vehicles/{vehicle_id}/reviews")
async def create_vehicle_review(vehicle_id: str, payload: ReviewCreate, user=Depends(get_current_user)):
    booking = await db.bookings.find_one({
        "booking_id": payload.booking_id,
        "vehicle_id": vehicle_id,
        "user_id": user["user_id"],
        "status": "completed",
    }, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=403, detail="Only completed trips can be reviewed")
    existing = await db.reviews.find_one({"booking_id": payload.booking_id, "user_id": user["user_id"]}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Review already submitted for this booking")
    review = {
        "review_id": "rev_" + uuid.uuid4().hex[:12],
        "booking_id": payload.booking_id,
        "vehicle_id": vehicle_id,
        "user_id": user["user_id"],
        "user_name": user["name"],
        "rating": payload.rating,
        "comment": payload.comment.strip(),
        "created_at": utc_now(),
    }
    await db.reviews.insert_one(review)
    stats = await db.reviews.find({"vehicle_id": vehicle_id}, {"rating": 1, "_id": 0}).to_list(10000)
    avg = round(sum(r["rating"] for r in stats) / max(1, len(stats)), 2)
    await db.vehicles.update_one({"vehicle_id": vehicle_id}, {"$set": {"rating": avg}})
    review.pop("_id", None)
    await emit_domain_event("ReviewCreated", {"review_id": review["review_id"], "vehicle_id": vehicle_id, "rating": payload.rating}, user["user_id"])
    return review


@api_router.get("/wishlist")
async def get_wishlist(user=Depends(get_current_user)):
    items = await db.wishlist.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@api_router.post("/wishlist/{vehicle_id}")
async def add_wishlist(vehicle_id: str, user=Depends(get_current_user)):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    doc = {"user_id": user["user_id"], "vehicle_id": vehicle_id,
           "vehicle_snapshot": {"name": v["name"], "image": v["image"], "location": v["location"],
                                "price_per_day": v["price_per_day"], "rating": v.get("rating", 0)},
           "created_at": utc_now()}
    await db.wishlist.update_one({"user_id": user["user_id"], "vehicle_id": vehicle_id}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api_router.delete("/wishlist/{vehicle_id}")
async def remove_wishlist(vehicle_id: str, user=Depends(get_current_user)):
    await db.wishlist.delete_one({"user_id": user["user_id"], "vehicle_id": vehicle_id})
    return {"ok": True}


@api_router.get("/recently-viewed")
async def recently_viewed(user=Depends(get_current_user)):
    return await db.recently_viewed.find({"user_id": user["user_id"]}, {"_id": 0}).sort("viewed_at", -1).limit(20).to_list(20)


@api_router.post("/vehicles/compare")
async def compare_vehicles(payload: CompareRequest, user=Depends(get_current_user)):
    ids = list(dict.fromkeys(payload.vehicle_ids))
    items = await db.vehicles.find({"vehicle_id": {"$in": ids}}, {"_id": 0}).to_list(4)
    if len(items) != len(ids):
        raise HTTPException(status_code=404, detail="One or more vehicles were not found")
    order = {vid: idx for idx, vid in enumerate(ids)}
    items.sort(key=lambda v: order[v["vehicle_id"]])
    return {"items": items}


# ---------- Bookings ----------
@api_router.post("/bookings")
async def create_booking(payload: BookingCreate, user=Depends(get_current_user)):
    booking = await BookingService(db, utc_now).create_booking(payload, user)
    await emit_domain_event("BookingCreated", {"booking_id": booking["booking_id"], "vehicle_id": booking["vehicle_id"]}, user["user_id"])
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
    await emit_domain_event("TripStarted", {"booking_id": booking_id}, user["user_id"])
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
    await emit_domain_event("TripCompleted", {"booking_id": booking_id, "miles_earned": miles_traveled}, user["user_id"])
    return {"ok": True, "status": "completed", "miles_earned": miles_traveled, "distance_km": miles_traveled,
            "ai_verdict": (after.get("damage_comparison") or {}).get("verdict", "clean")}


@api_router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, payload: BookingCancelRequest, user=Depends(get_current_user)):
    result = await BookingService(db, utc_now).cancel_booking(booking_id, payload, user)
    await emit_domain_event("BookingCancelled", {"booking_id": booking_id, "refund_due": result["refund_due"], "message": "Your booking was cancelled."}, user["user_id"])
    return result


@api_router.post("/bookings/{booking_id}/extend")
async def extend_booking(booking_id: str, payload: BookingExtendRequest, user=Depends(get_current_user)):
    return await BookingService(db, utc_now).extend_booking(booking_id, payload, user)


@api_router.get("/bookings/{booking_id}/invoice")
async def booking_invoice(booking_id: str, gst: bool = False, user=Depends(get_current_user)):
    return await BookingService(db, utc_now).invoice(booking_id, gst, user)


@api_router.post("/bookings/{booking_id}/disputes")
async def create_dispute(booking_id: str, payload: DisputeCreateRequest, user=Depends(get_current_user)):
    return await BookingService(db, utc_now).create_dispute(booking_id, payload, user)


@api_router.post("/coupons/validate")
async def validate_coupon(payload: CouponValidateRequest, user=Depends(get_current_user)):
    code = payload.code.strip().upper()
    built_ins = {
        "RAIDEX10": {"type": "percent", "value": 10, "max_discount": 500},
        "FIRST100": {"type": "flat", "value": 100, "max_discount": 100},
    }
    coupon = await db.coupons.find_one({"code": code, "active": True}, {"_id": 0}) or built_ins.get(code)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found or expired")
    if coupon["type"] == "percent":
        discount = min(round(payload.amount * (coupon["value"] / 100), 2), coupon.get("max_discount", payload.amount))
    else:
        discount = min(float(coupon["value"]), payload.amount)
    result = {"code": code, "valid": True, "discount": discount, "payable": round(payload.amount - discount, 2)}
    await emit_domain_event("CouponRedeemed", {"code": code, "discount": discount}, user["user_id"] if isinstance(user, dict) else None)
    return result


@api_router.post("/referrals")
async def create_referral(payload: ReferralCreateRequest, user=Depends(get_current_user)):
    if payload.referred_email.lower() == user["email"].lower():
        raise HTTPException(status_code=400, detail="You cannot refer yourself")
    doc = {
        "referral_id": "ref_" + uuid.uuid4().hex[:12],
        "referrer_user_id": user["user_id"],
        "referred_email": payload.referred_email.lower(),
        "status": "invited",
        "reward_miles": 500,
        "created_at": utc_now(),
    }
    await db.referrals.update_one(
        {"referrer_user_id": user["user_id"], "referred_email": payload.referred_email.lower()},
        {"$setOnInsert": doc},
        upsert=True,
    )
    saved = await db.referrals.find_one({"referrer_user_id": user["user_id"], "referred_email": payload.referred_email.lower()}, {"_id": 0})
    await emit_domain_event("ReferralUsed", {"referral_id": saved.get("referral_id"), "referred_email": saved.get("referred_email")}, user["user_id"])
    return saved


@api_router.get("/referrals")
async def list_referrals(user=Depends(get_current_user)):
    return await db.referrals.find({"referrer_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


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

class VehicleHealthUpdate(BaseModel):
    insurance_expiry: Optional[str] = None
    puc_expiry: Optional[str] = None
    rc_expiry: Optional[str] = None
    service_due_date: Optional[str] = None
    odometer_km: Optional[float] = None
    notes: str = Field(default="", max_length=1000)


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


@api_router.get("/owner/fleet-health")
async def owner_fleet_health(user=Depends(get_current_user)):
    _require_role(user, "owner")
    vehicles = await db.vehicles.find({"owner_id": user["user_id"]}, {"_id": 0}).to_list(200)
    today = datetime.now(timezone.utc).date()
    rows = []
    for v in vehicles:
        health = v.get("health", {})
        alerts = []
        for key, label in (
            ("insurance_expiry", "Insurance"),
            ("puc_expiry", "PUC"),
            ("rc_expiry", "RC"),
            ("service_due_date", "Service"),
        ):
            value = health.get(key)
            if value:
                try:
                    days = (datetime.fromisoformat(value.replace("Z", "+00:00")).date() - today).days
                    if days < 0:
                        alerts.append(f"{label} expired")
                    elif days <= 30:
                        alerts.append(f"{label} due in {days}d")
                except Exception:
                    alerts.append(f"{label} date invalid")
            else:
                alerts.append(f"{label} missing")
        score = max(40, 100 - (len(alerts) * 12))
        rows.append({
            "vehicle_id": v["vehicle_id"],
            "name": v["name"],
            "image": v.get("image"),
            "health_score": score,
            "alerts": alerts,
            "health": health,
        })
    return rows


@api_router.patch("/owner/vehicles/{vehicle_id}/health")
async def owner_update_vehicle_health(vehicle_id: str, payload: VehicleHealthUpdate, user=Depends(get_current_user)):
    _require_role(user, "owner")
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id, "owner_id": user["user_id"]}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    health = {k: val for k, val in payload.model_dump().items() if val not in (None, "")}
    health["updated_at"] = utc_now()
    await db.vehicles.update_one({"vehicle_id": vehicle_id, "owner_id": user["user_id"]}, {"$set": {"health": health}})
    return await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})


@api_router.get("/owner/calendar")
async def owner_calendar(user=Depends(get_current_user)):
    _require_role(user, "owner")
    bookings = await db.bookings.find({"owner_id": user["user_id"]}, {"_id": 0}).sort("start_date", 1).limit(200).to_list(200)
    return [{
        "booking_id": b["booking_id"],
        "vehicle_id": b["vehicle_id"],
        "vehicle": b.get("vehicle_snapshot", {}).get("name"),
        "start_date": b["start_date"],
        "end_date": b["end_date"],
        "status": b["status"],
        "amount": b.get("total_amount", 0),
    } for b in bookings]


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
    await AuditLogger(db).log(actor_id=user["user_id"], action="vehicle.approve", target_type="vehicle", target_id=vehicle_id, after={"verification_status": "approved"})
    await emit_domain_event("VehicleApproved", {"vehicle_id": vehicle_id}, user["user_id"])
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


@api_router.get("/admin/kyc")
async def admin_kyc(status: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if status:
        filt["status"] = status
    return await db.kyc_submissions.find(
        filt,
        {"_id": 0, "aadhaar_front": 0, "aadhaar_back": 0, "dl_front": 0, "dl_back": 0, "face_selfie": 0},
    ).sort("submitted_at", -1).limit(100).to_list(100)


@api_router.post("/admin/kyc/{kyc_id}/approve")
async def admin_approve_kyc(kyc_id: str, user=Depends(get_current_user)):
    _require_role(user, "admin")
    sub = await db.kyc_submissions.find_one({"kyc_id": kyc_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="KYC submission not found")
    await db.kyc_submissions.update_one({"kyc_id": kyc_id}, {"$set": {"status": "verified", "reviewed_at": utc_now(), "reviewed_by": user["user_id"]}})
    await db.users.update_one({"user_id": sub["user_id"]}, {"$set": {"kyc_status": "verified"}})
    await db.admin_audit.insert_one({"audit_id": "aud_" + uuid.uuid4().hex[:10], "admin_id": user["user_id"],
                                      "action": "kyc.approve", "target_type": "kyc", "target_id": kyc_id,
                                      "before_state": {"status": sub.get("status")}, "after_state": {"status": "verified"},
                                      "created_at": utc_now()})
    await AuditLogger(db).log(actor_id=user["user_id"], action="kyc.approve", target_type="kyc", target_id=kyc_id, before={"status": sub.get("status")}, after={"status": "verified"})
    await emit_domain_event("KYCApproved", {"kyc_id": kyc_id, "target_user_id": sub["user_id"]}, sub["user_id"])
    return {"ok": True}


@api_router.post("/admin/kyc/{kyc_id}/reject")
async def admin_reject_kyc(kyc_id: str, body: dict, user=Depends(get_current_user)):
    _require_role(user, "admin")
    sub = await db.kyc_submissions.find_one({"kyc_id": kyc_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="KYC submission not found")
    reason = str(body.get("reason") or "Documents could not be verified")[:300]
    await db.kyc_submissions.update_one({"kyc_id": kyc_id}, {"$set": {"status": "rejected", "rejection_reason": reason, "reviewed_at": utc_now(), "reviewed_by": user["user_id"]}})
    await db.users.update_one({"user_id": sub["user_id"]}, {"$set": {"kyc_status": "rejected"}})
    await db.admin_audit.insert_one({"audit_id": "aud_" + uuid.uuid4().hex[:10], "admin_id": user["user_id"],
                                      "action": "kyc.reject", "target_type": "kyc", "target_id": kyc_id,
                                      "before_state": {"status": sub.get("status")}, "after_state": {"status": "rejected", "reason": reason},
                                      "created_at": utc_now()})
    return {"ok": True}


@api_router.get("/admin/disputes")
async def admin_disputes(status: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    filt = {}
    if status:
        filt["status"] = status
    return await db.disputes.find(filt, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)


@api_router.patch("/admin/disputes/{dispute_id}")
async def admin_update_dispute(dispute_id: str, body: dict, user=Depends(get_current_user)):
    _require_role(user, "admin")
    status_value = body.get("status")
    if status_value not in ("open", "investigating", "resolved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid dispute status")
    update = {"status": status_value, "updated_at": utc_now(), "reviewed_by": user["user_id"]}
    if body.get("resolution"):
        update["resolution"] = str(body["resolution"])[:1000]
    await db.disputes.update_one({"dispute_id": dispute_id}, {"$set": update})
    await db.admin_audit.insert_one({"audit_id": "aud_" + uuid.uuid4().hex[:10], "admin_id": user["user_id"],
                                      "action": "dispute.update", "target_type": "dispute", "target_id": dispute_id,
                                      "before_state": None, "after_state": update, "created_at": utc_now()})
    return await db.disputes.find_one({"dispute_id": dispute_id}, {"_id": 0})


@api_router.get("/admin/system-health")
async def admin_system_health(user=Depends(get_current_user)):
    _require_role(user, "admin")
    db_ok = True
    try:
        await db.command("ping")
    except Exception:
        db_ok = False
    return {
        "database": "connected" if db_ok else "unreachable",
        "payment_provider": os.getenv("PAYMENT_PROVIDER", "mock").lower(),
        "kyc_provider": os.getenv("KYC_PROVIDER", "stub").lower(),
        "push_provider": os.getenv("PUSH_PROVIDER", "log").lower(),
        "llm_configured": bool(EMERGENT_LLM_KEY),
        "open_disputes": await db.disputes.count_documents({"status": {"$in": ["open", "investigating"]}}),
        "failed_payments_24h": await db.payments.count_documents({"status": "failed"}),
        "pending_kyc": await db.kyc_submissions.count_documents({"status": {"$in": ["processing", "submitted"]}}),
        "checked_at": utc_now(),
    }


@api_router.get("/admin/fraud/risk")
async def admin_fraud_risk(user_id: Optional[str] = None, user=Depends(get_current_user)):
    _require_role(user, "admin")
    users = await db.users.find({"user_id": user_id} if user_id else {}, {"_id": 0, "password_hash": 0}).limit(100).to_list(100)
    rows = []
    for u in users:
        uid = u["user_id"]
        failed_payments = await db.payments.count_documents({"user_id": uid, "status": "failed"})
        rejected_kyc = await db.kyc_submissions.count_documents({"user_id": uid, "status": "rejected"})
        cancellations = await db.bookings.count_documents({"user_id": uid, "status": "cancelled"})
        disputes = await db.disputes.count_documents({"user_id": uid, "status": {"$in": ["open", "investigating"]}})
        sessions = await db.device_sessions.count_documents({"user_id": uid, "revoked": False})
        risk_score = min(100, failed_payments * 12 + rejected_kyc * 20 + cancellations * 8 + disputes * 15 + max(0, sessions - 3) * 5)
        flags = []
        if failed_payments >= 3:
            flags.append("multiple_failed_payments")
        if rejected_kyc:
            flags.append("kyc_rejection")
        if cancellations >= 3:
            flags.append("excessive_cancellations")
        if sessions > 3:
            flags.append("many_active_devices")
        rows.append({
            "user_id": uid,
            "email": u.get("email"),
            "name": u.get("name"),
            "risk_score": risk_score,
            "risk_level": "high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low",
            "flags": flags,
            "metrics": {
                "failed_payments": failed_payments,
                "rejected_kyc": rejected_kyc,
                "cancellations": cancellations,
                "open_disputes": disputes,
                "active_sessions": sessions,
            },
        })
    rows.sort(key=lambda r: r["risk_score"], reverse=True)
    return rows


# ============================================================
@api_router.get("/admin/analytics/dashboard")
async def admin_analytics_dashboard(user=Depends(get_current_user)):
    _require_role(user, "admin")
    return await AnalyticsEngine(db).admin_dashboard()


@api_router.get("/admin/observability/dashboard")
async def admin_observability_dashboard(user=Depends(get_current_user)):
    _require_role(user, "admin")
    return await ObservabilityMetrics(db).dashboard()


@api_router.get("/admin/jobs")
async def admin_jobs(user=Depends(get_current_user)):
    _require_role(user, "admin")
    return {"jobs": job_registry.list_jobs()}


@api_router.post("/admin/notifications/retry-failed")
async def admin_retry_failed_notifications(user=Depends(get_current_user)):
    _require_role(user, "admin")
    retried = await NotificationService(db, get_push_sender()).retry_failed()
    return {"retried": retried}


@api_router.get("/features/{flag}")
async def feature_enabled(flag: str, user=Depends(get_current_user)):
    enabled = await FeatureFlagService(db).enabled(flag, user)
    return {"flag": flag, "enabled": enabled}


@api_router.get("/recommendations/vehicles")
async def recommended_vehicles(location: Optional[str] = None, budget: Optional[float] = None, duration_days: int = 1, user=Depends(get_current_user)):
    return {"items": await RecommendationEngine(db).recommend(user, location=location, budget=budget, duration_days=duration_days)}


@api_router.post("/pricing/quote")
async def pricing_quote(payload: PricingQuoteRequest, user=Depends(get_current_user)):
    vehicle = await db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    quote = DynamicPricingEngine().quote(
        vehicle,
        start_date=payload.start_date,
        end_date=payload.end_date,
        demand_index=payload.demand_index,
        supply_index=payload.supply_index,
        festival=payload.festival,
        weather_risk=payload.weather_risk,
    )
    await db.pricing_quotes.insert_one({"user_id": user["user_id"], **payload.dict(), "quote": quote, "created_at": utc_now()})
    return quote
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
    event_id = event.get("id") or event.get("event_id") or _hashlib.sha256(body).hexdigest()
    existing_event = await db.webhook_events.find_one({"event_id": event_id, "provider": "razorpay"}, {"_id": 0})
    if existing_event:
        return {"ok": True, "deduped": True}
    await db.webhook_events.insert_one({
        "event_id": event_id,
        "provider": "razorpay",
        "event_type": event_type,
        "received_at": utc_now(),
        "processed": False,
    })

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

    await db.webhook_events.update_one({"event_id": event_id, "provider": "razorpay"}, {"$set": {"processed": True, "processed_at": utc_now()}})
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
    await db.revoked_tokens.create_index("jti", unique=True)
    await db.device_sessions.create_index("refresh_token", unique=True)
    await db.device_sessions.create_index([("user_id", 1), ("last_seen_at", -1)])
    await db.vehicles.create_index("vehicle_id", unique=True)
    await db.vehicles.create_index([("owner_id", 1), ("created_at", -1)])
    await db.vehicles.create_index([("available", 1), ("type", 1), ("price_per_day", 1)])
    await db.vehicles.create_index([("distance_km", 1), ("rating", -1)])
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
    await db.payments.create_index([("user_id", 1), ("idempotency_key", 1)], unique=True, sparse=True)
    await db.payments.create_index("status")
    await db.payments.create_index("provider_order_id")   # Razorpay webhook lookup
    await db.webhook_events.create_index([("provider", 1), ("event_id", 1)], unique=True)

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

    # customer product surfaces
    await db.wishlist.create_index([("user_id", 1), ("vehicle_id", 1)], unique=True)
    await db.wishlist.create_index([("user_id", 1), ("created_at", -1)])
    await db.recently_viewed.create_index([("user_id", 1), ("vehicle_id", 1)], unique=True)
    await db.recently_viewed.create_index([("user_id", 1), ("viewed_at", -1)])
    await db.reviews.create_index([("vehicle_id", 1), ("created_at", -1)])
    await db.reviews.create_index([("booking_id", 1), ("user_id", 1)], unique=True)
    await db.disputes.create_index([("user_id", 1), ("created_at", -1)])
    await db.disputes.create_index([("status", 1), ("created_at", -1)])
    await db.referrals.create_index([("referrer_user_id", 1), ("referred_email", 1)], unique=True)
    await db.coupons.create_index("code", unique=True)
    await db.media_assets.create_index([("user_id", 1), ("created_at", -1)])
    await db.media_assets.create_index("asset_id", unique=True)

    # support
    await db.support_messages.create_index([("thread_id", 1), ("created_at", 1)])

    # platform services
    await db.event_log.create_index([("name", 1), ("occurred_at", -1)])
    await db.event_failures.create_index([("name", 1), ("occurred_at", -1)])
    await db.notification_outbox.create_index([("status", 1), ("next_attempt_at", 1)])
    await db.notification_preferences.create_index([("user_id", 1)], unique=True)
    await db.analytics_events.create_index([("name", 1), ("created_at", -1)])
    await db.audit_log.create_index([("target_type", 1), ("target_id", 1), ("created_at", -1)])
    await db.feature_flags.create_index("flag", unique=True)
    await db.job_runs.create_index([("job_name", 1), ("ran_at", -1)])
    await db.observability_metrics.create_index([("metric", 1), ("created_at", -1)])
    await db.pricing_quotes.create_index([("vehicle_id", 1), ("created_at", -1)])

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

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
