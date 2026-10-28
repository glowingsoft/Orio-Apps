"""ORIO Backend - Phase 1 MVP
Auth (JWT + bcrypt), Users/Profiles, Rooms, Seats, Wallet, Gifts, Follows, Messages.
All routes prefixed with /api. MongoDB via motor.
"""
from fastapi.responses import FileResponse
from pymongo.errors import DuplicateKeyError
import os
import re
import time
import hashlib
import secrets
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, Optional, List, Literal

import bcrypt
import jwt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
# Deployment contract: DB_NAME MUST come from the environment. No hardcoded
# fallback — this prevents prod from silently pointing at the wrong database.
DB_NAME = os.environ["DB_NAME"]
ACCESS_SECRET = os.environ["ACCESS_SECRET"]
REFRESH_SECRET = os.environ["REFRESH_SECRET"]
ACCESS_MIN = int(os.environ.get("ACCESS_MINUTES", "60"))
REFRESH_DAYS = int(os.environ.get("REFRESH_DAYS", "30"))
REFRESH_GRACE_SECONDS = 120
ALG = "HS256"

logger = logging.getLogger("orio")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class _RedactTokenFilter(logging.Filter):
    """Never print access tokens that travel in WebSocket query strings."""
    _RE = re.compile(r"([?&]token=)[^\s\"&]+")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
            if "token=" in msg:
                record.msg, record.args = self._RE.sub(r"\1<redacted>", msg), ()
        except Exception:
            pass
        return True


for _n in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    logging.getLogger(_n).addFilter(_RedactTokenFilter())

bearer = HTTPBearer(auto_error=False)


# ---------- Helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def norm_email(email: str) -> str:
    return email.strip().casefold()


def pw_hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def pw_ok(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


DUMMY_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt(12)).decode()


def make_jwt(sub: str, secret: str, minutes: int, kind: str, jti: str) -> str:
    t = now_utc()
    return jwt.encode(
        {"sub": sub, "jti": jti, "typ": kind, "iat": t, "exp": t + timedelta(minutes=minutes)},
        secret,
        algorithm=ALG,
    )


def token_hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def auth_error() -> HTTPException:
    return HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})


# ---------- App / DB lifecycle ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.mongo = AsyncIOMotorClient(MONGO_URL)
    app.state.db = app.state.mongo[DB_NAME]
    db = app.state.db
    await db.command("ping")
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)
    # Iter-47 Phase 6 — phone (Twilio OTP) + facebook_id (OAuth) uniqueness.
    # Sparse so users without a phone / facebook_id don't collide on null.
    await db.users.create_index("phone", unique=True, sparse=True)
    await db.users.create_index("facebook_id", unique=True, sparse=True)
    await db.users.create_index("apple_sub", unique=True, sparse=True)
    await db.users.create_index("firebase_uid", unique=True, sparse=True)
    await db.push_devices.create_index("token", unique=True)
    await db.push_devices.create_index("user_id")
    await db.room_badge_sessions.create_index([("room_id", 1), ("user_id", 1)], unique=True)
    await db.gift_transactions.create_index([("room_id", 1), ("created_at", -1)])
    # Iter-121 — rooms filter by the owner's CURRENT country/region (one-time idempotent sync).
    try:
        async for _r in db.rooms.find({"owner_id": {"$exists": True}}, {"owner_id": 1, "country_code": 1}):
            if not _is_valid_oid(_r.get("owner_id")):
                continue
            _o = await db.users.find_one({"_id": ObjectId(_r["owner_id"])}, {"country_code": 1, "country_flag": 1})
            if _o and _o.get("country_code") and _o["country_code"] != _r.get("country_code"):
                await db.rooms.update_one({"_id": _r["_id"]}, {"$set": {"country_code": _o["country_code"], "country_flag": _o.get("country_flag")}})
    except Exception:
        pass
    # Iter-48 — ONE ROOM PER USER. Partial unique index on owner_id, only
    # counting rooms that are currently live. (MongoDB partial indexes don't
    # support `$ne`, and our delete flow always flips `is_live:false`, so
    # filtering on `is_live:true` is both necessary and sufficient.)
    try:
        await db.rooms.create_index(
            "owner_id",
            unique=True,
            partialFilterExpression={"is_live": True},
            name="one_live_room_per_owner",
        )
    except Exception as _e:
        # Index may already exist from a prior boot with slightly different
        # options — swallow so lifespan does not die.
        pass
    await db.refresh_sessions.create_index("token_hash", unique=True)
    await db.refresh_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.rooms.create_index("created_at")
    await db.wallet_transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.follows.create_index([("follower_id", 1), ("followee_id", 1)], unique=True)
    await db.messages.create_index([("thread_key", 1), ("created_at", -1)])
    await db.posts.create_index([("created_at", -1)])
    await db.friendships.create_index([("pair_key", 1)], unique=True)
    await db.cp_pairs.create_index([("pair_key", 1)], unique=True)
    await db.cp_pairs.create_index([("member_ids", 1)])
    await db.families.create_index("name", unique=True)
    await db.family_members.create_index([("family_id", 1), ("user_id", 1)], unique=True)
    await db.family_messages.create_index([("family_id", 1), ("created_at", -1)])
    await db.gift_transactions.create_index([("sender_id", 1), ("created_at", -1)])
    await db.gift_transactions.create_index([("recipient_id", 1), ("created_at", -1)])
    # Iter-18: room follow / membership / bans
    await db.room_follows.create_index([("user_id", 1), ("room_id", 1)], unique=True)
    await db.room_follows.create_index([("room_id", 1), ("created_at", -1)])
    await db.room_members.create_index([("user_id", 1), ("room_id", 1)], unique=True)
    await db.room_members.create_index([("room_id", 1), ("created_at", -1)])
    await db.room_membership_requests.create_index(
        [("user_id", 1), ("room_id", 1), ("status", 1)]
    )
    await db.room_membership_requests.create_index([("room_id", 1), ("status", 1), ("created_at", -1)])
    await db.room_bans.create_index([("user_id", 1), ("room_id", 1)], unique=True)
    await db.room_visits.create_index([("user_id", 1), ("room_id", 1)], unique=True)
    await db.room_visits.create_index([("user_id", 1), ("visited_at", -1)])
    # Profile Visitors ("Who viewed my profile") — one row per (target, viewer).
    await db.profile_visitors.create_index(
        [("target_id", 1), ("viewer_id", 1)], unique=True
    )
    await db.profile_visitors.create_index([("target_id", 1), ("last_visit", -1)])
    # Numeric ID: sparse unique index (existing users get backfilled below)
    await db.users.create_index("numeric_id", unique=True, sparse=True)
    # Backfill numeric_id for any users missing it (idempotent)
    await _backfill_numeric_ids(db)
    await seed_gifts(db)
    await seed_demo_rooms(db)
    await _migrate_rooms_host_plus_numbered(db)
    # Iter-36: level migration (idempotent) — introduces points fields for
    # wealth/charm and seeds default threshold configs.
    await _bootstrap_level_configs(db)
    await _grant_vip_entrances_all(db)
    await _migrate_vip_recharge_v133(db)
    await _ensure_iter134_indexes(db)
    await _load_banned_words(db)
    await db.messages.create_index([("recipient_id", 1), ("read", 1)])
    await _migrate_legacy_levels_to_points(db)
    await _level_reset_v2(db)
    # Iter-38: ensure financial-foundation indexes exist (idempotent).
    await _bootstrap_indexes_v38(db)
    # Iter-39: Phase-2A agency invitation indexes (idempotent).
    await _bootstrap_indexes_v39(db)
    # Iter-40: Phase-2B withdrawal + payout-method indexes (idempotent).
    await _bootstrap_indexes_v40(db)
    # Iter-41: enforce official 9999 Diamonds = $1 conversion + $1000 max.
    await _migrate_withdrawal_config_v41(db)
    # Iter-42: ORIO Games (Ludo) + Recharge Agent indexes (idempotent).
    await _bootstrap_indexes_v42(db)
    # Iter-44: existing users treated as "already completed" so the profile
    # completion flow is only shown to brand-new signups.
    await db.users.update_many(
        {"profile_completed": {"$exists": False}},
        {"$set": {"profile_completed": True, "gender_locked": True}},
    )
    # ---- One-time branding migration: purge legacy Folu/VoiceUp strings from persisted docs ----
    try:
        await db.users.update_many(
            {"$or": [{"nickname": "VoiceUp"}, {"username": "voiceup"}]},
            {"$set": {"nickname": "ORIO", "username": "orio", "bio": "Welcome to ORIO"}},
        )
        await db.rooms.update_many(
            {"owner_public.nickname": "VoiceUp"},
            {"$set": {"owner_public.nickname": "ORIO"}},
        )
        await db.rooms.update_many(
            {"seats.user.nickname": "VoiceUp"},
            {"$set": {"seats.$[el].user.nickname": "ORIO"}},
            array_filters=[{"el.user.nickname": "VoiceUp"}],
        )
        await db.wallet_transactions.update_many(
            {"description": "Welcome to Folu Live!"},
            {"$set": {"description": "Welcome to ORIO!"}},
        )
    except Exception:
        pass
    # Iter-70 — one-time cleanup: freeze/disable animated_avatar_url for any
    # user currently below VIP5. The static profile photo is preserved; only
    # the animated GIF field is unset. Legitimate VIP5+ GIFs are untouched.
    try:
        await _freeze_expired_gifs(db)
        import asyncio as _aio

        async def _gif_freeze_loop():
            while True:
                await _aio.sleep(60)
                try:
                    await _freeze_expired_gifs(db)
                except Exception as e:  # pragma: no cover
                    logger.warning(f"gif freeze loop: {e}")
        _aio.get_event_loop().create_task(_gif_freeze_loop())
    except Exception:
        pass
    # Iter-73 — backfill owner_public.{username, numeric_id} on existing rooms
    # so the host area can show the owner's name + numeric ID without an
    # extra per-request DB lookup.
    try:
        cur = db.rooms.find(
            {
                "owner_id": {"$exists": True, "$ne": None},
                "$or": [
                    {"owner_public.numeric_id": {"$exists": False}},
                    {"owner_public.numeric_id": None},
                ],
            },
            {"_id": 1, "owner_id": 1, "owner_public": 1},
        )
        _patched = 0
        async for _r in cur:
            try:
                _u = await db.users.find_one(
                    {"_id": ObjectId(_r["owner_id"])},
                    {"username": 1, "numeric_id": 1},
                )
            except Exception:
                _u = None
            if not _u:
                continue
            _op = dict(_r.get("owner_public") or {})
            _op["username"] = _u.get("username")
            _op["numeric_id"] = _u.get("numeric_id")
            await db.rooms.update_one({"_id": _r["_id"]}, {"$set": {"owner_public": _op}})
            _patched += 1
        if _patched:
            logger.info(f"Iter-73: backfilled numeric_id on {_patched} rooms")
    except Exception as _e:
        logger.warning(f"Iter-73 numeric_id backfill skipped: {_e}")
    # Iter-85 — Admin Dashboard: idempotent superadmin seed.
    try:
        from admin_dashboard import seed_admin as _seed_admin
        await _seed_admin(db)
    except Exception as _e:
        logger.warning(f"Iter-85 admin seed skipped: {_e}")
    logger.info("Yazeen backend ready")
    _log_frontend_backend_urls()
    try:
        await _iter117_dedupe_rooms(db)
    except Exception as _e:
        logger.warning(f"Iter-117 room dedupe skipped: {_e}")
    try:
        from admin_phase1 import ensure_orio_team as _ensure_team, ensure_welcome_launch as _ensure_launch
        await _ensure_team(db)
        await _ensure_launch(db)
        await db.bans.create_index([("user_id", 1), ("active", 1)])
        await db.level_history.create_index([("user_id", 1), ("created_at", -1)])
    except Exception as _e:
        logger.warning(f"Iter-118 init skipped: {_e}")
    # Batch B — permanent account deletion finalizer (72h window).
    from account_deletion import finalize_due_loop as _del_loop
    try:
        await db.deleted_credentials.create_index("hash")
        await db.deleted_credentials.create_index("reuse_after")  # expiry checked at query time (no TTL deletes)
    except Exception as _ie:
        logger.warning(f"deleted_credentials index init skipped: {_ie}")
    import asyncio as _aio_del
    _del_task = _aio_del.create_task(_del_loop(app))
    yield
    _del_task.cancel()
    app.state.mongo.close()


import random as _rand


async def _generate_unique_numeric_id(db, tries: int = 30) -> str:
    """Return an 8-digit numeric string (10000000..99999999) that is not yet used by any user."""
    for _ in range(tries):
        n = str(_rand.randint(10_000_000, 99_999_999))
        if not await db.users.find_one({"numeric_id": n}, {"_id": 1}):
            return n
    # Fallback: allow 9 digits if 8-digit space becomes crowded
    for _ in range(tries):
        n = str(_rand.randint(100_000_000, 999_999_999))
        if not await db.users.find_one({"numeric_id": n}, {"_id": 1}):
            return n
    raise RuntimeError("Could not allocate a unique numeric ID")


async def _backfill_numeric_ids(db) -> None:
    """
    Backfills any user missing a numeric_id AND migrates any legacy numeric_id
    (e.g. old 9-digit format) to the new 8-digit standard. Idempotent.
    """
    # Missing entirely
    cur = db.users.find({"numeric_id": {"$exists": False}}, {"_id": 1})
    async for u in cur:
        try:
            nid = await _generate_unique_numeric_id(db)
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"numeric_id": nid}})
        except Exception:
            continue
    # Legacy non-8-digit numeric_ids → migrate to fresh unique 8-digit
    cur2 = db.users.find(
        {"numeric_id": {"$exists": True, "$not": {"$regex": r"^\d{8}$"}}},
        {"_id": 1, "numeric_id": 1},
    )
    async for u in cur2:
        try:
            nid = await _generate_unique_numeric_id(db)
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"numeric_id": nid}})
        except Exception:
            continue


def _log_frontend_backend_urls() -> None:
    """Print the EXPO_PUBLIC_BACKEND_URL values"""
    import socket
    import sys
    argv = sys.argv

    def _arg(name: str, default: str) -> str:
        for i, a in enumerate(argv):
            if a == name and i + 1 < len(argv):
                return argv[i + 1]
            if a.startswith(name + "="):
                return a.split("=", 1)[1]
        return default

    port = _arg("--port", os.environ.get("PORT", "8000"))
    host = _arg("--host", "127.0.0.1")
    lines = [f"Frontend .env (web on this PC):     EXPO_PUBLIC_BACKEND_URL=http://localhost:{port}"]
    if host in ("0.0.0.0", "::"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))  # no packet is sent; just picks the LAN interface
                lan_ip = s.getsockname()[0]
            lines.append(f"Frontend .env (phone on same Wi-Fi): EXPO_PUBLIC_BACKEND_URL=http://{lan_ip}:{port}")
        except OSError:
            pass
    else:
        lines.append("For a phone on the same Wi-Fi, start uvicorn with --host 0.0.0.0")
    for line in lines:
        logger.info(line)


async def _migrate_rooms_host_plus_numbered(db) -> None:
    """
    Migrate legacy room documents to the new host + N numbered mic seat layout.
    Legacy rooms had `num_seats` slots total (host occupied index 0, so only
    num_seats - 1 numbered mic seats). New model: `num_seats` = numbered mic
    seat count, total slots = num_seats + 1 (index 0 = host chair).

    Strategy: for each room whose seats array has fewer than num_seats + 1
    entries, append empty slots to reach num_seats + 1. We do NOT reduce
    num_seats, so existing rooms simply gain the "extra" numbered seat that
    was previously absorbed by the host. Fully idempotent.
    """
    # 25-mic layout removed → downgrade any legacy 25-mic room to 20 mics
    # (host + 20 seats). Users on the dropped seats 21-25 simply leave the mic.
    try:
        async for r in db.rooms.find({"num_seats": {"$gt": 20}}, {"_id": 1, "seats": 1}):
            seats = (r.get("seats") or [])[:21]
            await db.rooms.update_one({"_id": r["_id"]}, {"$set": {"num_seats": 20, "seats": seats}})
    except Exception as e:
        logger.warning(f"room 25→20 migration warning: {e}")
    try:
        cursor = db.rooms.find({}, {"_id": 1, "num_seats": 1, "seats": 1})
        async for r in cursor:
            n = int(r.get("num_seats") or 8)
            seats = r.get("seats") or []
            target = n + 1
            if len(seats) < target:
                new_seats = list(seats)
                for i in range(len(new_seats), target):
                    new_seats.append({"index": i, "user": None, "muted": False, "locked": False})
                # Re-normalize indexes (defensive)
                for idx, s in enumerate(new_seats):
                    s["index"] = idx
                await db.rooms.update_one({"_id": r["_id"]}, {"$set": {"seats": new_seats}})
    except Exception as e:
        logger.warning(f"room seat migration warning: {e}")



app = FastAPI(
    title="Yazeen API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
# Browsers may only call the API from these origins. Native apps send no Origin
# header, so CORS does not affect them. Auth uses Bearer tokens, not cookies.
CORS_ORIGINS = [o.strip().rstrip("/") for o in (os.environ.get("CORS_ORIGINS")
                or "https://aazabex.com,https://www.aazabex.com").split(",") if o.strip()]
# Local development: Expo web on localhost or a LAN address, any port.
CORS_ORIGIN_REGEX = os.environ.get("CORS_ORIGIN_REGEX") or \
    r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cors_origin_allowed(origin: str) -> bool:
    return origin in CORS_ORIGINS or bool(re.fullmatch(CORS_ORIGIN_REGEX, origin))


@app.exception_handler(Exception)
async def _unhandled_error(request, exc):
    # Unhandled errors bypass CORSMiddleware, so browsers report them as CORS
    # failures. Log the real traceback and keep the CORS header on the 500.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    from fastapi.responses import JSONResponse
    origin = request.headers.get("origin") or ""
    headers = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if _cors_origin_allowed(origin) else {}
    return JSONResponse({"detail": "Internal server error"}, status_code=500, headers=headers)


api = APIRouter(prefix="/api")


# ---------- Models ----------
# Email sign-up is disabled (see the commented /auth/register route).
# class RegisterIn(BaseModel):
#     email: EmailStr
#     password: str = Field(min_length=8, max_length=72)
#     username: str = Field(min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_]+$")
#     nickname: str = Field(min_length=1, max_length=20)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class Tokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UpdateProfileIn(BaseModel):
    nickname: Optional[str] = Field(default=None, max_length=20)
    bio: Optional[str] = Field(default=None, max_length=200)
    avatar_url: Optional[str] = None
    cover_url: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    language: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=18, le=99)
    gender: Optional[Literal["male", "female"]] = None


class CreateRoomIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    description: Optional[str] = Field(default=None, max_length=200)
    cover_url: Optional[str] = None
    category: str = "chat"
    is_private: bool = False
    password: Optional[str] = None
    max_users: int = Field(default=100, ge=2, le=500)
    # num_seats now means "numbered mic seats" (exclusive of the dedicated host chair
    # at seat[0]). Allowed values: 8, 15, 20. Total seat slots in DB = num_seats + 1.
    num_seats: int = Field(default=8, ge=1, le=20)
    welcome_msg: Optional[str] = Field(default=None, max_length=300)
    notice: Optional[str] = Field(default=None, max_length=1000)


# Iter-48: ORIO room taxonomy is strictly ONE OF {cp, games, chat, music}.
# Any legacy / arbitrary category is normalized to the closest allowed bucket so
# the discovery UI never has to render "social", "culture", "dj", etc.
ALLOWED_ROOM_CATEGORIES = {"cp", "games", "chat", "music"}
_CATEGORY_ALIASES = {
    "general": "chat", "voice": "chat", "study": "chat", "dating": "cp",
    "team": "games", "pk": "games", "gaming": "games", "game": "games",
    "dj": "music",
    "social": "chat", "culture": "chat", "chill": "chat",
}

def _normalize_room_category(raw: Optional[str]) -> str:
    """Return one of {cp, games, chat, music} for any input."""
    if not raw:
        return "chat"
    key = str(raw).strip().lower()
    if key in ALLOWED_ROOM_CATEGORIES:
        return key
    return _CATEGORY_ALIASES.get(key, "chat")


class SeatActionIn(BaseModel):
    # Seat 0 is the dedicated host chair; seats 1..num_seats are the numbered mic seats.
    # Max valid index therefore = 20 (host) + 20 numbered = index up to 20.
    seat_index: int = Field(ge=0, le=25)


class SendGiftIn(BaseModel):
    gift_id: str
    recipient_id: str
    room_id: Optional[str] = None
    quantity: int = Field(default=1, ge=1, le=99)
    # Iter-115 — client idempotency key: a retried send is never counted twice.
    request_id: Optional[str] = Field(default=None, max_length=64)


class SendMessageIn(BaseModel):
    recipient_id: str
    text: str = Field(default="", max_length=1000)
    # Iter-134 — private-chat media (uploaded via /media/upload, purpose="chat").
    kind: Literal["text", "image", "voice"] = "text"
    media_url: Optional[str] = Field(default=None, max_length=200)
    duration: Optional[float] = Field(default=None, ge=0, le=31)
    # Voice messages: normalised volume samples (0..1) captured while recording.
    waveform: Optional[list[float]] = Field(default=None, max_length=64)


class RechargeIn(BaseModel):
    package_id: str
    request_id: Optional[str] = Field(default=None, max_length=64)


# ---------- Serialisers ----------
def _vip_name_color(vip_level: int) -> Optional[str]:
    """Iter-57 — Server-authoritative username color.
    VIP 2-5 → "red", VIP 6-7 → "rainbow", otherwise None.
    Clients render per this flag; they cannot select it themselves.
    """
    lvl = int(vip_level or 0)
    if lvl >= 6:
        return "rainbow"
    if lvl >= 2:
        return "red"
    return None


GIF_ACCESS_PRICE = 19_999
GIF_ACCESS_DAYS = 7


def _gif_access_until(u: dict):
    d = u.get("gif_access_until")
    if isinstance(d, datetime):
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


def _gif_eligible(u: dict) -> bool:
    """VIP4+ (active VIP) OR a paid 7-day GIF pass that hasn't expired."""
    if int(u.get("vip_level", 0) or 0) >= 4:
        return True
    until = _gif_access_until(u)
    return bool(until and until > datetime.now(timezone.utc))


def public_user(u: dict) -> dict:
    _vip_lvl = int(u.get("vip_level", 0) or 0)
    # Iter-70 — enforce VIP5+ requirement for animated avatars at render time
    # too, so legacy GIFs still in a user's record never render for sub-VIP5
    # users even if a background cleanup hasn't yet unset them.
    _anim = u.get("animated_avatar_url") if _gif_eligible(u) else None
    return {
        "id": str(u["_id"]),
        "is_official": bool(u.get("is_official")),
        "name_color": _vip_name_color(_vip_lvl),
        "email": u.get("email"),
        "username": u.get("username"),
        "nickname": u.get("nickname"),
        "bio": u.get("bio", ""),
        "avatar_url": u.get("avatar_url"),
        "animated_avatar_url": _anim,
        "gif_access_until": _gif_access_until(u).isoformat() if _gif_access_until(u) else None,
        "gif_eligible": _gif_eligible(u),
        "cover_url": u.get("cover_url"),
        "background_url": u.get("background_url"),
        "photos": u.get("photos", []),
        "country": u.get("country"),
        "country_code": u.get("country_code"),
        "country_flag": u.get("country_flag"),
        "language": u.get("language", "en"),
        "age": u.get("age"),
        "gender": u.get("gender"),
        "gender_locked": bool(u.get("gender_locked", False)),
        "profile_completed": bool(u.get("profile_completed", False)),
        "level": u.get("level", 1),
        "wealth_level": u.get("wealth_level", 0),
        "charm_level": u.get("charm_level", 0),
        "vip_level": u.get("vip_level", 0),
        # Iter-36: expose preserved points fields so profile / rankings can
        # show progress-to-next-level without recomputing on the client. The
        # DISPLAY level (…_level) is always the server-authoritative value.
        "wealth_points": int(u.get("wealth_points", u.get("wealth_level", 0)) or 0),
        "charm_points": int(u.get("charm_points", u.get("charm_level", 0)) or 0),
        "vip_expires_at": u.get("vip_expires_at").isoformat() if isinstance(u.get("vip_expires_at"), datetime) else None,
        # Iter-82 — custom-background 15-day pass window (null if never bought).
        "custom_bg_entitlement_until": u.get("custom_bg_entitlement_until").isoformat() if isinstance(u.get("custom_bg_entitlement_until"), datetime) else None,
        "short_id": _make_short_code(str(u["_id"])) if u.get("_id") else None,
        "numeric_id": u.get("numeric_id"),
        "family_id": u.get("family_id"),
        "family_name": u.get("family_name"),
        "medals": u.get("medals", []),
        "voice_bio_url": u.get("voice_bio_url"),
        "voice_bio_duration": u.get("voice_bio_duration"),
        "coins": u.get("coins", 0),
        "diamonds": u.get("diamonds", 0),
        "growth_points": int(u.get("growth_points", 0)),
        "experience": u.get("experience", 0),
        "followers": u.get("followers_count", 0),
        "following": u.get("following_count", 0),
        "friends": u.get("friends_count", 0),
        "created_at": u.get("created_at", now_utc()).isoformat(),
        # Iter-48 — "جديد" / "NEW" auto-badge: computed from `created_at`,
        # true for exactly 5 days from the real account creation timestamp.
        "is_new": _is_new_user(u.get("created_at")),
        "online": u.get("online", False),
    }


def _is_new_user(created_at) -> bool:
    """Return True iff `created_at` is within the last 5 days from now.
    Robust against tz-naive datetimes (MongoDB defaults return naive)."""
    if not isinstance(created_at, datetime):
        return False
    try:
        # Normalize both sides to tz-aware UTC to avoid a TypeError when the
        # DB round-trip strips tzinfo.
        now = datetime.now(timezone.utc)
        c = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        return (now - c) <= timedelta(days=5)
    except Exception:
        return False


def public_room(r: dict) -> dict:
    return {
        "id": str(r["_id"]),
        "name": r["name"],
        "description": r.get("description", ""),
        "cover_url": r.get("cover_url"),
        "category": _normalize_room_category(r.get("category")),
        "country_code": (r.get("country_code") or None),
        "country_flag": r.get("country_flag"),
        "is_private": r.get("is_private", False),
        "has_password": bool(r.get("password_hash")),
        "is_locked": bool(r.get("pin_hash")),
        "max_users": r.get("max_users", 100),
        "num_seats": r.get("num_seats", 8),
        "owner": r.get("owner_public"),
        "owner_id": r.get("owner_id"),
        "moderators": r.get("moderators", []),
        "seats": r.get("seats", []),
        "listeners_count": r.get("listeners_count", 0),
        # Iter-121 — real live participants from the room socket presence.
        # TEST rooms: count = seeded test members on seats (no simulated connections).
        "live_count": (sum(1 for x in (r.get("seats") or []) if x.get("user")) if r.get("is_test")
                       else len(_hub.presence.get(str(r["_id"]), {}))),
        "is_test": bool(r.get("is_test")),
        "is_live": r.get("is_live", True),
        "is_deleted": bool(r.get("is_deleted", False)),
        "follow_count": int(r.get("follow_count", 0)),
        "member_count": int(r.get("member_count", 0)),
        # Iter-82 — Room Avatar (`cover_url`) and Room Background
        # (`background_url`) are STRICTLY independent fields. We no longer
        # fall back to the cover_url here; if a legacy room has no
        # background we return the ORIO Welcome default so the room still
        # has a backdrop but changing the Room Avatar never leaks into
        # the Room Background.
        "background_url": r.get("background_url") or "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&q=85",
        # Iter-75 — latest approved custom background (if any); lets the
        # owner swap back to it in the Background picker without re-uploading.
        "custom_background_url": r.get("custom_background_url"),
        "background_preset_id": r.get("background_preset_id"),
        "notice": r.get("notice") or "",
        "welcome_msg": r.get("welcome_msg") or "",
        "has_room_password": bool(r.get("room_password_hash")),
        "chat_locked": bool(r.get("chat_locked")),
        "chat_muted_users": r.get("chat_muted_users") or [],
        # Full mic/audio mute (profile-card) — {user_id: actor_id}; list of muted ids.
        "full_muted_users": list((r.get("full_muted_users") or {}).keys()),
        "settings": r.get("settings") or {
            "entrance_effects": True,
            "noise_reduction": True,
            "music_control_role": "owner",  # owner | mods | seat
        },
        "created_at": r.get("created_at", now_utc()).isoformat(),
    }


# ---------- Seeds ----------
# Batch B — transparent Google Noto artwork (PNG) + animated Lottie for every
# catalog gift. Prices unchanged. Royal Dragon / Mythical Phoenix are luxury tier.
_NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/"
def _noto_img(c): return f"{_NOTO}{c}/512.png"
def _noto_anim(c): return f"{_NOTO}{c}/lottie.json"
DEFAULT_GIFTS = [
    {"id": "rose", "name": "Rose", "name_ar": "وردة", "price": 10, "rarity": "common", "category": "popular",
     "image_url": _noto_img("1f339"), "animation_url": _noto_anim("1f339"), "charm_reward": 1},
    {"id": "heart", "name": "Heart", "name_ar": "قلب", "price": 50, "rarity": "common", "category": "popular",
     "image_url": _noto_img("2764_fe0f"), "animation_url": _noto_anim("2764_fe0f"), "charm_reward": 5},
    {"id": "cake", "name": "Cake", "name_ar": "كعكة", "price": 200, "rarity": "rare", "category": "popular",
     "image_url": _noto_img("1f382"), "animation_url": _noto_anim("1f382"), "charm_reward": 20},
    {"id": "diamond", "name": "Diamond", "name_ar": "ألماس", "price": 1000, "rarity": "epic", "category": "luxury",
     "image_url": _noto_img("1f48e"), "animation_url": _noto_anim("1f48e"), "charm_reward": 100},
    {"id": "sports_car", "name": "Sports Car", "name_ar": "سيارة سباق", "price": 5000, "rarity": "epic", "category": "luxury",
     "image_url": _noto_img("1f3ce_fe0f"), "animation_url": _noto_anim("1f3ce_fe0f"), "charm_reward": 500},
    {"id": "treasure", "name": "Treasure Chest", "name_ar": "صندوق كنز", "price": 10000, "rarity": "legendary", "category": "luxury",
     "image_url": _noto_img("1fa99"), "animation_url": _noto_anim("1fa99"), "charm_reward": 1000},
    {"id": "castle", "name": "Castle", "name_ar": "قلعة", "price": 30000, "rarity": "legendary", "category": "luxury",
     "image_url": _noto_img("1f3f0"), "animation_url": None, "charm_reward": 3500},
    {"id": "phoenix", "name": "Phoenix", "name_ar": "طائر الفينيق", "price": 50000, "rarity": "legendary", "category": "luxury",
     "image_url": _noto_img("1f426_200d_1f525"), "animation_url": _noto_anim("1f426_200d_1f525"), "charm_reward": 6000},
    {"id": "royal_dragon", "name": "Royal Dragon", "name_ar": "التنين الملكي", "price": 500000, "rarity": "mythic", "category": "luxury",
     "image_url": _noto_img("1f409"), "animation_url": _noto_anim("1f409"), "charm_reward": 60000,
     "luxury_fx": "dragon", "sort": 900},
    {"id": "mythical_phoenix", "name": "Mythical Phoenix", "name_ar": "العنقاء الأسطورية", "price": 1000000, "rarity": "mythic", "category": "luxury",
     "image_url": _noto_img("1f426_200d_1f525"), "animation_url": _noto_anim("1f426_200d_1f525"), "charm_reward": 120000,
     "luxury_fx": "phoenix", "sort": 1000},
]

# Iter-133 — OFFICIAL RECHARGE RATE: $1 = 499 Diamonds (recharge only; the
# withdrawal rate in `withdrawal_config` is a separate currency rule).
RECHARGE_DIAMONDS_PER_USD = 499
_PKG_TIERS = [  # (price in cents, label)
    (99, "Starter"), (199, "Popular"), (299, "Value"), (499, "Best Value"), (999, "Hot"),
    (1999, "Deluxe"), (2999, "Elite"), (4999, "Royal"), (9999, "Legend"), (14999, "Mythic"),
    (19999, "Whale"), (99900, "Emperor"),
]


def _pkg_diamonds(cents: int) -> int:
    """Exact integer rounding (half-up) of price × 499 — no float math."""
    return (cents * RECHARGE_DIAMONDS_PER_USD + 50) // 100


def _pkg_id(prefix: str, cents: int) -> str:
    return f"{prefix}_{cents:03d}" if cents < 99900 else f"{prefix}_99900"


COIN_PACKAGES_MOBILE = [
    {"id": _pkg_id("d", c), "coins": _pkg_diamonds(c), "bonus": 0, "price_usd": c / 100,
     "price_cents": c, "label": lbl, "channel": "mobile"}
    for c, lbl in _PKG_TIERS
]

# Web keeps its +10% bonus on top of the base 499/$ amount.
COIN_PACKAGES_WEB = [
    {"id": _pkg_id("w", c), "coins": _pkg_diamonds(c), "bonus": (_pkg_diamonds(c) + 5) // 10,
     "price_usd": c / 100, "price_cents": c, "label": lbl, "channel": "web"}
    for c, lbl in _PKG_TIERS
]

# Combined lookup for /wallet/recharge (mock dev channel)
COIN_PACKAGES = COIN_PACKAGES_MOBILE + COIN_PACKAGES_WEB


async def seed_gifts(db):
    # Iter-37: canonical category set is defined by GIFT_CATEGORY_ORDER.
    # Legacy seeds used "popular"/"luxury" — remap onto the new taxonomy so
    # all catalog gifts show under the default "Gift" tab.
    _CATEGORY_REMAP = {"popular": "gift", "luxury": "gift", "regular": "gift"}
    for g in DEFAULT_GIFTS:
        raw_cat = g.get("category", "gift")
        canonical = _CATEGORY_REMAP.get(raw_cat, raw_cat)
        payload = {**g, "active": True, "category": canonical}
        await db.gifts.update_one({"id": g["id"]}, {"$set": payload}, upsert=True)
    # Backfill category on any legacy gifts (including live remap of old keys).
    for legacy, new in _CATEGORY_REMAP.items():
        await db.gifts.update_many({"category": legacy}, {"$set": {"category": new}})
    await db.gifts.update_many({"category": {"$exists": False}}, {"$set": {"category": "gift"}})


async def seed_demo_rooms(db):
    if await db.rooms.count_documents({}) > 0:
        return
    # Create a system user for demo rooms
    sys_email = "system@orio.app"
    sys = await db.users.find_one({"email": sys_email})
    if not sys:
        r = await db.users.insert_one({
            "email": sys_email,
            "username": "orio",
            "nickname": "Yazeen",
            "password_hash": pw_hash(secrets.token_hex(16)),
            "avatar_url": "https://images.unsplash.com/photo-1545266241-3516e2a6e016?w=200&h=200&fit=crop",
            "bio": "Welcome to Yazeen",
            "vip_level": 5,
            "level": 20,
            "wealth_level": 15,
            "charm_level": 12,
            "coins": 999999,
            "diamonds": 9999,
            "created_at": now_utc(),
            "is_system": True,
        })
        sys_id = str(r.inserted_id)
    else:
        sys_id = str(sys["_id"])

    covers = [
        "https://images.unsplash.com/photo-1659083726524-9a341327fd99?w=800&h=600&fit=crop",
        "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&h=600&fit=crop",
        "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&h=600&fit=crop",
        "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=600&fit=crop",
        "https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=800&h=600&fit=crop",
    ]
    demo = [
        ("Late Night Vibes", "Chill and chat", "chill"),
        ("Music Lovers", "Share your favorite songs", "music"),
        ("Arabic Poetry", "شعر ونقاش", "culture"),
        ("Game Room", "Talk about games", "gaming"),
        ("New Friends", "Meet new people", "social"),
    ]
    for i, (name, desc, cat) in enumerate(demo):
        # one_live_room_per_owner requires a distinct owner per live room
        owner_email = f"demo.owner.{i}@orio.app"
        owner = await db.users.find_one({"email": owner_email})
        if not owner:
            r = await db.users.insert_one({
                "email": owner_email,
                "username": f"demo_owner_{i}",
                "nickname": f"Yazeen {i + 1}",
                "password_hash": pw_hash(secrets.token_hex(16)),
                "avatar_url": "https://images.unsplash.com/photo-1545266241-3516e2a6e016?w=200&h=200&fit=crop",
                "bio": "Demo room host",
                "vip_level": 5,
                "level": 20,
                "wealth_level": 15,
                "charm_level": 12,
                "coins": 999999,
                "diamonds": 9999,
                "created_at": now_utc(),
                "is_system": True,
            })
            owner_id = str(r.inserted_id)
            owner_nick = f"Yazeen {i + 1}"
        else:
            owner_id = str(owner["_id"])
            owner_nick = owner.get("nickname") or f"Yazeen {i + 1}"
        # 1 host chair (index 0) + 8 numbered mic seats = 9 slots
        seats = [{"index": j, "user": None, "muted": False, "locked": False} for j in range(9)]
        await db.rooms.insert_one({
            "name": name,
            "description": desc,
            "cover_url": covers[i % len(covers)],
            "category": cat,
            "is_private": False,
            "max_users": 100,
            "num_seats": 8,
            "owner_id": owner_id,
            "owner_public": {"id": owner_id, "nickname": owner_nick, "avatar_url": "https://images.unsplash.com/photo-1545266241-3516e2a6e016?w=200&h=200&fit=crop", "vip_level": 5},
            "seats": seats,
            "listeners_count": 12 + i * 7,
            "is_live": True,
            "created_at": now_utc(),
        })


# ---------- Auth deps ----------
async def issue_pair(db, user_id: str) -> Tokens:
    # Batch B — logging in within the 72h window cancels a pending deletion;
    # permanently deleted accounts can never obtain tokens again.
    from account_deletion import cancel_on_login as _cancel_del
    await _cancel_del(db, user_id)
    access = make_jwt(user_id, ACCESS_SECRET, ACCESS_MIN, "access", secrets.token_hex(16))
    jti = secrets.token_hex(32)
    refresh = make_jwt(user_id, REFRESH_SECRET, REFRESH_DAYS * 24 * 60, "refresh", jti)
    await db.refresh_sessions.insert_one({
        "jti": jti,
        "user_id": user_id,
        "token_hash": token_hash(refresh),
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=REFRESH_DAYS),
    })
    return Tokens(access_token=access, refresh_token=refresh, expires_in=ACCESS_MIN * 60)


async def current_user(
    creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)],
    request: Request = None,
) -> dict:
    if not creds:
        raise auth_error()
    try:
        p = jwt.decode(creds.credentials, ACCESS_SECRET, algorithms=[ALG])
        if p.get("typ") != "access":
            raise auth_error()
        db = app.state.db
        user = await db.users.find_one({"_id": ObjectId(p["sub"])})
        if not user or user.get("account_deleted") or user.get("deletion_status") == "pending":
            raise auth_error()
    except (jwt.PyJWTError, ValueError, Exception):
        raise auth_error()
    # Iter-118 — server-side ban enforcement (account / device / both) on every
    # authenticated request, plus throttled activity + device tracking.
    from admin_phase1 import enforce_ban as _enforce_ban, track_device_and_activity as _track
    _dev = (request.headers.get("x-device-id") if request is not None else None) or None
    _dev = _dev[:128] if _dev else None
    await _enforce_ban(app.state.db, user, _dev)
    await _track(app.state.db, user, _dev)
    return user


# ---------- Routes: root ----------
@api.get("/")
async def root():
    return {"app": "Yazeen", "version": "0.2.0", "status": "ok"}


@api.get("/health")
async def health():
    """Deploy check: database, upload staging dir, storage backend, WebSocket support."""
    import importlib.util
    try:
        await app.state.db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    try:
        _ensure_upload_tmp()
        tmp_ok = True
    except HTTPException:
        tmp_ok = False
    ws_ok = any(importlib.util.find_spec(m) for m in ("websockets", "wsproto"))
    return {"db": db_ok, "upload_tmp": tmp_ok, "storage": "s3" if _S3_BUCKET else "emergent", "websockets": ws_ok}


# ---------- Routes: Auth ----------
# Email sign-up is disabled: email is login-only. Accounts come from Google / Apple / phone / Facebook.
# @api.post("/auth/register", response_model=Tokens, status_code=201)
# async def register(body: RegisterIn):
#     db = app.state.db
#     email = norm_email(str(body.email))
#     username = body.username.lower()
#     if await db.users.find_one({"email": email}):
#         raise HTTPException(409, "Email is already registered")
#     if await db.users.find_one({"username": username}):
#         raise HTTPException(409, "Username is already taken")
#     from account_deletion import assert_credential_reusable as _reuse_ok
#     await _reuse_ok(db, email=email)
#     doc = {
#         "email": email,
#         "username": username,
#         "nickname": body.nickname,
#         "password_hash": pw_hash(body.password),
#         "bio": "",
#         "avatar_url": f"https://api.dicebear.com/7.x/avataaars/png?seed={username}",
#         "level": 1,
#         "wealth_level": 0,
#         "charm_level": 0,
#         "vip_level": 0,
#         # Iter-36: preserved underlying points for the generic level framework.
#         "wealth_points": 0,
#         "charm_points": 0,
#         "growth_points": 0,
#         "coins": 500,  # welcome bonus
#         "diamonds": 10,
#         "experience": 0,
#         "followers_count": 0,
#         "following_count": 0,
#         "friends_count": 0,
#         "numeric_id": await _generate_unique_numeric_id(db),
#         "created_at": now_utc(),
#         "language": "en",
#     }
#     r = await db.users.insert_one(doc)
#     uid = str(r.inserted_id)
#     # welcome bonus transaction
#     await db.wallet_transactions.insert_one({
#         "user_id": uid, "type": "welcome_bonus", "currency": "coins",
#         "amount": 500, "balance_after": 500, "created_at": now_utc(),
#         "status": "completed", "description": "Welcome to ORIO!"
#     })
#     return await issue_pair(db, uid)


@api.post("/auth/login", response_model=Tokens)
async def login(body: LoginIn):
    db = app.state.db
    email = norm_email(str(body.email))
    user = await db.users.find_one({"email": email})
    hashed = user["password_hash"] if user else DUMMY_HASH
    if not pw_ok(body.password, hashed) or not user:
        raise HTTPException(401, "Incorrect email or password")
    return await issue_pair(db, str(user["_id"]))


@api.post("/auth/refresh", response_model=Tokens)
async def refresh(body: RefreshIn):
    db = app.state.db
    try:
        p = jwt.decode(body.refresh_token, REFRESH_SECRET, algorithms=[ALG])
        if p.get("typ") != "refresh":
            raise auth_error()
    except jwt.PyJWTError:
        raise auth_error()
    # Iter-122 — rotation with a short grace window: if the app was killed /
    # locked mid-refresh (server rotated, client never stored the new token) or
    # two requests refreshed concurrently, the same token still works briefly.
    grace_cutoff = now_utc() - timedelta(seconds=REFRESH_GRACE_SECONDS)
    session = await db.refresh_sessions.find_one_and_update(
        {
            "jti": p["jti"],
            "token_hash": token_hash(body.refresh_token),
            "expires_at": {"$gt": now_utc()},
            "$or": [{"rotated_at": {"$exists": False}}, {"rotated_at": {"$gt": grace_cutoff}}],
        },
        {"$min": {"rotated_at": now_utc(), "expires_at": now_utc() + timedelta(seconds=REFRESH_GRACE_SECONDS)}},
    )
    if not session:
        raise auth_error()
    # Iter-118 — banned accounts cannot obtain new sessions.
    _bu = await db.users.find_one({"_id": ObjectId(p["sub"])}, {"active_ban": 1})
    if _bu:
        from admin_phase1 import enforce_ban as _enforce_ban
        await _enforce_ban(db, _bu, None)
    return await issue_pair(db, p["sub"])


@api.post("/auth/logout", status_code=204)
async def logout(body: RefreshIn):
    db = app.state.db
    await db.refresh_sessions.delete_one({"token_hash": token_hash(body.refresh_token)})


class _DeletionRequestIn(BaseModel):
    confirm: bool


@api.post("/account/deletion/request")
async def _account_deletion_request(body: _DeletionRequestIn, user=Depends(current_user)):
    """Batch B — start the 72h permanent-deletion window (requires explicit confirm)."""
    if not body.confirm:
        raise HTTPException(400, "Deletion must be explicitly confirmed")
    db = app.state.db
    pending = await db.withdrawals.count_documents(
        {"user_id": str(user["_id"]), "status": {"$in": list(_WITHDRAWAL_CANCELABLE | {"APPROVED", "PROCESSING"})}})
    if pending:
        raise HTTPException(409, "You have pending withdrawals. Please wait until they are settled.")
    from account_deletion import request_deletion as _req_del
    return await _req_del(db, user)


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    data = public_user(user)
    # Compute friends live so we never drift with the friendships table.
    my_id = str(user["_id"])
    data["friends"] = await app.state.db.friendships.count_documents(
        {"status": "accepted", "$or": [{"a_id": my_id}, {"b_id": my_id}]}
    )
    # Iter-99 — live follow counts.
    data["following"] = await app.state.db.follows.count_documents({"follower_id": my_id})
    data["followers"] = await app.state.db.follows.count_documents({"followee_id": my_id})
    data["supporter_total"] = await _supporter_total(app.state.db, my_id)
    # Phase 2B — expose is_admin so the client can conditionally reveal
    # admin-only menu entries. All admin API routes remain server-side-gated.
    # Iter-86 — Owner + Approved Admin model: compute live admin_access on
    # every /auth/me so the frontend never trusts a cached role flag.
    try:
        from admin_dashboard import resolve_admin_access as _resolve_access
        _access = await _resolve_access(app.state.db, user)
    except Exception:
        _access = None
    data["admin_access"] = _access  # None if not admin
    data["is_admin"] = bool(_access)
    data["is_superadmin"] = bool(_access and _access.get("is_owner"))
    # Batch B — one-shot notice that a pending deletion was cancelled by login.
    if user.get("deletion_cancel_notice"):
        data["deletion_cancelled"] = True
        await app.state.db.users.update_one({"_id": user["_id"]}, {"$unset": {"deletion_cancel_notice": ""}})
    # Iter-118 — one-time official Orio Team welcome (new accounts only).
    try:
        from admin_phase1 import maybe_send_welcome as _welcome
        await _welcome(app.state.db, user, thread_key)
    except Exception as _e:
        logger.warning(f"orio welcome failed: {_e}")
    return data


# ---------- Routes: Profile ----------
@api.patch("/users/me")
async def update_me(body: UpdateProfileIn, user=Depends(current_user)):
    _guard_text(body.nickname, body.bio)
    db = app.state.db
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    # Profile cover is VIP5+ only and goes through PATCH /users/me/cover.
    if "cover_url" in upd:
        raise HTTPException(403, "VIP5_REQUIRED")
    # If country_code changes, resolve country name + flag from the master list
    if body.country_code:
        c = _find_country(body.country_code)
        if c:
            upd["country"] = c["name"]
            upd["country_flag"] = c["flag"]
            upd["country_code"] = c["code"]
    # Nickname trim + duplicate-friendly (nicknames aren't unique, only usernames)
    if body.nickname is not None:
        nick = body.nickname.strip()
        if not nick:
            raise HTTPException(400, "Nickname cannot be empty")
        if len(nick) > 20:
            raise HTTPException(400, "NAME_TOO_LONG")
        if nick != (user.get("nickname") or ""):
            _nc = await _name_change_status(db, user)
            if _nc["remaining"] <= 0:
                raise HTTPException(429, "NAME_CHANGE_LIMIT")
            upd["name_changes"] = {"month": _nc["month"], "used": _nc["used"] + 1}
            upd["nickname"] = nick
        else:
            upd.pop("nickname", None)
    # ------------------------------------------------------------------
    # iter-44 — Gender immutability enforcement.
    # Once a user confirms their profile (gender_locked=true), the server
    # MUST reject any further gender modification regardless of what the
    # client sends. This cannot be bypassed from the UI.
    # ------------------------------------------------------------------
    if "gender" in upd and user.get("gender_locked"):
        if upd["gender"] != user.get("gender"):
            raise HTTPException(409, "Gender is locked and cannot be changed after confirmation")
        # Same value — silently drop so the DB write is a no-op.
        upd.pop("gender", None)
    if upd:
        await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
        if upd.get("country_code"):
            await _sync_owner_rooms_country(db, str(user["_id"]), upd["country_code"], upd.get("country_flag"))
    # Iter-76 — owner_public is a saved SNAPSHOT taken at room creation.
    # It must NOT live-sync with later profile changes, per spec. The
    # previous Iter-75 propagation to `rooms.owner_public` is intentionally
    # removed so the Room Settings owner card and Host area keep showing
    # the owner info as it was when the room was created.
    user = await db.users.find_one({"_id": user["_id"]})
    return public_user(user)


class CompleteProfileIn(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)
    # Iter-71 — gender is no longer collected during profile completion.
    gender: Optional[Literal["male", "female"]] = None
    age: int = Field(..., ge=18, le=99)
    country_code: Optional[str] = Field(default=None, max_length=16)
    avatar_url: Optional[str] = None


@api.post("/me/profile/complete")
async def _complete_profile(body: CompleteProfileIn, user=Depends(current_user)):
    """Iter-44 — Initial profile completion flow.

    After first login (any auth method), the client gates the user through
    this endpoint. The server:
      1. Rejects re-completion if gender is already locked (unless this call
         sends the same gender — enables idempotent retry).
      2. Resolves country_code → country name + flag.
      3. Flips gender_locked=true so the gender becomes immutable.

    This endpoint is the SINGLE source of truth for setting gender. Later
    `/users/me` PATCH calls are refused if gender_locked is true.
    """
    db = app.state.db
    # Iter-89 — Gender is REQUIRED at first-time profile completion. It is
    # locked permanently after this call succeeds. The edit-profile flow
    # intentionally does NOT accept gender changes.
    if not user.get("gender_locked"):
        if body.gender not in ("male", "female"):
            raise HTTPException(422, "Gender is required for new users")
    if user.get("gender_locked") and user.get("gender") and user.get("gender") != body.gender:
        raise HTTPException(409, "Profile already completed — gender is locked")
    upd: dict = {
        "nickname": body.nickname.strip(),
        "gender": body.gender,
        "age": int(body.age),
        "gender_locked": True,
        "profile_completed": True,
        "profile_completed_at": now_utc(),
    }
    if body.country_code:
        c = _find_country(body.country_code)
        if c:
            upd["country"] = c["name"]
            upd["country_flag"] = c["flag"]
            upd["country_code"] = c["code"]
    if body.avatar_url:
        upd["avatar_url"] = body.avatar_url
    await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
    if upd.get("country_code"):
        await _sync_owner_rooms_country(db, str(user["_id"]), upd["country_code"], upd.get("country_flag"))
    user = await db.users.find_one({"_id": user["_id"]})
    return public_user(user)


@api.get("/users/by-numeric-id/{numeric_id}")
async def get_user_by_numeric_id(numeric_id: str, user=Depends(current_user)):
    """Lookup another ORIO user by their 8-digit numeric ID (used by CP/Friend search)."""
    if not numeric_id.isdigit() or len(numeric_id) < 6 or len(numeric_id) > 12:
        raise HTTPException(400, "ID must be numeric (6-12 digits)")
    db = app.state.db
    target = await db.users.find_one({"numeric_id": numeric_id})
    if not target:
        raise HTTPException(404, "User not found")
    data = public_user(target)
    data["is_following"] = bool(await db.follows.find_one(
        {"follower_id": str(user["_id"]), "followee_id": str(target["_id"])}
    ))
    data["friends"] = await db.friendships.count_documents(
        {"status": "accepted", "$or": [{"a_id": str(target["_id"])}, {"b_id": str(target["_id"])}]}
    )
    return data


# ---------------------------------------------------------------------------
# iter-44 Phase 3 — Real user search (nickname / username / numeric_id).
# Returns a limited public shape only. No private data (email, phone,
# payout methods, financial ledger) is exposed. Hard-caps result size and
# only matches users with completed profiles so brand-new signups don't
# leak before onboarding completes.
# ---------------------------------------------------------------------------
@api.get("/users/search")
async def search_users(
    q: str = Query(..., min_length=1, max_length=48),
    limit: int = Query(20, ge=1, le=50),
    user=Depends(current_user),
):
    db = app.state.db
    q_clean = q.strip()
    if not q_clean:
        return {"items": []}
    # Numeric-only query → exact numeric_id lookup first (fastest path).
    numeric_match = None
    if q_clean.isdigit() and 6 <= len(q_clean) <= 12:
        numeric_match = await db.users.find_one({"numeric_id": q_clean})
    # Build a case-insensitive regex that is safe (escape regex metachars).
    safe = re.escape(q_clean)
    mongo_q: dict = {
        "$and": [
            # Only expose users with completed profiles to prevent fresh-signup leakage.
            {"$or": [{"profile_completed": True}, {"profile_completed": {"$exists": False}}]},
            # Iter-125 — TEST accounts are hidden from real users.
            {} if _can_see_test_data(user) else {"is_test": {"$ne": True}},
            {"$or": [
                {"username": {"$regex": safe, "$options": "i"}},
                {"nickname": {"$regex": safe, "$options": "i"}},
                {"numeric_id": q_clean} if q_clean.isdigit() else {"username": {"$regex": safe, "$options": "i"}},
            ]},
        ]
    }
    cursor = db.users.find(mongo_q, {
        "_id": 1, "username": 1, "nickname": 1, "avatar_url": 1,
        "numeric_id": 1, "vip_level": 1, "country_flag": 1, "level": 1,
        "cover_url": 1, "created_at": 1,
    }).limit(int(limit))
    seen_ids: set = set()
    items: list[dict] = []
    # Strip sensitive fields from the public user shape so search can never
    # leak PII even if a future refactor adds a field to public_user.
    def _strip(u: dict) -> dict:
        for k in ("email", "phone", "password_hash", "access_secret"):
            u.pop(k, None)
        return u
    if numeric_match:
        seen_ids.add(numeric_match["_id"])
        items.append(_strip(public_user(numeric_match)))
    me_id = user["_id"]
    async for u in cursor:
        if u["_id"] in seen_ids or u["_id"] == me_id:
            continue
        seen_ids.add(u["_id"])
        items.append(_strip(public_user(u)))
        if len(items) >= limit:
            break
    # Hydrate is_following in a single batch so the UI can show
    # "Follow / Unfollow" instantly without N additional round-trips.
    if items:
        following = await db.follows.find({
            "follower_id": str(me_id),
            "followee_id": {"$in": [it["id"] for it in items]},
        }, {"followee_id": 1}).to_list(len(items))
        follow_set = {f["followee_id"] for f in following}
        for it in items:
            it["is_following"] = it["id"] in follow_set
    return {"items": items, "query": q_clean}


async def _block_state(db, me: str, other: str) -> tuple[bool, bool]:
    """(i_blocked_them, they_blocked_me)."""
    rows = await db.user_blocks.find({"$or": [
        {"blocker_id": me, "blocked_id": other}, {"blocker_id": other, "blocked_id": me}]}).to_list(2)
    return (any(r["blocker_id"] == me for r in rows), any(r["blocker_id"] == other for r in rows))


async def _blocked_ids(db, me: str) -> set:
    rows = await db.user_blocks.find({"$or": [{"blocker_id": me}, {"blocked_id": me}]}).to_list(5000)
    return {r["blocked_id"] if r["blocker_id"] == me else r["blocker_id"] for r in rows}


async def _assert_not_blocked(db, me: str, other: str):
    a, b = await _block_state(db, me, other)
    if a or b:
        raise HTTPException(403, "BLOCKED")


@api.get("/users/{user_id}")
async def get_user(user_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        target = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("account_deleted"):
        raise HTTPException(410, "account_deleted")
    if user_id != str(user["_id"]):
        i_blocked, blocked_me = await _block_state(db, str(user["_id"]), user_id)
        if i_blocked or blocked_me:
            # Blocked either way → NO profile details, follow info or actions.
            return {"id": user_id, "nickname": target.get("nickname") if i_blocked else None,
                    "avatar_url": target.get("avatar_url") if i_blocked else None,
                    "i_blocked": i_blocked, "blocked_me": blocked_me, "is_blocked_view": True}
    data = public_user(target)
    data["is_following"] = bool(await db.follows.find_one({"follower_id": str(user["_id"]), "followee_id": user_id}))
    data["friends"] = await db.friendships.count_documents(
        {"status": "accepted", "$or": [{"a_id": user_id}, {"b_id": user_id}]}
    )
    # Iter-99 — live follow counts (never drift from the follows table).
    data["following"] = await db.follows.count_documents({"follower_id": user_id})
    data["followers"] = await db.follows.count_documents({"followee_id": user_id})
    data["supporter_total"] = await _supporter_total(db, user_id)
    return data


@api.get("/users/{user_id}/gifts-received")
async def get_user_gifts_received(user_id: str, user=Depends(current_user)):
    """
    Aggregate gifts received by a specific user grouped by gift_id.
    Returns a summary list (gift + count + total_diamonds) and the most recent
    senders, used by the profile Gift Gallery and the dedicated Received-Gifts page.
    """
    db = app.state.db
    # Validate the target user exists (accept either 24-char hex ObjectId or 8-digit numeric_id)
    target = None
    try:
        target = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not target and user_id.isdigit():
        target = await db.users.find_one({"numeric_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")

    resolved_id = str(target["_id"])
    # Aggregate all received gifts grouped by gift_id
    pipeline = [
        {"$match": {"recipient_id": resolved_id}},
        {"$group": {
            "_id": "$gift_id",
            "gift_name": {"$first": "$gift_name"},
            "gift_image": {"$first": "$gift_image"},
            "unit_price": {"$first": "$unit_price"},
            "total_quantity": {"$sum": "$quantity"},
            "total_cost": {"$sum": "$total_cost"},
            "last_at": {"$max": "$created_at"},
            "senders": {"$addToSet": "$sender_nickname"},
        }},
        {"$sort": {"total_cost": -1}},
    ]
    grouped = []
    async for row in db.gift_transactions.aggregate(pipeline):
        grouped.append({
            "gift_id": row["_id"],
            "gift_name": row.get("gift_name"),
            "gift_image": row.get("gift_image"),
            "unit_price": row.get("unit_price", 0),
            "total_quantity": int(row.get("total_quantity", 0)),
            "total_cost": int(row.get("total_cost", 0)),
            "last_at": row["last_at"].isoformat() if isinstance(row.get("last_at"), datetime) else row.get("last_at"),
            "senders": (row.get("senders") or [])[:5],
        })
    # Also return the last 20 raw transactions so the detail page can show
    # sender-avatars in chronological order.
    recent = []
    cur = db.gift_transactions.find(
        {"recipient_id": resolved_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20)
    async for tx in cur:
        if isinstance(tx.get("created_at"), datetime):
            tx["created_at"] = tx["created_at"].isoformat()
        recent.append(tx)
    total_gifts = sum(g["total_quantity"] for g in grouped)
    total_value = sum(g["total_cost"] for g in grouped)
    return {
        "user": {
            "id": resolved_id,
            "nickname": target.get("nickname"),
            "avatar_url": target.get("avatar_url"),
            "numeric_id": target.get("numeric_id"),
        },
        "gifts": grouped,
        "recent": recent,
        "total_gifts": total_gifts,
        "total_value": total_value,
    }




# ---------- Routes: Follows ----------
@api.post("/users/{user_id}/follow", status_code=201)
async def follow_user(user_id: str, user=Depends(current_user)):
    db = app.state.db
    if user_id == str(user["_id"]):
        raise HTTPException(400, "Cannot follow yourself")
    try:
        target = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    existing = await db.follows.find_one({"follower_id": str(user["_id"]), "followee_id": user_id})
    if existing:
        return {"following": True}
    await db.follows.insert_one({
        "follower_id": str(user["_id"]),
        "followee_id": user_id,
        "created_at": now_utc(),
    })
    await db.users.update_one({"_id": user["_id"]}, {"$inc": {"following_count": 1}})
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"followers_count": 1}})
    return {"following": True}


@api.delete("/users/{user_id}/follow")
async def unfollow_user(user_id: str, user=Depends(current_user)):
    db = app.state.db
    r = await db.follows.delete_one({"follower_id": str(user["_id"]), "followee_id": user_id})
    if r.deleted_count:
        await db.users.update_one({"_id": user["_id"]}, {"$inc": {"following_count": -1}})
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"followers_count": -1}})
    return {"following": False}


# ---------- Routes: Blocks & Reports ----------
# Real Block: writes to `user_blocks` collection. Blocking a user also breaks any
# existing follow relationship in BOTH directions so the block is meaningful.
@api.post("/users/{user_id}/block", status_code=201)
async def block_user(user_id: str, user=Depends(current_user)):
    db = app.state.db
    if user_id == str(user["_id"]):
        raise HTTPException(400, "Cannot block yourself")
    try:
        target = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    existing = await db.user_blocks.find_one({"blocker_id": str(user["_id"]), "blocked_id": user_id})
    if not existing:
        await db.user_blocks.insert_one({
            "blocker_id": str(user["_id"]),
            "blocked_id": user_id,
            "created_at": now_utc(),
        })
        # Break follows in both directions.
        r1 = await db.follows.delete_one({"follower_id": str(user["_id"]), "followee_id": user_id})
        if r1.deleted_count:
            await db.users.update_one({"_id": user["_id"]}, {"$inc": {"following_count": -1}})
            await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"followers_count": -1}})
        r2 = await db.follows.delete_one({"follower_id": user_id, "followee_id": str(user["_id"])})
        if r2.deleted_count:
            await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"following_count": -1}})
            await db.users.update_one({"_id": user["_id"]}, {"$inc": {"followers_count": -1}})
    return {"blocked": True}


@api.delete("/users/{user_id}/block")
async def unblock_user(user_id: str, user=Depends(current_user)):
    db = app.state.db
    await db.user_blocks.delete_one({"blocker_id": str(user["_id"]), "blocked_id": user_id})
    return {"blocked": False}


# Real Report: persists to `user_reports` collection for moderators to review.
class ReportUserIn(BaseModel):
    reason: Optional[str] = None
    # 1–3 selected reasons (validated against _ALLOWED_REPORT_REASONS).
    reasons: Optional[list[str]] = Field(default=None, max_length=3)
    details: Optional[str] = None
    # Iter-51 §6 — optional base64 media attachment (image or video).
    # Payload is `data:<mime>;base64,…` — kept small (<=2MB) so a direct DB
    # store is acceptable at this scale; swap for object storage when traffic
    # warrants it.
    media_data_url: Optional[str] = Field(default=None, max_length=3_000_000)
    media_kind: Optional[Literal["image", "video"]] = None
    # Iter-117 — object-storage evidence URLs (/api/media/files/{id}).
    media_urls: list[str] = Field(default_factory=list, max_length=3)


_ALLOWED_REPORT_REASONS = {
    "illegal", "porn", "very_dangerous", "fraud", "insult",
    "ads", "religious_content", "political_content", "other",
}


@api.post("/users/{user_id}/report", status_code=201)
async def report_user(user_id: str, payload: ReportUserIn, user=Depends(current_user)):
    db = app.state.db
    if user_id == str(user["_id"]):
        raise HTTPException(400, "Cannot report yourself")
    try:
        target = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    # Validate reason — accept known categories or "other".
    raw_reason = (payload.reason or "other").strip().lower()[:48]
    if raw_reason not in _ALLOWED_REPORT_REASONS:
        raw_reason = "other"
    # 250-char description per iter-51 §6 spec.
    details = (payload.details or "")[:250]
    doc: dict = {
        "reporter_id": str(user["_id"]),
        "reported_id": user_id,
        "reason": raw_reason,
        "reasons": _norm_reasons(payload, raw_reason),
        "details": details,
        "status": "open",
        "created_at": now_utc(),
    }
    # Attach optional media. Validate shape and kind cheaply.
    if payload.media_data_url and payload.media_kind in ("image", "video"):
        if not payload.media_data_url.startswith("data:"):
            raise HTTPException(400, "media_data_url must be a data URL")
        # Reject anything over ~2MB raw (base64 inflates ~1.37x).
        if len(payload.media_data_url) > 2_800_000:
            raise HTTPException(413, "Attachment is too large (max ~2MB)")
        doc["media_kind"] = payload.media_kind
        doc["media_data_url"] = payload.media_data_url
    # Iter-117 — object-storage evidence: up to 3 images OR 1 video.
    m_urls = [u for u in (payload.media_urls or []) if isinstance(u, str) and u]
    if m_urls:
        if payload.media_kind == "video" and len(m_urls) > 1:
            raise HTTPException(400, "Only one video allowed")
        if len(m_urls) > 3:
            raise HTTPException(400, "Up to 3 images allowed")
        for u in m_urls:
            await _assert_media_owned(db, u, str(user["_id"]))
        doc["media_kind"] = payload.media_kind or "image"
        doc["media_urls"] = m_urls
    r = await db.user_reports.insert_one(doc)
    # Iter-98 — confirmation notification for the reporter.
    await _sys_notify(db, str(user["_id"]), "report_received", {}, None,
                      "We received your report and will do our best to handle it. Thank you. Yazeen Team.")
    return {"reported": True, "id": str(r.inserted_id)}


import moderation as _mod  # noqa: E402


def _guard_text(*texts) -> None:
    """Iter-135 — reject prohibited words BEFORE anything is saved/delivered."""
    for t in texts:
        if isinstance(t, str) and t and _mod.find_violation(t):
            raise HTTPException(400, "CONTENT_BLOCKED")


async def _load_banned_words(db) -> list:
    d = await db.config.find_one({"_id": "banned_words"})
    words = list((d or {}).get("words") or [])
    _mod.set_extra(words)
    return words


def _can_see_test_data(user: dict) -> bool:
    return bool(user.get("is_test") or user.get("is_admin") or user.get("admin_access"))


# ---------- Routes: Rooms ----------
@api.get("/rooms/search")
async def _rooms_search(q: str = Query(..., min_length=1, max_length=48), user=Depends(current_user)):
    """Rooms matching a room name, or owned by users matching nickname /
    username / numeric ID. `users_without_room` lists matched users that
    haven't opened a voice room yet."""
    db = app.state.db
    qc = q.strip()
    safe = re.escape(qc)
    uq: dict = {"$or": [{"nickname": {"$regex": safe, "$options": "i"}}, {"username": {"$regex": safe, "$options": "i"}}]}
    if qc.isdigit():
        uq["$or"].append({"numeric_id": qc})
    if not _can_see_test_data(user):
        uq = {"$and": [uq, {"is_test": {"$ne": True}}]}
    matched = await db.users.find(uq, {"nickname": 1, "numeric_id": 1}).limit(30).to_list(30)
    owner_ids = [str(u["_id"]) for u in matched]
    rq = {"is_deleted": {"$ne": True}, "$or": [{"name": {"$regex": safe, "$options": "i"}}, {"owner_id": {"$in": owner_ids}}]}
    if qc.isdigit():
        rq["$or"].append({"numeric_id": qc})
    rooms = await db.rooms.find(rq, {"password_hash": 0}).sort([("is_live", -1), ("listeners_count", -1)]).limit(40).to_list(40)
    with_room = {r.get("owner_id") for r in rooms}
    return {
        "rooms": [public_room(r) for r in rooms],
        "users_without_room": [{"id": str(u["_id"]), "nickname": u.get("nickname"), "numeric_id": u.get("numeric_id")}
                               for u in matched if str(u["_id"]) not in with_room],
    }


@api.get("/rooms")
async def list_rooms(
    category: Optional[str] = None,
    country_code: Optional[str] = None,
    sort: str = "listeners",  # "listeners" | "recommended"
    user=Depends(current_user),
):
    db = app.state.db
    q: dict = {"is_live": True, "is_deleted": {"$ne": True}}
    if category and category != "all":
        q["category"] = category
    if country_code and country_code.lower() != "all":
        q["country_code"] = country_code.upper()
    # Discovery still hides fully-empty rooms (per iter-16 spec) — but the
    # underlying room documents are NEVER auto-deleted (iter-18 persistence rule).
    # Iter-122 — "empty" now uses the SAME live socket presence as `live_count`.
    live_ids = [ObjectId(rid) for rid, p in _hub.presence.items() if p and _is_valid_oid(rid)]
    # Iter-125 — TEST rooms (seed_test_data.py) are visible ONLY to test accounts
    # and admins; real users never see them.
    if _can_see_test_data(user):
        q["$or"] = [{"_id": {"$in": live_ids}}, {"is_test": True}]
    else:
        q["_id"] = {"$in": live_ids}
        q["is_test"] = {"$ne": True}
    if sort == "recommended":
        # Real activity ranking:
        #   listeners_count *3  +  follow_count *2  +  gifts_last_hour *5
        one_hour_ago = now_utc() - timedelta(hours=1)
        pipeline = [
            {"$match": q},
            # Iter-121 — localField/foreignField lookup so the room_id+created_at index is used.
            {"$addFields": {"_rid_str": {"$toString": "$_id"}}},
            {"$lookup": {
                "from": "gift_transactions",
                "localField": "_rid_str",
                "foreignField": "room_id",
                "pipeline": [
                    {"$match": {"created_at": {"$gte": one_hour_ago}}},
                    {"$count": "n"},
                ],
                "as": "recent_gifts",
            }},
            {"$addFields": {
                "recent_gift_count": {"$ifNull": [{"$arrayElemAt": ["$recent_gifts.n", 0]}, 0]},
                "reco_score": {"$add": [
                    {"$multiply": [{"$ifNull": ["$listeners_count", 0]}, 3]},
                    {"$multiply": [{"$ifNull": ["$follow_count", 0]}, 2]},
                    {"$multiply": [{"$ifNull": [{"$arrayElemAt": ["$recent_gifts.n", 0]}, 0]}, 5]},
                ]},
            }},
            {"$project": {"password_hash": 0, "pin_hash": 0, "recent_gifts": 0, "_rid_str": 0}},
            {"$sort": {"reco_score": -1, "listeners_count": -1}},
            {"$limit": 50},
        ]
        rooms = [r async for r in db.rooms.aggregate(pipeline)]
        return await _rooms_out(app.state.db, rooms)
    if sort == "popular":
        # Popular = simple sort by follow_count then listeners.
        rooms = await db.rooms.find(q, {"password_hash": 0, "pin_hash": 0}) \
            .sort([("follow_count", -1), ("listeners_count", -1)]).to_list(50)
        return await _rooms_out(app.state.db, rooms)
    if sort == "pk":
        # Rooms currently running a PK match.
        active_pk_room_ids = await db.pk_matches.distinct("room_id", {"status": "active"})
        if not active_pk_room_ids:
            return []
        oids = [ObjectId(x) for x in active_pk_room_ids if _is_valid_oid(x)]
        q2 = {"$and": [q, {"_id": {"$in": oids}}]}
        rooms = await db.rooms.find(q2, {"password_hash": 0, "pin_hash": 0}) \
            .sort("listeners_count", -1).to_list(50)
        return await _rooms_out(app.state.db, rooms)
    rooms = await db.rooms.find(q, {"password_hash": 0, "pin_hash": 0}).sort("listeners_count", -1).to_list(50)
    return await _rooms_out(app.state.db, rooms)


async def _rooms_out(db, rooms: list) -> list:
    """public_room + the owner's LIVE vip_level (owner_public is a creation snapshot)."""
    outs = [public_room(r) for r in rooms]
    ids = list({ObjectId(o["owner_id"]) for o in outs if _is_valid_oid(o.get("owner_id") or "")})
    vip = {str(u["_id"]): int(u.get("vip_level", 0) or 0)
           async for u in db.users.find({"_id": {"$in": ids}}, {"vip_level": 1})} if ids else {}
    for o in outs:
        o["owner_vip_level"] = vip.get(o.get("owner_id"), 0)
    return outs


@api.get("/rooms/following")
async def _rooms_following(country_code: Optional[str] = None, user=Depends(current_user)):
    """Rooms the caller follows (regardless of live status)."""
    db = app.state.db
    my_id = str(user["_id"])
    followed_room_ids = await db.room_follows.distinct("room_id", {"user_id": my_id})
    if not followed_room_ids:
        return []
    oids = [ObjectId(x) for x in followed_room_ids if _is_valid_oid(x)]
    q: dict = {"_id": {"$in": oids}, "is_deleted": {"$ne": True}}
    if country_code and country_code.lower() != "all":
        q["country_code"] = country_code.upper()
    rooms = await db.rooms.find(q, {"password_hash": 0, "pin_hash": 0}) \
        .sort("listeners_count", -1).to_list(100)
    return await _rooms_out(app.state.db, rooms)


@api.get("/rooms/watched")
async def _rooms_watched(country_code: Optional[str] = None, user=Depends(current_user)):
    """Rooms the caller has recently entered (newest first)."""
    db = app.state.db
    my_id = str(user["_id"])
    cur = db.room_visits.find({"user_id": my_id}).sort("visited_at", -1).limit(30)
    room_ids = []
    async for v in cur:
        rid = v.get("room_id")
        if rid and rid not in room_ids:
            room_ids.append(rid)
    if not room_ids:
        return []
    oids = [ObjectId(x) for x in room_ids if _is_valid_oid(x)]
    q: dict = {"_id": {"$in": oids}, "is_deleted": {"$ne": True}}
    if country_code and country_code.lower() != "all":
        q["country_code"] = country_code.upper()
    docs = await db.rooms.find(q, {"password_hash": 0, "pin_hash": 0}).to_list(100)
    # Preserve visited order
    order = {rid: i for i, rid in enumerate(room_ids)}
    docs.sort(key=lambda d: order.get(str(d["_id"]), 999))
    return [public_room(r) for r in docs]


@api.post("/rooms", status_code=201)
async def create_room(body: CreateRoomIn, user=Depends(current_user)):
    _guard_text(body.name, body.description, body.welcome_msg, body.notice)
    db = app.state.db

    # Iter-48 — ONE ROOM PER USER (critical hard requirement). We enforce this
    # at three layers:
    #   1. Pre-check (friendly 409 error)
    #   2. Partial unique index on {owner_id, is_live:true, is_deleted:ne:true}
    #      (created in lifespan) → protects against concurrent requests
    #   3. Retry-safe insert_one that re-raises the duplicate as a 409.
    uid = str(user["_id"])
    existing = await db.rooms.find_one(
        {"owner_id": uid, "is_live": True, "is_deleted": {"$ne": True}},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(409, "You already own a room. Delete it before creating a new one.")
    # Iter-117 — strict ONE owned room: soft-archive any previously closed
    # rooms of this owner (data/memberships retained, just hidden).
    await db.rooms.update_many(
        {"owner_id": uid, "is_deleted": {"$ne": True}},
        {"$set": {"is_deleted": True, "archived_reason": "replaced_by_new_room", "archived_at": now_utc()}},
    )

    # Allowed seat counts per spec: 8 / 15 / 20 (25-mic option removed).
    if body.num_seats not in (8, 15, 20):
        raise HTTPException(400, "Seat count must be 8, 15 or 20")

    # Iter-67 — gate the room avatar/cover through the moderation + 3-day
    # block list before we accept the create. Default fallback image skips
    # the check because it's a safe Unsplash asset.
    if body.cover_url and body.cover_url.strip():
        await _ensure_cover_allowed(db, uid, body.cover_url.strip())

    # Total slots = 1 dedicated host chair (index 0) + num_seats numbered mic seats.
    total_slots = body.num_seats + 1
    seats = [{"index": i, "user": None, "muted": False, "locked": False} for i in range(total_slots)]
    # owner takes the host chair (seat 0)
    seats[0]["user"] = {
        "id": uid,
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
    }
    doc = {
        "name": body.name,
        "description": body.description or "",
        "cover_url": body.cover_url or "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=600&fit=crop",
        "category": _normalize_room_category(body.category),
        "is_private": body.is_private,
        "password_hash": pw_hash(body.password) if body.password else None,
        "max_users": body.max_users,
        "num_seats": body.num_seats,
        "owner_id": uid,
        # Owner's account country becomes the room's country for discovery filtering.
        "country_code": (user.get("country_code") or "").upper() or None,
        "country_flag": user.get("country_flag"),
        "owner_public": {
            "id": uid,
            "nickname": user.get("nickname"),
            "username": user.get("username"),
            "numeric_id": user.get("numeric_id"),
            "avatar_url": user.get("avatar_url"),
            "vip_level": user.get("vip_level", 0),
        },
        # Iter-82 — every new room ships with the ORIO Welcome background.
        # Owner can swap it from Room Tools → الخلفية. Independent from
        # `cover_url` (room avatar).
        "background_url": "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&q=85",
        "background_preset_id": "orio_welcome",
        "seats": seats,
        "listeners_count": 1,
        "is_live": True,
        "welcome_msg": (body.welcome_msg or "").strip() or None,
        "notice": (body.notice or "").strip() or None,
        "created_at": now_utc(),
    }
    try:
        r = await db.rooms.insert_one(doc)
    except Exception as e:
        # Partial unique index violation from a concurrent request.
        msg = str(e).lower()
        if "duplicate" in msg or "e11000" in msg:
            raise HTTPException(409, "You already own a room. Delete it before creating a new one.")
        raise
    doc["_id"] = r.inserted_id
    return public_room(doc)


# ---------- My Rooms (must be declared BEFORE /rooms/{room_id} to avoid path shadowing) ----------
@api.get("/rooms/mine")
async def my_rooms(user=Depends(current_user)):
    db = app.state.db
    rooms = await db.rooms.find({"owner_id": str(user["_id"])}, {"password_hash": 0}).sort("created_at", -1).to_list(50)
    return await _rooms_out(app.state.db, rooms)


@api.get("/rooms/managed")
async def managed_rooms(user=Depends(current_user)):
    """Rooms the current user moderates but does not own."""
    db = app.state.db
    uid = str(user["_id"])
    rooms = await db.rooms.find(
        {"moderators": uid, "owner_id": {"$ne": uid}},
        {"password_hash": 0},
    ).sort("created_at", -1).to_list(50)
    return await _rooms_out(app.state.db, rooms)


@api.get("/rooms/{room_id}")
async def get_room(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        r = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"password_hash": 0})
    except Exception:
        raise HTTPException(404, "Room not found")
    if not r:
        raise HTTPException(404, "Room not found")
    return (await _rooms_out(db, [r]))[0]


async def _room_join_checks(room: dict, user: dict, body, fresh: bool) -> None:
    if fresh:
        return
    if room.get("pin_hash"):
        my_id = str(user["_id"])
        is_priv = my_id == room.get("owner_id") or my_id in (room.get("moderators") or [])
        already_seated = any(s.get("user") and s["user"].get("id") == my_id for s in room.get("seats") or [])
        if not is_priv and not already_seated:
            pin = (body or {}).get("pin") if isinstance(body, dict) else None
            if not pin or not isinstance(pin, str) or not pw_ok(pin, room["pin_hash"]):
                raise HTTPException(403, "Room is locked — enter 5-digit code")
    # Separate Room Password (5 digits) — different from PIN Lock. Same enforcement pattern.
    if room.get("room_password_hash"):
        my_id = str(user["_id"])
        is_priv = my_id == room.get("owner_id") or my_id in (room.get("moderators") or [])
        already_seated = any(s.get("user") and s["user"].get("id") == my_id for s in room.get("seats") or [])
        if not is_priv and not already_seated:
            rpw = (body or {}).get("room_password") if isinstance(body, dict) else None
            if not rpw or not isinstance(rpw, str) or not pw_ok(rpw, room["room_password_hash"]):
                raise HTTPException(403, "Room Password required — enter 5-digit password")


@api.post("/rooms/{room_id}/join")
async def join_room(room_id: str, body: Optional[dict] = None, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid, "is_live": True})
    if not room:
        raise HTTPException(404, "Room not found")
    # Ban enforcement: banned users cannot re-enter the room.
    my_id_for_ban = str(user["_id"])
    if await db.room_bans.find_one({"user_id": my_id_for_ban, "room_id": room_id}):
        raise HTTPException(403, "You are banned from this room")
    # A PIN verified seconds ago (Room Locked modal) lets the room screen's own
    # /join through without re-sending the code. Max 10 wrong codes / 10 min.
    _my = str(user["_id"])
    _ent = await db.room_entries.find_one({"user_id": _my, "room_id": room_id})
    _fresh = bool(_ent and _ent.get("granted") and _aware(_ent.get("joined_at"))
                  and (now_utc() - _aware(_ent["joined_at"])).total_seconds() < 120)
    if (room.get("pin_hash") or room.get("room_password_hash")) and not _fresh:
        _fails = await db.room_pin_fails.count_documents({"user_id": _my, "room_id": room_id,
                                                          "at": {"$gte": now_utc() - timedelta(minutes=10)}})
        if _fails >= 10:
            raise HTTPException(429, "Too many wrong attempts — try again later")
    try:
        await _room_join_checks(room, user, body, _fresh)
    except HTTPException as e:
        if e.status_code == 403 and isinstance(body, dict) and (body.get("pin") or body.get("room_password")):
            await db.room_pin_fails.insert_one({"user_id": _my, "room_id": room_id, "at": now_utc()})
        raise
    # Access grant + chat-history cutoff for THIS entry (server-authoritative).
    await db.room_entries.update_one(
        {"user_id": str(user["_id"]), "room_id": room_id},
        {"$set": {"granted": True, "joined_at": now_utc(), "entrance_played": False}}, upsert=True)
    await db.rooms.update_one({"_id": oid}, {"$inc": {"listeners_count": 1}})
    await _room_badge_on_join(db, room_id, str(user["_id"]))
    # Record a visit for the Watched/Recently visited discovery category.
    try:
        await db.room_visits.update_one(
            {"user_id": str(user["_id"]), "room_id": room_id},
            {"$set": {"visited_at": now_utc()}, "$setOnInsert": {"created_at": now_utc()}},
            upsert=True,
        )
    except Exception:
        pass
    await _task_bump(db, str(user["_id"]), "enter_room")
    r = await db.rooms.find_one({"_id": oid}, {"password_hash": 0, "pin_hash": 0})
    return public_room(r)


@api.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, user=Depends(current_user)):
    db = app.state.db
    await db.room_entries.update_one({"user_id": str(user["_id"]), "room_id": room_id}, {"$set": {"granted": False}})
    try:
        # remove from any seat
        await db.rooms.update_one(
            {"_id": ObjectId(room_id), "seats.user.id": str(user["_id"])},
            {"$set": {"seats.$.user": None, "seats.$.muted": False}},
        )
        await db.rooms.update_one(
            {"_id": ObjectId(room_id), "listeners_count": {"$gt": 0}},
            {"$inc": {"listeners_count": -1}},
        )
        await _room_badge_on_leave(db, room_id, str(user["_id"]))
    except Exception:
        pass
    return {"ok": True}


@api.post("/rooms/{room_id}/seats/take")
async def take_seat(room_id: str, body: SeatActionIn, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    seats = room["seats"]
    idx = body.seat_index
    if idx < 0 or idx >= len(seats):
        raise HTTPException(400, "Invalid seat")
    # Host chair (seat 0) is reserved for the room owner and authorized moderators.
    # This check MUST run before the occupied/locked checks so that a non-owner
    # attempting seat 0 always receives the Arabic host-only 403 message.
    if idx == 0:
        allowed_ids = {room.get("owner_id"), *(room.get("moderators") or [])}
        if str(user["_id"]) not in allowed_ids:
            raise HTTPException(403, "هذا المقعد لصاحب الغرفة فقط")
    if seats[idx].get("locked"):
        raise HTTPException(403, "Seat is locked")
    if seats[idx].get("user"):
        raise HTTPException(409, "Seat is occupied")
    # free any previous seat this user held
    await db.rooms.update_one(
        {"_id": oid, "seats.user.id": str(user["_id"])},
        {"$set": {"seats.$.user": None}},
    )
    seat_user = {
        "id": str(user["_id"]),
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
    }
    await db.rooms.update_one(
        {"_id": oid},
        {"$set": {f"seats.{idx}.user": seat_user, f"seats.{idx}.muted": False}},
    )
    r = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    try:
        await _hub.broadcast(room_id, {"type": "room_state", "room": public_room(r)})
        await _hub.broadcast(room_id, {
            "type": "system", "kind": "seat_taken",
            "user": {"id": str(user["_id"]), "nickname": user.get("nickname")},
            "seat_index": idx, "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    await _task_bump(db, str(user["_id"]), "take_mic")
    return public_room(r)


@api.post("/rooms/{room_id}/seats/leave")
async def leave_seat(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    await db.rooms.update_one(
        {"_id": oid, "seats.user.id": str(user["_id"])},
        {"$set": {"seats.$.user": None, "seats.$.muted": False}},
    )
    r = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    if not r:
        raise HTTPException(404, "Room not found")
    try:
        await _hub.broadcast(room_id, {"type": "room_state", "room": public_room(r)})
        await _hub.broadcast(room_id, {
            "type": "system", "kind": "seat_left",
            "user": {"id": str(user["_id"]), "nickname": user.get("nickname")},
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    return public_room(r)


@api.post("/rooms/{room_id}/seats/mute")
async def toggle_mute(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    idx = next((s["index"] for s in room["seats"] if s.get("user") and s["user"]["id"] == str(user["_id"])), None)
    if idx is None:
        raise HTTPException(400, "Not on a seat")
    if str(user["_id"]) in (room.get("full_muted_users") or {}):
        raise HTTPException(409, "FULL_MUTED")
    current = room["seats"][idx].get("muted", False)
    new_val = not current
    await db.rooms.update_one({"_id": oid}, {"$set": {f"seats.{idx}.muted": new_val}})
    r = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    try:
        await _hub.broadcast(room_id, {"type": "room_state", "room": public_room(r)})
        await _hub.broadcast(room_id, {
            "type": "system", "kind": "muted" if new_val else "unmuted",
            "user": {"id": str(user["_id"]), "nickname": user.get("nickname")},
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    return public_room(r)


# ---------- Routes: Wallet & Gifts ----------
@api.get("/wallet/packages")
async def get_packages(channel: Literal["mobile", "web"] = "mobile", user=Depends(current_user)):
    """Diamond top-up packages. Admin-configurable per channel (mobile vs. web)."""
    return COIN_PACKAGES_MOBILE if channel == "mobile" else COIN_PACKAGES_WEB


def _test_recharge_allowed(user: dict) -> bool:
    """Iter-134 — controlled TESTING MODE: direct (unpaid) recharge only for
    authorized test/admin accounts, and only while TEST_RECHARGE_ENABLED."""
    # Iter-135 — environment-level switch: ON in preview (every account),
    # OFF in production (set TEST_RECHARGE_ENABLED=false in deployment secrets).
    return os.environ.get("TEST_RECHARGE_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


@api.get("/wallet/recharge/eligibility")
async def _recharge_eligibility(user=Depends(current_user)):
    return {"allowed": _test_recharge_allowed(user), "mode": "test"}


@api.post("/wallet/recharge")
async def recharge(body: RechargeIn, user=Depends(current_user)):
    db = app.state.db
    if not _test_recharge_allowed(user):
        raise HTTPException(403, "Recharge is temporarily unavailable")
    pkg = next((p for p in COIN_PACKAGES if p["id"] == body.package_id), None)
    if not pkg:
        raise HTTPException(404, "Package not found")
    uid = str(user["_id"])
    # Duplicate-credit guard: one credit per client request_id (unique index).
    rid = body.request_id or secrets.token_hex(12)
    try:
        await db.recharge_requests.insert_one({"user_id": uid, "request_id": rid, "package_id": pkg["id"], "created_at": now_utc()})
    except DuplicateKeyError:
        u = await db.users.find_one({"_id": user["_id"]}, {"coins": 1, "vip_level": 1})
        return {"ok": True, "duplicate": True, "coins": int((u or {}).get("coins", 0)), "vip_level": int((u or {}).get("vip_level", 0))}
    total = int(pkg["coins"]) + int(pkg["bonus"])
    updated = await db.users.find_one_and_update(
        {"_id": user["_id"]},
        {"$inc": {"coins": total, "growth_points": total, "recharged_diamonds": total}},
        return_document=True,
    )
    new_bal = int((updated or {}).get("coins", 0))
    wtx = secrets.token_hex(12)
    await db.wallet_transactions.insert_one({
        "user_id": uid, "type": "recharge", "currency": "coins", "amount": total,
        "balance_after": new_bal, "reference_id": pkg["id"], "tx_id": wtx,
        "description": f"Purchased {pkg['label']} pack", "status": "completed",
        "payment_provider": "test_mode", "amount_usd": pkg["price_usd"],
        "rate_diamonds_per_usd": RECHARGE_DIAMONDS_PER_USD, "growth_points_awarded": total,
        "request_id": rid, "created_at": now_utc(),
    })
    await db.growth_ledger.insert_one({
        "user_id": uid, "tx_id": wtx, "source": "recharge", "amount": total, "test_mode": True,
        "diamonds_after": new_bal, "growth_after": int((updated or {}).get("growth_points", 0)),
        "package_id": pkg["id"], "created_at": now_utc(),
    })
    level = await _maybe_activate_vip(user["_id"], int((updated or {}).get("recharged_diamonds", 0)), int((updated or {}).get("vip_level", 0)))
    await _task_bump(db, uid, "recharge")
    return {"ok": True, "credited": total, "coins": new_bal, "vip_level": level,
            "recharged_diamonds": int((updated or {}).get("recharged_diamonds", 0))}


# ---------- Iter-133: Stripe Checkout (verified server-side before crediting) ----------
class _CheckoutIn(BaseModel):
    package_id: str
    origin_url: str = Field(min_length=8, max_length=300)


def _stripe_client(request: Request):
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    key = os.environ.get("STRIPE_API_KEY", "")
    if not key:
        raise HTTPException(503, "Payments not configured")
    host = str(request.base_url).rstrip("/")
    return StripeCheckout(api_key=key, webhook_url=f"{host}/api/webhook/stripe")


async def _fulfill_payment(db, session_id: str) -> bool:
    """Idempotent: credits Diamonds exactly once for a PAID session."""
    tx = await db.payment_transactions.find_one_and_update(
        {"session_id": session_id, "payment_status": "paid", "credited": {"$ne": True}},
        {"$set": {"credited": True, "credited_at": now_utc()}},
    )
    if not tx:
        return False
    total = int(tx["diamonds"])
    user_oid = ObjectId(tx["user_id"])
    updated = await db.users.find_one_and_update(
        {"_id": user_oid},
        {"$inc": {"coins": total, "growth_points": total, "recharged_diamonds": total}},
        return_document=True,
    )
    new_bal = int((updated or {}).get("coins", 0))
    wtx = secrets.token_hex(12)
    await db.wallet_transactions.insert_one({
        "user_id": tx["user_id"], "type": "recharge", "currency": "coins", "amount": total,
        "balance_after": new_bal, "reference_id": tx["package_id"], "tx_id": wtx,
        "description": f"Purchased {tx.get('label', '')} pack", "status": "completed",
        "payment_provider": "stripe", "stripe_session_id": session_id,
        "amount_usd": tx["amount"], "rate_diamonds_per_usd": RECHARGE_DIAMONDS_PER_USD,
        "growth_points_awarded": total, "created_at": now_utc(),
    })
    await db.growth_ledger.insert_one({
        "user_id": tx["user_id"], "tx_id": wtx, "source": "recharge", "amount": total,
        "diamonds_after": new_bal, "growth_after": int((updated or {}).get("growth_points", 0)),
        "package_id": tx["package_id"], "stripe_session_id": session_id, "created_at": now_utc(),
    })
    await _maybe_activate_vip(user_oid, int((updated or {}).get("recharged_diamonds", 0)), int((updated or {}).get("vip_level", 0)))
    await _task_bump(db, tx["user_id"], "recharge")
    return True


@api.post("/payments/checkout")
async def _payments_checkout(body: _CheckoutIn, request: Request, user=Depends(current_user)):
    from emergentintegrations.payments.stripe.checkout import CheckoutSessionRequest
    # Iter-134 — payment gateways temporarily removed (test-mode recharge only).
    if os.environ.get("PAYMENTS_ENABLED", "false").strip().lower() not in ("1", "true", "yes", "on"):
        raise HTTPException(410, "Payments are temporarily disabled")
    pkg = next((p for p in COIN_PACKAGES if p["id"] == body.package_id), None)
    if not pkg:
        raise HTTPException(404, "Package not found")
    origin = body.origin_url.rstrip("/")
    if not origin.startswith(("https://", "http://")):
        raise HTTPException(400, "Invalid origin")
    amount = round(pkg["price_cents"] / 100, 2)  # server-defined price only
    total = int(pkg["coins"]) + int(pkg["bonus"])
    sc = _stripe_client(request)
    req = CheckoutSessionRequest(
        amount=amount, currency="usd",
        success_url=f"{origin}/wallet?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/wallet?cancelled=1",
        metadata={"user_id": str(user["_id"]), "package_id": pkg["id"], "source": "orio_diamonds"},
    )
    session = await sc.create_checkout_session(req)
    await app.state.db.payment_transactions.insert_one({
        "session_id": session.session_id, "user_id": str(user["_id"]), "package_id": pkg["id"],
        "label": pkg["label"], "amount": amount, "currency": "usd", "diamonds": total,
        "status": "initiated", "payment_status": "pending", "credited": False,
        "created_at": now_utc(),
    })
    return {"url": session.url, "session_id": session.session_id}


@api.get("/payments/status/{session_id}")
async def _payments_status(session_id: str, request: Request, user=Depends(current_user)):
    db = app.state.db
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx or tx["user_id"] != str(user["_id"]):
        raise HTTPException(404, "Payment not found")
    if tx.get("payment_status") != "paid":
        st = await _stripe_client(request).get_checkout_status(session_id)
        await db.payment_transactions.update_one(
            {"session_id": session_id, "payment_status": {"$ne": "paid"}},
            {"$set": {"status": st.status, "payment_status": st.payment_status, "updated_at": now_utc()}},
        )
        tx["status"], tx["payment_status"] = st.status, st.payment_status
    credited_now = await _fulfill_payment(db, session_id) if tx["payment_status"] == "paid" else False
    u = await db.users.find_one({"_id": user["_id"]}, {"coins": 1, "vip_level": 1})
    return {"status": tx["status"], "payment_status": tx["payment_status"], "credited_now": credited_now,
            "diamonds": int(tx["diamonds"]), "coins": int((u or {}).get("coins", 0)),
            "vip_level": int((u or {}).get("vip_level", 0))}


@api.post("/webhook/stripe")
async def _stripe_webhook(request: Request):
    db = app.state.db
    payload = await request.body()
    try:
        ev = await _stripe_client(request).handle_webhook(payload, request.headers.get("Stripe-Signature"))
    except Exception:
        raise HTTPException(400, "Invalid webhook")
    if ev.session_id and ev.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": ev.session_id}, {"$set": {"payment_status": "paid", "status": "complete", "updated_at": now_utc()}})
        await _fulfill_payment(db, ev.session_id)
    return {"ok": True}


async def _migrate_vip_recharge_v133(db):
    """Once: lifetime recharged Diamonds from real recharge history (never
    reset / duplicated) + the 10-level thresholds. VIP levels are preserved."""
    if await db.config.find_one({"_id": "migration_vip_recharge_v133"}):
        return
    pipeline = [{"$match": {"source": {"$in": ["recharge", "recharge_agent"]}}},
                {"$group": {"_id": "$user_id", "total": {"$sum": "$amount"}}}]
    async for row in db.growth_ledger.aggregate(pipeline):
        try:
            await db.users.update_one({"_id": ObjectId(row["_id"]), "recharged_diamonds": {"$exists": False}},
                                      {"$set": {"recharged_diamonds": max(0, int(row["total"] or 0))}})
        except Exception:
            pass
    await db.config.update_one({"_id": "vip_thresholds"},
                               {"$set": {"thresholds": VIP_PROGRESSION_THRESHOLDS, "updated_at": now_utc(),
                                         "updated_by": "migration_v133"}}, upsert=True)
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.config.insert_one({"_id": "migration_vip_recharge_v133", "at": now_utc()})


async def _ensure_iter134_indexes(db):
    await db.recharge_requests.create_index([("user_id", 1), ("request_id", 1)], unique=True)
    await db.calls.create_index([("caller_id", 1), ("status", 1)])
    await db.calls.create_index([("callee_id", 1), ("status", 1)])


@api.get("/wallet/transactions")
async def transactions(user=Depends(current_user)):
    db = app.state.db
    cur = db.wallet_transactions.find({"user_id": str(user["_id"])}, {"_id": 0}).sort("created_at", -1).limit(50)
    txs = await cur.to_list(50)
    for t in txs:
        if isinstance(t.get("created_at"), datetime):
            t["created_at"] = t["created_at"].isoformat()
    return txs


# ---------- Daily Login Bonus ----------
DAILY_STREAK_REWARDS = [50, 100, 150, 200, 300, 500, 1000]  # day 1..7, then loops


@api.get("/wallet/daily-status")
async def daily_status(user=Depends(current_user)):
    last = user.get("last_daily_bonus_at")
    streak = user.get("daily_streak", 0)
    now = now_utc()
    claimable = True
    hours_until = 0
    if last:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        diff_h = (now - last).total_seconds() / 3600
        if diff_h < 24:
            claimable = False
            hours_until = int(24 - diff_h)
        elif diff_h > 48:
            streak = 0  # broken streak
    next_reward = DAILY_STREAK_REWARDS[streak % 7]
    upcoming = [{"day": (streak + i) % 7 + 1, "reward": DAILY_STREAK_REWARDS[(streak + i) % 7]} for i in range(7)]
    return {"claimable": claimable, "streak": streak, "next_reward": next_reward, "hours_until_next": hours_until, "upcoming": upcoming}


@api.post("/wallet/daily-bonus")
async def claim_daily_bonus(user=Depends(current_user)):
    db = app.state.db
    now = now_utc()
    last = user.get("last_daily_bonus_at")
    streak = user.get("daily_streak", 0)
    if last:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        diff_h = (now - last).total_seconds() / 3600
        if diff_h < 24:
            raise HTTPException(429, f"Already claimed. Come back in {int(24 - diff_h)}h")
        if diff_h > 48:
            streak = 0  # broken
    reward = DAILY_STREAK_REWARDS[streak % 7]
    new_streak = streak + 1
    r = await db.users.find_one_and_update(
        {"_id": user["_id"]},
        {"$inc": {"coins": reward}, "$set": {"last_daily_bonus_at": now, "daily_streak": new_streak}},
    )
    new_bal = (r.get("coins", 0) if r else 0) + reward
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "daily_bonus",
        "currency": "coins",
        "amount": reward,
        "balance_after": new_bal,
        "description": f"Daily login bonus (day {new_streak})",
        "status": "completed",
        "created_at": now,
    })
    return {"reward": reward, "new_balance": new_bal, "streak": new_streak}


@api.get("/gifts")
async def list_gifts(user=Depends(current_user)):
    db = app.state.db
    gifts = await db.gifts.find({"active": True}, {"_id": 0}).sort("price", 1).to_list(200)
    return gifts


@api.post("/gifts/send")
async def send_gift(body: SendGiftIn, user=Depends(current_user)):
    db = app.state.db
    gift = await db.gifts.find_one({"id": body.gift_id, "active": True}, {"_id": 0})
    if not gift:
        raise HTTPException(404, "Gift not found")
    total_cost = gift["price"] * body.quantity
    if user.get("coins", 0) < total_cost:
        raise HTTPException(402, "Insufficient coins")
    try:
        recipient_oid = ObjectId(body.recipient_id)
    except Exception:
        raise HTTPException(404, "Recipient not found")
    recipient = await db.users.find_one({"_id": recipient_oid})
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    # Iter-115: Wealth += exact diamonds spent (sender); Charm += exact
    # diamonds spent on the recipient. Self-gift credits BOTH. Levels are
    # derived server-side from these lifetime points.
    # Free gifts never award Wealth/Charm.
    pts = total_cost if _gift_awards_points(gift) else 0
    await _claim_gift_request(db, user, body.request_id)
    r = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": total_cost}},
        {"$inc": {"coins": -total_cost, "wealth_points": pts}},
    )
    if not r:
        await _release_gift_request(db, user, body.request_id)
        raise HTTPException(402, "Insufficient coins")
    # find_one_and_update default returns the doc BEFORE the update; deduct
    # here so `new_bal` matches the value AFTER the $inc.
    new_bal = r["coins"] - total_cost

    charm_reward = gift.get("charm_reward", 1) * body.quantity
    await db.users.update_one(
        {"_id": recipient_oid},
        {"$inc": {"charm_points": pts, "diamonds": max(1, total_cost // 100)}},
    )
    # Recompute display levels from preserved points (idempotent).
    try:
        await _recompute_user_levels(user["_id"])
        await _recompute_user_levels(recipient_oid)
    except Exception:
        pass

    tx_id = secrets.token_hex(12)
    now_t = now_utc()
    await db.gift_transactions.insert_one({
        "tx_id": tx_id,
        "sender_id": str(user["_id"]),
        "sender_nickname": user.get("nickname"),
        "recipient_id": body.recipient_id,
        "recipient_nickname": recipient.get("nickname"),
        "gift_id": gift["id"],
        "gift_name": gift["name"],
        "gift_image": gift.get("image_url"),
        "quantity": body.quantity,
        "unit_price": gift["price"],
        "total_cost": total_cost,
        "wealth_awarded": pts,
        "charm_awarded": pts,
        "status": "completed",
        "room_id": body.room_id,
        "created_at": now_t,
    })
    await _audit(db, str(user["_id"]), "gift_points_awarded", "gift_tx", tx_id,
                 {"sender_id": str(user["_id"]), "recipient_id": body.recipient_id, "wealth": pts, "charm": pts})
    await _room_badge_add(db, body.room_id, str(user["_id"]), body.recipient_id, pts)
    # If there is an active PK match in the room and recipient is on one of
    # the PK seats, credit the gift cost to that side's score.
    if body.room_id:
        try:
            active_pk = await db.pk_matches.find_one({"room_id": body.room_id, "status": "active"})
            if active_pk:
                if active_pk.get("user_a", {}).get("id") == body.recipient_id:
                    await db.pk_matches.update_one({"_id": active_pk["_id"]}, {"$inc": {"score_a": total_cost}})
                elif active_pk.get("user_b", {}).get("id") == body.recipient_id:
                    await db.pk_matches.update_one({"_id": active_pk["_id"]}, {"$inc": {"score_b": total_cost}})
                # Broadcast latest scores so all clients update the PK bar
                fresh = await db.pk_matches.find_one({"_id": active_pk["_id"]})
                try:
                    await _hub.broadcast(body.room_id, {"type": "pk_score", "pk": _pk_public(fresh)})
                except Exception:
                    pass
        except Exception:
            pass
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "gift_sent",
        "currency": "coins",
        "amount": -total_cost,
        "balance_after": new_bal,
        "reference_id": tx_id,
        "description": f"Sent {body.quantity}x {gift['name']} to {recipient.get('nickname')}",
        "status": "completed",
        "created_at": now_t,
    })
    return {"ok": True, "new_balance": new_bal, "tx_id": tx_id, "charm_awarded": charm_reward}


# ============================================================================
# Iter-37 — Multi-recipient gift send + categories + custom gifts + profile media
# ============================================================================

class SendGiftMultiIn(BaseModel):
    gift_id: str
    recipient_ids: list[str]
    quantity: int = 1
    room_id: Optional[str] = None
    combo_of: Optional[str] = None  # tx_id of the first send in a repeat combo
    request_id: Optional[str] = Field(default=None, max_length=64)  # Iter-115 idempotency


async def _current_room_users(db, room_id: str) -> tuple[set[str], set[str]]:
    """Return (all_room_user_ids, on_mic_user_ids) based on real presence + seats."""
    presence_ids = set((_hub.presence.get(room_id) or {}).keys())
    r = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"seats": 1, "owner_id": 1})
    if not r:
        return set(), set()
    on_mic: set[str] = set()
    for s in r.get("seats") or []:
        u = (s or {}).get("user") or {}
        uid = u.get("id")
        if uid:
            on_mic.add(uid)
    # Always include the owner in the "room users" pool if they hold a seat
    # even without a WS ping (kept surgical).
    return presence_ids | on_mic, on_mic


@api.post("/gifts/send-multi")
async def send_gift_multi(body: SendGiftMultiIn, user=Depends(current_user)):
    """Atomically send the same gift to N recipients. Total cost is validated
    server-side (`price × quantity × len(recipients)`) and deducted from
    `coins` in a single find_one_and_update guarded by $gte. Emits one WS
    `gift` event per recipient so animations replay for every mic user."""
    db = app.state.db
    if str(body.gift_id).startswith("cg_"):
        gift = await _resolve_custom_gift(db, body.gift_id, user)
    else:
        gift = await db.gifts.find_one({"id": body.gift_id, "active": True}, {"_id": 0})
    if not gift:
        raise HTTPException(404, "Gift not found")
    if body.quantity <= 0 or body.quantity > 9999:
        raise HTTPException(400, "Quantity must be 1..9999")
    recipients_raw = [r for r in (body.recipient_ids or []) if r]
    if not recipients_raw:
        raise HTTPException(400, "At least one recipient is required")
    # Dedupe while preserving order.
    # Self-gifting is allowed: the sender earns Wealth AND Charm for it.
    seen = set(); recipients: list[str] = []
    for rid in recipients_raw:
        if rid in seen:
            continue
        seen.add(rid); recipients.append(rid)
    if not recipients:
        raise HTTPException(400, "No valid recipients")
    if len(recipients) > 50:
        raise HTTPException(400, "Too many recipients (max 50)")

    # Optional room membership guard — every recipient must still be in the room.
    if body.room_id:
        try:
            _ = ObjectId(body.room_id)
        except Exception:
            raise HTTPException(400, "Invalid room_id")
        room_users, _on_mic = await _current_room_users(db, body.room_id)
        # The sender must be present too.
        if str(user["_id"]) not in room_users and str(user["_id"]) != (await db.rooms.find_one({"_id": ObjectId(body.room_id)}, {"owner_id": 1}) or {}).get("owner_id"):
            raise HTTPException(403, "You are not in this room")
        # Batch B — the room owner is always a valid (pinned) recipient.
        _owner_id = (await db.rooms.find_one({"_id": ObjectId(body.room_id)}, {"owner_id": 1}) or {}).get("owner_id")
        missing = [r for r in recipients if r not in room_users and r != str(user["_id"]) and r != _owner_id]
        if missing:
            raise HTTPException(409, f"{len(missing)} recipient(s) left the room")

    # Validate all recipient users exist in a single query.
    try:
        oids = [ObjectId(r) for r in recipients]
    except Exception:
        raise HTTPException(400, "Invalid recipient_id")
    valid = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": oids}}, {"nickname": 1, "avatar_url": 1, "vip_level": 1})}
    if len(valid) != len(recipients):
        raise HTTPException(404, "One or more recipients not found")

    unit_price = int(gift["price"])
    total_cost = unit_price * int(body.quantity) * len(recipients)
    per_recipient_cost = unit_price * int(body.quantity)
    # Free gifts never award Wealth/Charm.
    eligible = _gift_awards_points(gift)
    per_pts = per_recipient_cost if eligible else 0

    # Atomic wallet deduction (single write). Iter-115: Wealth += exact diamonds spent.
    await _claim_gift_request(db, user, body.request_id)
    r = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": total_cost}},
        {"$inc": {"coins": -total_cost, "wealth_points": per_pts * len(recipients)}},
    )
    if not r:
        await _release_gift_request(db, user, body.request_id)
        raise HTTPException(402, "Insufficient coins")
    new_bal = int(r.get("coins", 0)) - total_cost
    try:
        await _recompute_user_levels(user["_id"])  # Iter-115: sender wealth level
    except Exception:
        pass

    combo_id = body.combo_of or secrets.token_hex(6)
    now_t = now_utc()
    charm_per = int(gift.get("charm_reward", 1)) * int(body.quantity)
    diamonds_per = max(1, per_recipient_cost // 100)

    # Increment recipient stats + write per-recipient gift_transactions.
    tx_ids: list[str] = []
    for rid in recipients:
        target = valid[rid]
        await db.users.update_one(
            {"_id": ObjectId(rid)},
            {"$inc": {"charm_points": per_pts, "diamonds": diamonds_per}},
        )
        try:
            await _recompute_user_levels(ObjectId(rid))
        except Exception:
            pass
        tx_id = secrets.token_hex(12)
        tx_ids.append(tx_id)
        await db.gift_transactions.insert_one({
            "tx_id": tx_id,
            "combo_id": combo_id,
            "sender_id": str(user["_id"]),
            "sender_nickname": user.get("nickname"),
            "sender_avatar": user.get("avatar_url"),
            "recipient_id": rid,
            "recipient_nickname": target.get("nickname"),
            "recipient_avatar": target.get("avatar_url"),
            "gift_id": gift["id"],
            "gift_name": gift["name"],
            "gift_image": gift.get("image_url"),
            "quantity": int(body.quantity),
            "unit_price": unit_price,
            "total_cost": per_recipient_cost,
            "wealth_awarded": per_pts,
            "charm_awarded": per_pts,
            "status": "completed",
            "room_id": body.room_id,
            "multi_recipient_count": len(recipients),
            "created_at": now_t,
        })
        await _audit(db, str(user["_id"]), "gift_points_awarded", "gift_tx", tx_id,
                     {"sender_id": str(user["_id"]), "recipient_id": rid, "wealth": per_pts, "charm": per_pts, "combo_id": combo_id})
        await _room_badge_add(db, body.room_id, str(user["_id"]), rid, per_pts)
        # Iter-38: write to the financial ledger (idempotent per `tx_id`).
        # Only hosts (agency members with role=HOST or AGENCY_OWNER) have the
        # recipient_id resolved to an active agency; non-host recipients still
        # get a ledger row with agency_id=null (treated as personal earning).
        try:
            await _record_ledger_tx(
                db,
                reference_id=tx_id,
                source="gift",
                user_id=rid,
                gross_amount=per_recipient_cost,
                currency="coins",
                metadata={
                    "gift_id": gift["id"],
                    "quantity": int(body.quantity),
                    "unit_price": unit_price,
                    "sender_id": str(user["_id"]),
                    "room_id": body.room_id,
                    "combo_id": combo_id,
                },
            )
        except Exception:
            pass
        # PK credit if either seat matches recipient.
        if body.room_id:
            try:
                active_pk = await db.pk_matches.find_one({"room_id": body.room_id, "status": "active"})
                if active_pk:
                    if active_pk.get("user_a", {}).get("id") == rid:
                        await db.pk_matches.update_one({"_id": active_pk["_id"]}, {"$inc": {"score_a": per_recipient_cost}})
                    elif active_pk.get("user_b", {}).get("id") == rid:
                        await db.pk_matches.update_one({"_id": active_pk["_id"]}, {"$inc": {"score_b": per_recipient_cost}})
                    fresh = await db.pk_matches.find_one({"_id": active_pk["_id"]})
                    try:
                        await _hub.broadcast(body.room_id, {"type": "pk_score", "pk": _pk_public(fresh)})
                    except Exception:
                        pass
            except Exception:
                pass
    try:
        await _recompute_user_levels(user["_id"])
    except Exception:
        pass
    # Single wallet_transactions entry for the whole batch.
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "gift_sent",
        "currency": "coins",
        "amount": -total_cost,
        "balance_after": new_bal,
        "reference_id": combo_id,
        "description": f"Sent {body.quantity}x {gift['name']} to {len(recipients)} recipient(s)",
        "status": "completed",
        "created_at": now_t,
    })
    # Broadcast one gift event per recipient so the room animates each.
    if body.room_id:
        try:
            await _hub.broadcast(body.room_id, {
                "type": "gift_batch",
                "combo_id": combo_id,
                "sender": {"id": str(user["_id"]), "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"), "vip_level": user.get("vip_level", 0),
                           "wealth_level": int(user.get("wealth_level", 0) or 0), "charm_level": int(user.get("charm_level", 0) or 0), "age": user.get("age")},
                "gift": {"id": gift["id"], "name": gift["name"], "name_ar": gift.get("name_ar"), "image_url": gift.get("image_url"), "price": unit_price, "rarity": gift.get("rarity"),
                         "animation_url": gift.get("animation_url"), "luxury_fx": gift.get("luxury_fx"), "video_url": gift.get("video_url")},
                "quantity": int(body.quantity),
                "recipients": [{"id": rid, "nickname": valid[rid].get("nickname"), "avatar_url": valid[rid].get("avatar_url")} for rid in recipients],
                "at": now_t.isoformat(),
            })
        except Exception:
            pass
        # Batch B — global GOLD announcement for gifts worth > 2,999 diamonds.
        if total_cost > 2999:
            try:
                _rdoc = await db.rooms.find_one({"_id": ObjectId(body.room_id)}, {"name": 1, "title": 1}) or {}
                _vl = int(user.get("vip_level", 0) or 0)
                await _global_hub.broadcast({
                    "type": "luxury_gift",
                    "id": f"{combo_id}:{tx_ids[0] if tx_ids else ''}",
                    "room_id": body.room_id,
                    "room_name": _rdoc.get("name") or _rdoc.get("title"),
                    "sender": {"id": str(user["_id"]), "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"),
                               "vip_level": _vl, "name_color": _vip_name_color(_vl)},
                    "recipient": {"id": recipients[0], "nickname": valid[recipients[0]].get("nickname")},
                    "recipient_count": len(recipients),
                    "gift": {"id": gift["id"], "name": gift["name"], "name_ar": gift.get("name_ar"), "image_url": gift.get("image_url")},
                    "quantity": int(body.quantity),
                    "total_cost": total_cost,
                    "at": now_t.isoformat(),
                })
            except Exception:
                pass
    return {
        "ok": True,
        "combo_id": combo_id,
        "tx_ids": tx_ids,
        "new_balance": new_bal,
        "total_cost": total_cost,
        "recipient_count": len(recipients),
    }


# ---- Gift categories ------------------------------------------------------

GIFT_CATEGORY_ORDER = ["gift", "lucky", "privilege", "custom", "relationship", "fashion", "countries"]


@api.get("/gifts/categories")
async def _list_gift_categories(user=Depends(current_user)):
    """Static ordered list of gift category keys. Frontend maps to localized labels."""
    return {"categories": GIFT_CATEGORY_ORDER}


# ---- Custom gifts (VIP5+) -------------------------------------------------

class CustomGiftCreateIn(BaseModel):
    media_url: str
    media_type: str  # "image" | "video"
    name: Optional[str] = None
    video_url: Optional[str] = None  # optional ≤10s video shown alongside the image


async def _get_custom_gift_settings(db) -> dict:
    doc = await db.config.find_one({"_id": "custom_gifts"}) or {}
    return {
        "enabled": bool(doc.get("enabled", True)),
        "min_vip_level": int(doc.get("min_vip_level", 5)),
        "price": int(doc.get("price", 5000)),
        "max_file_bytes": int(doc.get("max_file_bytes", 20 * 1024 * 1024)),
        "allowed_types": doc.get("allowed_types") or ["image", "video"],
        "max_video_duration_s": int(doc.get("max_video_duration_s", 15)),
        "auto_approve": bool(doc.get("auto_approve", False)),
        "max_per_user": int(doc.get("max_per_user", 3)),
    }


@api.get("/gifts/custom/settings")
async def _get_custom_gift_public_settings(user=Depends(current_user)):
    s = await _get_custom_gift_settings(app.state.db)
    return {
        "enabled": s["enabled"],
        "min_vip_level": s["min_vip_level"],
        "price": CUSTOM_GIFT_PRICE,
        "allowed_types": ["image", "video"],
        "max_file_bytes": s["max_file_bytes"],
        "max_video_duration_s": 10,
        "eligible": int(user.get("vip_level", 0)) >= 5 and s["enabled"],
    }


@api.get("/gifts/custom")
async def _list_my_custom_gifts(user=Depends(current_user)):
    """Public custom-gift catalog: every live custom gift (all users can send).
    `mine` flags the caller's own creations."""
    db = app.state.db
    items: list[dict] = []
    async for g in db.custom_gifts.find({"deleted": {"$ne": True}, "status": "approved"}).sort("created_at", -1).limit(300):
        items.append({
            "id": str(g["_id"]),
            "gift_id": f"cg_{g['_id']}",
            "name": g.get("name") or "Custom",
            "image_url": g.get("media_url"),
            "media_url": g.get("media_url"),
            "media_type": g.get("media_type"),
            "video_url": g.get("video_url"),
            "price": CUSTOM_GIFT_PRICE,
            "status": g.get("status", "pending"),
            "rarity": "legendary",
            "category": "custom",
            "mine": g.get("owner_id") == str(user["_id"]),
            "owner_nickname": g.get("owner_nickname"),
            "created_at": (g.get("created_at").isoformat() if isinstance(g.get("created_at"), datetime) else None),
        })
    return {"items": items}


CUSTOM_GIFT_PRICE = 4999  # fixed by product spec


async def _resolve_custom_gift(db, gift_id: str, user: dict) -> Optional[dict]:
    """Custom image gifts (VIP5+) — only their creator can send them."""
    try:
        g = await db.custom_gifts.find_one({"_id": ObjectId(gift_id[3:]), "deleted": {"$ne": True}})
    except Exception:
        g = None
    if not g or g.get("status") != "approved":
        return None
    return {"id": gift_id, "name": g.get("name") or "Custom Gift", "name_ar": g.get("name") or "هدية مخصصة",
            "price": CUSTOM_GIFT_PRICE, "image_url": g.get("media_url"), "rarity": "legendary",
            "category": "custom", "animation_url": None, "video_url": g.get("video_url")}


@api.post("/gifts/custom", status_code=201)
async def _create_custom_gift(body: CustomGiftCreateIn, user=Depends(current_user)):
    db = app.state.db
    s = await _get_custom_gift_settings(db)
    if not s["enabled"]:
        raise HTTPException(400, "Custom gifts are disabled")
    if int(user.get("vip_level", 0)) < 5:
        raise HTTPException(403, "Requires VIP 5+")
    mt = (body.media_type or "").lower()
    if mt != "image":
        raise HTTPException(400, "Custom gifts must be images")
    # Media must be an image this user uploaded through ORIO storage (purpose=gift).
    _m = re.match(r"^/api/media/files/([0-9a-f]{24})$", body.media_url or "")
    if not _m:
        raise HTTPException(400, "Invalid media")
    _f = await db.media_files.find_one({"_id": ObjectId(_m.group(1)), "owner_id": str(user["_id"]), "is_deleted": {"$ne": True}})
    if not _f or _f.get("kind") != "image" or _f.get("purpose") != "gift":
        raise HTTPException(400, "Invalid media")
    if not body.video_url:
        raise HTTPException(400, "Gift video is required (up to 10 seconds)")
    if body.video_url:
        _vm = re.match(r"^/api/media/files/([0-9a-f]{24})$", body.video_url)
        _vf = await db.media_files.find_one({"_id": ObjectId(_vm.group(1)), "owner_id": str(user["_id"]), "is_deleted": {"$ne": True}}) if _vm else None
        if not _vf or _vf.get("kind") != "video" or _vf.get("purpose") != "gift" or _vf.get("duration") is None or float(_vf["duration"]) > 10.5:
            raise HTTPException(400, "Gift video must be 10 seconds or shorter")
    # Unlimited custom gifts for VIP5+ (no daily/monthly/total cap).
    doc = {
        "owner_id": str(user["_id"]),
        "owner_nickname": user.get("nickname"),
        "name": (body.name or "Custom Gift").strip()[:40],
        "media_url": body.media_url,
        "media_type": mt,
        "video_url": body.video_url or None,
        "price": CUSTOM_GIFT_PRICE,  # server-authoritative, user cannot override
        "status": "approved",
        "created_at": now_utc(),
    }
    r = await db.custom_gifts.insert_one(doc)
    return {"id": str(r.inserted_id), "status": doc["status"], "price": doc["price"]}


@api.delete("/gifts/custom/{cg_id}")
async def _delete_custom_gift(cg_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(cg_id)
    except Exception:
        raise HTTPException(404, "Not found")
    r = await db.custom_gifts.update_one(
        {"_id": oid, "owner_id": str(user["_id"])},
        {"$set": {"deleted": True, "deleted_at": now_utc()}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---- Admin: custom gifts moderation (remove live custom gifts) ----
@api.get("/admin/custom-gifts")
async def _admin_custom_gifts(user=Depends(current_user)):
    await _require_admin_perm(user, "rooms.manage")
    out = []
    async for g in app.state.db.custom_gifts.find({"deleted": {"$ne": True}}).sort("created_at", -1).limit(300):
        out.append({"id": str(g["_id"]), "name": g.get("name"), "image_url": g.get("media_url"), "video_url": g.get("video_url"),
                    "owner_id": g.get("owner_id"), "owner_nickname": g.get("owner_nickname"),
                    "created_at": g["created_at"].isoformat() if isinstance(g.get("created_at"), datetime) else None})
    return {"items": out}


@api.delete("/admin/custom-gifts/{cg_id}")
async def _admin_delete_custom_gift(cg_id: str, user=Depends(current_user)):
    await _require_admin_perm(user, "rooms.manage")
    try:
        oid = ObjectId(cg_id)
    except Exception:
        raise HTTPException(404, "Not found")
    r = await app.state.db.custom_gifts.update_one({"_id": oid}, {"$set": {"deleted": True, "deleted_at": now_utc(), "deleted_by": str(user["_id"])}})
    if not r.matched_count:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---- Profile media (static + animated) ------------------------------------

class ProfileMediaIn(BaseModel):
    url: str
    kind: str  # "avatar" | "animated_avatar"


@api.patch("/users/me/profile-media")
async def _set_profile_media(body: ProfileMediaIn, user=Depends(current_user)):
    """Update the current user's static or animated avatar. Storage is done by
    the client via Emergent object storage (Presigned upload). This endpoint
    only persists the resulting URL on the user doc."""
    db = app.state.db
    k = (body.kind or "").lower()
    if k not in {"avatar", "animated_avatar"}:
        raise HTTPException(400, "kind must be 'avatar' or 'animated_avatar'")
    if not body.url or len(body.url) < 8:
        raise HTTPException(400, "Invalid url")
    field = "avatar_url" if k == "avatar" else "animated_avatar_url"
    await db.users.update_one({"_id": user["_id"]}, {"$set": {field: body.url, "avatar_updated_at": now_utc()}})
    # Iter-76 — the Iter-75 live-sync to `rooms.owner_public.avatar_url`
    # has been removed. The room's owner snapshot is immutable after
    # creation, per spec.
    updated = await db.users.find_one({"_id": user["_id"]}, {"avatar_url": 1, "animated_avatar_url": 1})
    return {"ok": True, "avatar_url": updated.get("avatar_url"), "animated_avatar_url": updated.get("animated_avatar_url")}


# ---------- Routes: Messages ----------
def thread_key(a: str, b: str) -> str:
    return "_".join(sorted([a, b]))


_ONLINE_WINDOW_S = 75


def _is_online(u: dict) -> bool:
    """Real presence: app heartbeat within the last 75s (and not hidden)."""
    if (u.get("settings") or {}).get("hide_online"):
        return False
    t = u.get("last_seen_at")
    if not isinstance(t, datetime):
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (now_utc() - t).total_seconds() <= _ONLINE_WINDOW_S


@api.post("/presence/ping")
async def _presence_ping(user=Depends(current_user)):
    await app.state.db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": now_utc()}})
    return {"ok": True}


@api.post("/presence/offline")
async def _presence_offline(user=Depends(current_user)):
    # Keep an accurate last-seen time while immediately reading as offline.
    await app.state.db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen_at": now_utc() - timedelta(seconds=_ONLINE_WINDOW_S + 1)}})
    return {"ok": True}


@api.get("/users/{user_id}/presence")
async def _user_presence(user_id: str, user=Depends(current_user)):
    try:
        u = await app.state.db.users.find_one({"_id": ObjectId(user_id)}, {"last_seen_at": 1, "settings": 1})
    except Exception:
        u = None
    if not u:
        raise HTTPException(404, "User not found")
    hidden = bool((u.get("settings") or {}).get("hide_online"))
    t = u.get("last_seen_at")
    return {"online": _is_online(u), "last_seen_at": (None if hidden or not isinstance(t, datetime) else _aware(t).isoformat())}


@api.get("/messages/unread-count")
async def _messages_unread_count(user=Depends(current_user)):
    n = await app.state.db.messages.count_documents({"recipient_id": str(user["_id"]), "read": False, "hidden_for": {"$ne": str(user["_id"])}})
    return {"unread": n}


class _BannedWordsIn(BaseModel):
    words: list[str] = Field(default_factory=list, max_length=2000)


@api.get("/admin/moderation/words")
async def _admin_words_get(user=Depends(current_user)):
    await _require_admin_perm(user, "messages.review")
    words = await _load_banned_words(app.state.db)
    return {"words": words, "builtin_en": _mod.BUILTIN_EN, "builtin_ar": _mod.BUILTIN_AR}


@api.put("/admin/moderation/words")
async def _admin_words_put(body: _BannedWordsIn, user=Depends(current_user)):
    await _require_admin_perm(user, "messages.review")
    words = sorted({w.strip()[:60] for w in body.words if isinstance(w, str) and w.strip()})
    await app.state.db.config.update_one({"_id": "banned_words"}, {"$set": {"words": words, "updated_at": now_utc(),
                                         "updated_by": str(user["_id"])}}, upsert=True)
    _mod.set_extra(words)
    return {"words": words}


@api.get("/messages/threads")
async def list_threads(user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    prefs = {p["peer_id"]: p async for p in db.dm_prefs.find({"user_id": uid})}
    pipeline = [
        {"$match": {"$or": [{"sender_id": uid}, {"recipient_id": uid}], "hidden_for": {"$ne": uid}}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$thread_key", "last": {"$first": "$$ROOT"}}},
        {"$sort": {"last.created_at": -1}},
        {"$limit": 80},
    ]
    threads = []
    async for row in db.messages.aggregate(pipeline):
        m = row["last"]
        other_id = m["recipient_id"] if m["sender_id"] == uid else m["sender_id"]
        pref = prefs.get(other_id) or {}
        cleared = _aware(pref.get("cleared_at"))
        if cleared and _aware(m.get("created_at")) and _aware(m["created_at"]) <= cleared:
            continue  # conversation deleted for me (until a newer message arrives)
        try:
            other = await db.users.find_one({"_id": ObjectId(other_id)})
        except Exception:
            continue
        if not other:
            continue
        uq = {"thread_key": row["_id"], "recipient_id": uid, "read": False, "hidden_for": {"$ne": uid}}
        if cleared:
            uq["created_at"] = {"$gt": cleared}
        unread = await db.messages.count_documents(uq)
        threads.append({
            "user": {"id": other_id, "nickname": other.get("nickname"), "avatar_url": other.get("avatar_url"),
                     "is_official": bool(other.get("is_official")), "age": other.get("age"), "gender": other.get("gender"),
                     "vip_level": int(other.get("vip_level", 0) or 0), "wealth_level": int(other.get("wealth_level", 0) or 0),
                     "charm_level": int(other.get("charm_level", 0) or 0), "name_color": other.get("name_color"),
                     "online": _is_online(other)},
            "last_message": m["text"],
            "last_kind": m.get("kind") or "text",
            "last_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
            "unread": unread,
            "pinned": bool(pref.get("pinned")),
            "_pinned_at": pref.get("pinned_at"),
        })
    # Pinned conversations stay on top (most recently pinned first), rest by recency.
    pinned = sorted([t for t in threads if t["pinned"]], key=lambda t: _aware(t["_pinned_at"]) or now_utc(), reverse=True)
    rest = [t for t in threads if not t["pinned"]]
    out = pinned + rest
    for t in out:
        t.pop("_pinned_at", None)
    return out[:50]


@api.get("/messages/with/{user_id}")
async def get_messages(user_id: str, user=Depends(current_user)):
    db = app.state.db
    key = thread_key(str(user["_id"]), user_id)
    # Iter-135 — opening the thread marks incoming messages as read.
    res = await db.messages.update_many({"thread_key": key, "recipient_id": str(user["_id"]), "read": False},
                                        {"$set": {"read": True, "read_at": now_utc()}})
    if res.modified_count:
        await _push_users([user_id, str(user["_id"])], "dm_update", peer_ids=[user_id, str(user["_id"])])
    uid = str(user["_id"])
    q: dict = {"thread_key": key, "hidden_for": {"$ne": uid}}
    pref = await db.dm_prefs.find_one({"user_id": uid, "peer_id": user_id})
    if pref and _aware(pref.get("cleared_at")):
        q["created_at"] = {"$gt": _aware(pref["cleared_at"])}
    # Latest 200, returned oldest → newest.
    msgs = await db.messages.find(q).sort("created_at", -1).limit(200).to_list(200)
    msgs.reverse()
    for m in msgs:
        m["id"] = str(m.pop("_id"))
        m.pop("hidden_for", None)
        if isinstance(m.get("created_at"), datetime):
            m["created_at"] = m["created_at"].isoformat()
        if isinstance(m.get("read_at"), datetime):
            m["read_at"] = m["read_at"].isoformat()
        if isinstance(m.get("unsent_at"), datetime):
            m["unsent_at"] = m["unsent_at"].isoformat()
    return msgs


def _aware(d):
    if isinstance(d, datetime):
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


class _ThreadPinIn(BaseModel):
    pinned: bool


@api.post("/messages/threads/{peer_id}/pin")
async def _thread_pin(peer_id: str, body: _ThreadPinIn, user=Depends(current_user)):
    uid = str(user["_id"])
    await app.state.db.dm_prefs.update_one(
        {"user_id": uid, "peer_id": peer_id},
        {"$set": {"pinned": body.pinned, "pinned_at": now_utc() if body.pinned else None}}, upsert=True)
    return {"ok": True, "pinned": body.pinned}


@api.delete("/messages/threads/{peer_id}")
async def _thread_delete(peer_id: str, user=Depends(current_user)):
    """Delete the conversation + its history for ME only. New messages
    (either direction) start a fresh conversation."""
    db = app.state.db
    uid = str(user["_id"])
    await db.messages.update_many({"thread_key": thread_key(uid, peer_id), "recipient_id": uid, "read": False},
                                  {"$set": {"read": True, "read_at": now_utc()}})
    await db.dm_prefs.update_one({"user_id": uid, "peer_id": peer_id},
                                 {"$set": {"cleared_at": now_utc(), "pinned": False, "pinned_at": None}}, upsert=True)
    await _push_users([uid], "dm_update", peer_ids=[peer_id])
    return {"ok": True}


async def _own_or_peer_message(db, message_id: str, uid: str) -> dict:
    try:
        m = await db.messages.find_one({"_id": ObjectId(message_id)})
    except Exception:
        m = None
    if not m or uid not in (m.get("sender_id"), m.get("recipient_id")):
        raise HTTPException(404, "Message not found")
    return m


MSG_EDIT_WINDOW_S = 120


def _within_edit_window(m: dict):
    """Unsend / Delete-for-everyone only within 2 minutes of sending."""
    c = _aware(m.get("created_at"))
    if m.get("kind") in ("unsent", "deleted") or not c or (now_utc() - c).total_seconds() > MSG_EDIT_WINDOW_S:
        raise HTTPException(403, "EDIT_WINDOW_EXPIRED")


@api.post("/messages/{message_id}/unsend")
async def _message_unsend(message_id: str, user=Depends(current_user)):
    """Sender only — both users see "Message Unsent"."""
    db = app.state.db
    uid = str(user["_id"])
    m = await _own_or_peer_message(db, message_id, uid)
    if m["sender_id"] != uid:
        raise HTTPException(403, "Only the sender can unsend this message")
    _within_edit_window(m)
    await db.messages.update_one({"_id": m["_id"]}, {"$set": {
        "kind": "unsent", "text": "Message Unsent", "media_url": None, "duration": None, "gift": None,
        "unsent_at": now_utc(), "read": True}})
    await _push_users([m["sender_id"], m["recipient_id"]], "dm_update", peer_ids=[m["sender_id"], m["recipient_id"]])
    return {"ok": True}


class _MsgDeleteIn(BaseModel):
    scope: Literal["me", "everyone"]


@api.post("/messages/{message_id}/delete")
async def _message_delete(message_id: str, body: _MsgDeleteIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    m = await _own_or_peer_message(db, message_id, uid)
    if body.scope == "me":
        await db.messages.update_one({"_id": m["_id"]}, {"$addToSet": {"hidden_for": uid}})
    else:
        if m["sender_id"] != uid:
            raise HTTPException(403, "Only the sender can delete this message for everyone")
        _within_edit_window(m)
        await db.messages.update_one({"_id": m["_id"]}, {"$set": {
            "kind": "deleted", "text": "This message was deleted for everyone.", "media_url": None,
            "duration": None, "gift": None, "deleted_at": now_utc(), "read": True}})
    await _push_users([m["sender_id"], m["recipient_id"]] if body.scope == "everyone" else [uid], "dm_update",
                      peer_ids=[m["sender_id"], m["recipient_id"]])
    return {"ok": True}


@api.post("/messages/send")
async def send_message(body: SendMessageIn, user=Depends(current_user)):
    _guard_text(body.text)
    db = app.state.db
    try:
        recipient = await db.users.find_one({"_id": ObjectId(body.recipient_id)})
    except Exception:
        raise HTTPException(404, "Recipient not found")
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    # Iter-118 — the official Orio Team conversation is read-only.
    if recipient.get("is_official") or user.get("is_official"):
        raise HTTPException(403, "This official conversation is read-only")
    await _assert_not_blocked(db, str(user["_id"]), body.recipient_id)
    text = (body.text or "").strip()
    if body.kind == "text" and not text:
        raise HTTPException(400, "Message is empty")
    if body.kind != "text":
        await _assert_media_owned(db, body.media_url or "", str(user["_id"]))
        # Only the two participants (and admins) may fetch this private media.
        m = _MEDIA_URL_RE.search(body.media_url or "")
        await db.media_files.update_one({"_id": ObjectId(m.group(1))}, {"$addToSet": {"peer_ids": body.recipient_id}})
        text = text or ("📷 Photo" if body.kind == "image" else "🎤 Voice message")
    doc = {
        "sender_id": str(user["_id"]),
        "recipient_id": body.recipient_id,
        "thread_key": thread_key(str(user["_id"]), body.recipient_id),
        "text": text,
        "kind": body.kind,
        "media_url": body.media_url if body.kind != "text" else None,
        "duration": body.duration if body.kind == "voice" else None,
        "waveform": [round(min(1.0, max(0.0, float(v))), 3) for v in (body.waveform or [])][:64] if body.kind == "voice" else None,
        "read": False,
        "created_at": now_utc(),
    }
    await db.messages.insert_one(doc)
    await _push_users([body.recipient_id, str(user["_id"])], "dm_update", peer_ids=[str(user["_id"]), body.recipient_id])
    _preview = text if body.kind == "text" else ("📷" if body.kind == "image" else "🎤")
    await _notify_push([body.recipient_id], user.get("nickname") or "Yazeen", _preview,
                       f"/chat/{str(user['_id'])}", key=f"dm:{doc['_id']}")
    return {"ok": True, "text": text, "kind": body.kind, "created_at": doc["created_at"].isoformat()}


class _DmReactionIn(BaseModel):
    recipient_id: str
    emoji: str


@api.post("/messages/reaction")
async def _dm_send_reaction(body: _DmReactionIn, user=Depends(current_user)):
    """Batch B — animated emoji message in a private chat (saved in history)."""
    if body.emoji not in REACTION_KEYS:
        raise HTTPException(400, "Unknown reaction")
    db = app.state.db
    uid = str(user["_id"])
    now = time.time()
    if now - _reaction_last.get(f"dm:{uid}", 0) < REACTION_COOLDOWN_S:
        raise HTTPException(429, "Slow down")
    try:
        recipient = await db.users.find_one({"_id": ObjectId(body.recipient_id)}, {"is_official": 1})
    except Exception:
        recipient = None
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    if recipient.get("is_official") or user.get("is_official"):
        raise HTTPException(403, "This official conversation is read-only")
    await _assert_not_blocked(db, uid, body.recipient_id)
    _reaction_last[f"dm:{uid}"] = now
    doc = {
        "sender_id": uid, "recipient_id": body.recipient_id,
        "thread_key": thread_key(uid, body.recipient_id),
        "text": chr(int(body.emoji.split("_")[0], 16)), "kind": "emoji", "emoji": body.emoji,
        "read": False, "created_at": now_utc(),
    }
    await db.messages.insert_one(doc)
    await _push_users([body.recipient_id, uid], "dm_update", peer_ids=[uid, body.recipient_id])
    await _notify_push([body.recipient_id], user.get("nickname") or "Yazeen", doc["text"],
                       f"/chat/{uid}", key=f"dm:{doc['_id']}")
    return {"ok": True, "kind": "emoji", "emoji": body.emoji, "created_at": doc["created_at"].isoformat()}


class _DmGiftIn(BaseModel):
    recipient_id: str
    gift_id: str
    quantity: int = Field(default=1, ge=1, le=99)
    request_id: Optional[str] = Field(default=None, max_length=64)


@api.post("/messages/gift")
async def _dm_send_gift(body: _DmGiftIn, user=Depends(current_user)):
    """Iter-134 — private-chat gift: the REAL gift system (/gifts/send logic:
    diamonds, Wealth/Charm, idempotency) + a gift message in the thread."""
    db = app.state.db
    await _assert_not_blocked(db, str(user["_id"]), body.recipient_id)
    try:
        recipient = await db.users.find_one({"_id": ObjectId(body.recipient_id)}, {"is_official": 1})
    except Exception:
        recipient = None
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    if recipient.get("is_official"):
        raise HTTPException(403, "This official conversation is read-only")
    res = await send_gift(SendGiftIn(gift_id=body.gift_id, recipient_id=body.recipient_id,
                                     quantity=body.quantity, request_id=body.request_id), user)
    gift = await db.gifts.find_one({"id": body.gift_id}, {"_id": 0, "name": 1, "name_ar": 1, "image_url": 1, "icon": 1, "price": 1})
    await db.messages.insert_one({
        "sender_id": str(user["_id"]), "recipient_id": body.recipient_id,
        "thread_key": thread_key(str(user["_id"]), body.recipient_id),
        "text": f"🎁 {(gift or {}).get('name', 'Gift')} x{body.quantity}", "kind": "gift",
        "gift": {"id": body.gift_id, "quantity": body.quantity, **(gift or {})},
        "read": False, "created_at": now_utc(),
    })
    await _push_users([body.recipient_id, str(user["_id"])], "dm_update", peer_ids=[str(user["_id"]), body.recipient_id])
    await _notify_push([body.recipient_id], user.get("nickname") or "Yazeen",
                       f"🎁 {(gift or {}).get('name', 'Gift')} x{body.quantity}", f"/chat/{str(user['_id'])}",
                       key=f"dmgift:{body.request_id}" if body.request_id else None)
    return res


# ---------- Routes: Leaderboard (basic) ----------
@api.get("/leaderboards/{kind}")
async def leaderboard(kind: Literal["wealth", "charm", "level"], user=Depends(current_user)):
    db = app.state.db
    field = {"wealth": "wealth_level", "charm": "charm_level", "level": "level"}[kind]
    cur = db.users.find({}, {"nickname": 1, "avatar_url": 1, "vip_level": 1, field: 1}).sort(field, -1).limit(50)
    out = []
    async for u in cur:
        out.append({
            "id": str(u["_id"]),
            "nickname": u.get("nickname"),
            "avatar_url": u.get("avatar_url"),
            "vip_level": u.get("vip_level", 0),
            "score": u.get(field, 0),
        })
    return out


# ---------- Games ----------
# All game logic runs server-side. Client only sends bet + optional pick.
# Balance is checked, deducted, RNG runs, payout awarded, history recorded — atomic.

import random

class PlayIn(BaseModel):
    bet: int = Field(ge=10, le=100000)
    pick: Optional[str] = None  # game-specific (e.g. "heads"/"tails", "over"/"under"/"7", "rock", "1"-"10")

GAMES_META = {
    "slots":     {"name": "777 Slots",         "name_ar": "سلوتس 777",    "icon": "🎰", "min_bet": 10, "max_bet": 10000},
    "lucky77":   {"name": "Lucky 77",          "name_ar": "الحظ 77",       "icon": "🎲", "min_bet": 10, "max_bet": 10000},
    "dice":      {"name": "Dice",              "name_ar": "زهر",           "icon": "🎯", "min_bet": 10, "max_bet": 10000},
    "coinflip":  {"name": "Coin Flip",         "name_ar": "قذف العملة",    "icon": "🪙", "min_bet": 10, "max_bet": 10000},
    "cards":     {"name": "Lucky Cards",       "name_ar": "بطاقات الحظ",   "icon": "🃏", "min_bet": 10, "max_bet": 10000},
    "guess":     {"name": "Number Guess",      "name_ar": "خمّن الرقم",    "icon": "🔢", "min_bet": 10, "max_bet": 10000},
    "rps":       {"name": "Rock Paper Scissors","name_ar": "حجرة ورقة مقص","icon": "✂️", "min_bet": 10, "max_bet": 10000},
    "scratch":   {"name": "Scratch Card",      "name_ar": "بطاقة الحك",    "icon": "🎫", "min_bet": 20, "max_bet": 10000},
    "treasure":  {"name": "Treasure Boxes",    "name_ar": "صناديق الكنز",  "icon": "🎁", "min_bet": 10, "max_bet": 10000},
    "wheel":     {"name": "Lucky Wheel",       "name_ar": "عجلة الحظ",     "icon": "🎡", "min_bet": 20, "max_bet": 10000},
}

def _play_slots(bet: int):
    symbols = ["🍒", "🍋", "🍇", "🔔", "⭐", "7"]
    reels = [random.choice(symbols) for _ in range(3)]
    if reels[0] == reels[1] == reels[2] == "7":
        mult = 50
    elif reels[0] == reels[1] == reels[2]:
        mult = 10
    elif reels[0] == reels[1] or reels[1] == reels[2]:
        mult = 2
    else:
        mult = 0
    return {"reels": reels, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_lucky77(bet: int, pick: str):
    d1, d2 = random.randint(1, 6), random.randint(1, 6)
    total = d1 + d2
    if pick == "7" and total == 7: mult = 5
    elif pick == "over" and total > 7: mult = 2
    elif pick == "under" and total < 7: mult = 2
    else: mult = 0
    return {"dice": [d1, d2], "total": total, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_dice(bet: int, pick: str):
    picked = int(pick) if pick and pick.isdigit() else 0
    rolled = random.randint(1, 6)
    mult = 5 if rolled == picked else 0
    return {"picked": picked, "rolled": rolled, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_coinflip(bet: int, pick: str):
    result = random.choice(["heads", "tails"])
    mult = 2 if pick == result else 0
    return {"picked": pick, "result": result, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_cards(bet: int, pick: str):
    picked = int(pick) if pick and pick.isdigit() else -1
    winning = random.randint(0, 3)
    mult = 35 // 10 if picked == winning else 0  # 3.5x -> approximate integer
    payout = int(bet * 3.5) if picked == winning else 0
    return {"picked": picked, "winning": winning, "mult": 3.5 if picked == winning else 0, "payout": payout, "win": picked == winning}

def _play_guess(bet: int, pick: str):
    picked = int(pick) if pick and pick.isdigit() else -1
    winning = random.randint(1, 10)
    mult = 8 if picked == winning else 0
    return {"picked": picked, "winning": winning, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_rps(bet: int, pick: str):
    choices = ["rock", "paper", "scissors"]
    if pick not in choices:
        raise HTTPException(400, "Invalid pick")
    comp = random.choice(choices)
    if pick == comp:
        mult = 1  # refund tie
    elif (pick == "rock" and comp == "scissors") or (pick == "paper" and comp == "rock") or (pick == "scissors" and comp == "paper"):
        mult = 2
    else:
        mult = 0
    return {"picked": pick, "comp": comp, "mult": mult, "payout": bet * mult, "win": mult >= 2, "tie": mult == 1}

def _play_scratch(bet: int):
    symbols = ["💎", "🍀", "⭐", "💰", "🎯", "🎁"]
    cells = [random.choice(symbols) for _ in range(9)]
    counts = {s: cells.count(s) for s in set(cells)}
    top = max(counts.values())
    if top >= 3:
        mult = 20 if "💎" in [s for s, c in counts.items() if c >= 3] else 10
    elif top == 2:
        mult = 2
    else:
        mult = 0
    return {"cells": cells, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_treasure(bet: int, pick: str):
    picked = int(pick) if pick and pick.isdigit() else -1
    if not (0 <= picked <= 4):
        raise HTTPException(400, "Invalid pick")
    contents = [0, 1, 2, 5, 10]
    random.shuffle(contents)
    mult = contents[picked]
    return {"picked": picked, "contents": contents, "mult": mult, "payout": bet * mult, "win": mult > 0}

def _play_wheel(bet: int):
    segments = [0, 1, 2, 0, 3, 0, 5, 10]  # 8 segments
    idx = random.randint(0, 7)
    mult = segments[idx]
    return {"segment": idx, "segments": segments, "mult": mult, "payout": bet * mult, "win": mult > 0}


@api.get("/games")
async def list_games(user=Depends(current_user)):
    return [{"id": k, **v} for k, v in GAMES_META.items()]


@api.post("/games/{game_id}/play")
async def play_game(game_id: str, body: PlayIn, user=Depends(current_user)):
    if game_id not in GAMES_META:
        raise HTTPException(404, "Game not found")
    meta = GAMES_META[game_id]
    if body.bet < meta["min_bet"] or body.bet > meta["max_bet"]:
        raise HTTPException(400, f"Bet must be between {meta['min_bet']} and {meta['max_bet']}")

    db = app.state.db
    # atomic deduct bet
    r = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": body.bet}},
        {"$inc": {"coins": -body.bet}},
    )
    if not r:
        raise HTTPException(402, "Insufficient Diamonds")

    # run RNG server-side
    if game_id == "slots":     detail = _play_slots(body.bet)
    elif game_id == "lucky77": detail = _play_lucky77(body.bet, body.pick or "")
    elif game_id == "dice":    detail = _play_dice(body.bet, body.pick or "")
    elif game_id == "coinflip":detail = _play_coinflip(body.bet, body.pick or "")
    elif game_id == "cards":   detail = _play_cards(body.bet, body.pick or "")
    elif game_id == "guess":   detail = _play_guess(body.bet, body.pick or "")
    elif game_id == "rps":     detail = _play_rps(body.bet, body.pick or "")
    elif game_id == "scratch": detail = _play_scratch(body.bet)
    elif game_id == "treasure":detail = _play_treasure(body.bet, body.pick or "")
    elif game_id == "wheel":   detail = _play_wheel(body.bet)
    else:                      raise HTTPException(500, "Unhandled game")

    payout = int(detail.get("payout", 0))
    net = payout - body.bet
    new_bal_doc = r["coins"] - body.bet
    if payout > 0:
        u2 = await db.users.find_one_and_update(
            {"_id": user["_id"]},
            {"$inc": {"coins": payout, "experience": max(1, body.bet // 100)}},
        )
        new_balance = u2["coins"] + payout
    else:
        await db.users.update_one({"_id": user["_id"]}, {"$inc": {"experience": max(1, body.bet // 100)}})
        new_balance = new_bal_doc

    tx_id = secrets.token_hex(12)
    now_t = now_utc()
    await db.game_history.insert_one({
        "tx_id": tx_id,
        "user_id": str(user["_id"]),
        "game_id": game_id,
        "game_name": meta["name"],
        "bet": body.bet,
        "pick": body.pick,
        "payout": payout,
        "net": net,
        "win": bool(detail.get("win", False)),
        "detail": detail,
        "balance_after": new_balance,
        "created_at": now_t,
    })
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "game_win" if net > 0 else ("game_tie" if net == 0 else "game_loss"),
        "currency": "coins",
        "amount": net,
        "balance_after": new_balance,
        "reference_id": tx_id,
        "description": f"{meta['name']} — {'won' if net > 0 else ('refund' if net == 0 else 'loss')}",
        "status": "completed",
        "created_at": now_t,
    })
    return {
        "tx_id": tx_id,
        "game_id": game_id,
        "bet": body.bet,
        "payout": payout,
        "net": net,
        "win": bool(detail.get("win", False)),
        "detail": detail,
        "new_balance": new_balance,
    }


@api.get("/games/history")
async def game_history(user=Depends(current_user)):
    db = app.state.db
    cur = db.game_history.find({"user_id": str(user["_id"])}, {"_id": 0}).sort("created_at", -1).limit(50)
    rows = await cur.to_list(50)
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return rows


# ---------- Countries ----------
COUNTRIES = [
    # Iter-71 — "Unknown 🌎" sentinel (always first).
    {"code": "XX", "flag": "🌎", "name": "Unknown", "name_ar": "غير محدد", "region": "unknown"},
    # Arab region (kept at top for the Arab-speaking player base)
    {"code": "SA", "flag": "🇸🇦", "name": "Saudi Arabia", "name_ar": "السعودية", "region": "arab"},
    {"code": "EG", "flag": "🇪🇬", "name": "Egypt", "name_ar": "مصر", "region": "arab"},
    {"code": "AE", "flag": "🇦🇪", "name": "United Arab Emirates", "name_ar": "الإمارات", "region": "arab"},
    {"code": "KW", "flag": "🇰🇼", "name": "Kuwait", "name_ar": "الكويت", "region": "arab"},
    {"code": "QA", "flag": "🇶🇦", "name": "Qatar", "name_ar": "قطر", "region": "arab"},
    {"code": "BH", "flag": "🇧🇭", "name": "Bahrain", "name_ar": "البحرين", "region": "arab"},
    {"code": "OM", "flag": "🇴🇲", "name": "Oman", "name_ar": "عُمان", "region": "arab"},
    {"code": "JO", "flag": "🇯🇴", "name": "Jordan", "name_ar": "الأردن", "region": "arab"},
    {"code": "LB", "flag": "🇱🇧", "name": "Lebanon", "name_ar": "لبنان", "region": "arab"},
    {"code": "SY", "flag": "🇸🇾", "name": "Syria", "name_ar": "سوريا", "region": "arab"},
    {"code": "IQ", "flag": "🇮🇶", "name": "Iraq", "name_ar": "العراق", "region": "arab"},
    {"code": "YE", "flag": "🇾🇪", "name": "Yemen", "name_ar": "اليمن", "region": "arab"},
    {"code": "MA", "flag": "🇲🇦", "name": "Morocco", "name_ar": "المغرب", "region": "arab"},
    {"code": "DZ", "flag": "🇩🇿", "name": "Algeria", "name_ar": "الجزائر", "region": "arab"},
    {"code": "TN", "flag": "🇹🇳", "name": "Tunisia", "name_ar": "تونس", "region": "arab"},
    {"code": "LY", "flag": "🇱🇾", "name": "Libya", "name_ar": "ليبيا", "region": "arab"},
    {"code": "SD", "flag": "🇸🇩", "name": "Sudan", "name_ar": "السودان", "region": "arab"},
    {"code": "PS", "flag": "🇵🇸", "name": "Palestine", "name_ar": "فلسطين", "region": "arab"},
    {"code": "MR", "flag": "🇲🇷", "name": "Mauritania", "name_ar": "موريتانيا", "region": "arab"},
    {"code": "SO", "flag": "🇸🇴", "name": "Somalia", "name_ar": "الصومال", "region": "arab"},
    {"code": "DJ", "flag": "🇩🇯", "name": "Djibouti", "name_ar": "جيبوتي", "region": "arab"},
    {"code": "KM", "flag": "🇰🇲", "name": "Comoros", "name_ar": "جزر القمر", "region": "arab"},
    # Full ISO list — alphabetical, world-wide.
    {"code": "AF", "flag": "🇦🇫", "name": "Afghanistan", "name_ar": "أفغانستان", "region": "world"},
    {"code": "AL", "flag": "🇦🇱", "name": "Albania", "name_ar": "ألبانيا", "region": "world"},
    {"code": "AD", "flag": "🇦🇩", "name": "Andorra", "name_ar": "أندورا", "region": "world"},
    {"code": "AO", "flag": "🇦🇴", "name": "Angola", "name_ar": "أنغولا", "region": "world"},
    {"code": "AG", "flag": "🇦🇬", "name": "Antigua and Barbuda", "name_ar": "أنتيغوا وبربودا", "region": "world"},
    {"code": "AR", "flag": "🇦🇷", "name": "Argentina", "name_ar": "الأرجنتين", "region": "world"},
    {"code": "AM", "flag": "🇦🇲", "name": "Armenia", "name_ar": "أرمينيا", "region": "world"},
    {"code": "AU", "flag": "🇦🇺", "name": "Australia", "name_ar": "أستراليا", "region": "world"},
    {"code": "AT", "flag": "🇦🇹", "name": "Austria", "name_ar": "النمسا", "region": "world"},
    {"code": "AZ", "flag": "🇦🇿", "name": "Azerbaijan", "name_ar": "أذربيجان", "region": "world"},
    {"code": "BS", "flag": "🇧🇸", "name": "Bahamas", "name_ar": "باهاماس", "region": "world"},
    {"code": "BD", "flag": "🇧🇩", "name": "Bangladesh", "name_ar": "بنغلاديش", "region": "world"},
    {"code": "BB", "flag": "🇧🇧", "name": "Barbados", "name_ar": "باربادوس", "region": "world"},
    {"code": "BY", "flag": "🇧🇾", "name": "Belarus", "name_ar": "بيلاروس", "region": "world"},
    {"code": "BE", "flag": "🇧🇪", "name": "Belgium", "name_ar": "بلجيكا", "region": "world"},
    {"code": "BZ", "flag": "🇧🇿", "name": "Belize", "name_ar": "بليز", "region": "world"},
    {"code": "BJ", "flag": "🇧🇯", "name": "Benin", "name_ar": "بنين", "region": "world"},
    {"code": "BT", "flag": "🇧🇹", "name": "Bhutan", "name_ar": "بوتان", "region": "world"},
    {"code": "BO", "flag": "🇧🇴", "name": "Bolivia", "name_ar": "بوليفيا", "region": "world"},
    {"code": "BA", "flag": "🇧🇦", "name": "Bosnia and Herzegovina", "name_ar": "البوسنة والهرسك", "region": "world"},
    {"code": "BW", "flag": "🇧🇼", "name": "Botswana", "name_ar": "بوتسوانا", "region": "world"},
    {"code": "BR", "flag": "🇧🇷", "name": "Brazil", "name_ar": "البرازيل", "region": "world"},
    {"code": "BN", "flag": "🇧🇳", "name": "Brunei", "name_ar": "بروناي", "region": "world"},
    {"code": "BG", "flag": "🇧🇬", "name": "Bulgaria", "name_ar": "بلغاريا", "region": "world"},
    {"code": "BF", "flag": "🇧🇫", "name": "Burkina Faso", "name_ar": "بوركينا فاسو", "region": "world"},
    {"code": "BI", "flag": "🇧🇮", "name": "Burundi", "name_ar": "بوروندي", "region": "world"},
    {"code": "KH", "flag": "🇰🇭", "name": "Cambodia", "name_ar": "كمبوديا", "region": "world"},
    {"code": "CM", "flag": "🇨🇲", "name": "Cameroon", "name_ar": "الكاميرون", "region": "world"},
    {"code": "CA", "flag": "🇨🇦", "name": "Canada", "name_ar": "كندا", "region": "world"},
    {"code": "CV", "flag": "🇨🇻", "name": "Cape Verde", "name_ar": "الرأس الأخضر", "region": "world"},
    {"code": "CF", "flag": "🇨🇫", "name": "Central African Republic", "name_ar": "جمهورية أفريقيا الوسطى", "region": "world"},
    {"code": "TD", "flag": "🇹🇩", "name": "Chad", "name_ar": "تشاد", "region": "world"},
    {"code": "CL", "flag": "🇨🇱", "name": "Chile", "name_ar": "تشيلي", "region": "world"},
    {"code": "CN", "flag": "🇨🇳", "name": "China", "name_ar": "الصين", "region": "world"},
    {"code": "CO", "flag": "🇨🇴", "name": "Colombia", "name_ar": "كولومبيا", "region": "world"},
    {"code": "CG", "flag": "🇨🇬", "name": "Congo", "name_ar": "الكونغو", "region": "world"},
    {"code": "CD", "flag": "🇨🇩", "name": "Congo (DRC)", "name_ar": "الكونغو الديمقراطية", "region": "world"},
    {"code": "CR", "flag": "🇨🇷", "name": "Costa Rica", "name_ar": "كوستاريكا", "region": "world"},
    {"code": "CI", "flag": "🇨🇮", "name": "Côte d'Ivoire", "name_ar": "ساحل العاج", "region": "world"},
    {"code": "HR", "flag": "🇭🇷", "name": "Croatia", "name_ar": "كرواتيا", "region": "world"},
    {"code": "CU", "flag": "🇨🇺", "name": "Cuba", "name_ar": "كوبا", "region": "world"},
    {"code": "CY", "flag": "🇨🇾", "name": "Cyprus", "name_ar": "قبرص", "region": "world"},
    {"code": "CZ", "flag": "🇨🇿", "name": "Czech Republic", "name_ar": "التشيك", "region": "world"},
    {"code": "DK", "flag": "🇩🇰", "name": "Denmark", "name_ar": "الدنمارك", "region": "world"},
    {"code": "DM", "flag": "🇩🇲", "name": "Dominica", "name_ar": "دومينيكا", "region": "world"},
    {"code": "DO", "flag": "🇩🇴", "name": "Dominican Republic", "name_ar": "جمهورية الدومينيكان", "region": "world"},
    {"code": "EC", "flag": "🇪🇨", "name": "Ecuador", "name_ar": "الإكوادور", "region": "world"},
    {"code": "SV", "flag": "🇸🇻", "name": "El Salvador", "name_ar": "السلفادور", "region": "world"},
    {"code": "GQ", "flag": "🇬🇶", "name": "Equatorial Guinea", "name_ar": "غينيا الاستوائية", "region": "world"},
    {"code": "ER", "flag": "🇪🇷", "name": "Eritrea", "name_ar": "إريتريا", "region": "world"},
    {"code": "EE", "flag": "🇪🇪", "name": "Estonia", "name_ar": "إستونيا", "region": "world"},
    {"code": "SZ", "flag": "🇸🇿", "name": "Eswatini", "name_ar": "إسواتيني", "region": "world"},
    {"code": "ET", "flag": "🇪🇹", "name": "Ethiopia", "name_ar": "إثيوبيا", "region": "world"},
    {"code": "FJ", "flag": "🇫🇯", "name": "Fiji", "name_ar": "فيجي", "region": "world"},
    {"code": "FI", "flag": "🇫🇮", "name": "Finland", "name_ar": "فنلندا", "region": "world"},
    {"code": "FR", "flag": "🇫🇷", "name": "France", "name_ar": "فرنسا", "region": "world"},
    {"code": "GA", "flag": "🇬🇦", "name": "Gabon", "name_ar": "الغابون", "region": "world"},
    {"code": "GM", "flag": "🇬🇲", "name": "Gambia", "name_ar": "غامبيا", "region": "world"},
    {"code": "GE", "flag": "🇬🇪", "name": "Georgia", "name_ar": "جورجيا", "region": "world"},
    {"code": "DE", "flag": "🇩🇪", "name": "Germany", "name_ar": "ألمانيا", "region": "world"},
    {"code": "GH", "flag": "🇬🇭", "name": "Ghana", "name_ar": "غانا", "region": "world"},
    {"code": "GR", "flag": "🇬🇷", "name": "Greece", "name_ar": "اليونان", "region": "world"},
    {"code": "GD", "flag": "🇬🇩", "name": "Grenada", "name_ar": "غرينادا", "region": "world"},
    {"code": "GT", "flag": "🇬🇹", "name": "Guatemala", "name_ar": "غواتيمالا", "region": "world"},
    {"code": "GN", "flag": "🇬🇳", "name": "Guinea", "name_ar": "غينيا", "region": "world"},
    {"code": "GW", "flag": "🇬🇼", "name": "Guinea-Bissau", "name_ar": "غينيا بيساو", "region": "world"},
    {"code": "GY", "flag": "🇬🇾", "name": "Guyana", "name_ar": "غيانا", "region": "world"},
    {"code": "HT", "flag": "🇭🇹", "name": "Haiti", "name_ar": "هايتي", "region": "world"},
    {"code": "HN", "flag": "🇭🇳", "name": "Honduras", "name_ar": "هندوراس", "region": "world"},
    {"code": "HU", "flag": "🇭🇺", "name": "Hungary", "name_ar": "المجر", "region": "world"},
    {"code": "IS", "flag": "🇮🇸", "name": "Iceland", "name_ar": "آيسلندا", "region": "world"},
    {"code": "IN", "flag": "🇮🇳", "name": "India", "name_ar": "الهند", "region": "world"},
    {"code": "ID", "flag": "🇮🇩", "name": "Indonesia", "name_ar": "إندونيسيا", "region": "world"},
    {"code": "IR", "flag": "🇮🇷", "name": "Iran", "name_ar": "إيران", "region": "world"},
    {"code": "IE", "flag": "🇮🇪", "name": "Ireland", "name_ar": "إيرلندا", "region": "world"},
    {"code": "IL", "flag": "🇮🇱", "name": "Israel", "name_ar": "إسرائيل", "region": "world"},
    {"code": "IT", "flag": "🇮🇹", "name": "Italy", "name_ar": "إيطاليا", "region": "world"},
    {"code": "JM", "flag": "🇯🇲", "name": "Jamaica", "name_ar": "جامايكا", "region": "world"},
    {"code": "JP", "flag": "🇯🇵", "name": "Japan", "name_ar": "اليابان", "region": "world"},
    {"code": "KZ", "flag": "🇰🇿", "name": "Kazakhstan", "name_ar": "كازاخستان", "region": "world"},
    {"code": "KE", "flag": "🇰🇪", "name": "Kenya", "name_ar": "كينيا", "region": "world"},
    {"code": "KI", "flag": "🇰🇮", "name": "Kiribati", "name_ar": "كيريباتي", "region": "world"},
    {"code": "KP", "flag": "🇰🇵", "name": "North Korea", "name_ar": "كوريا الشمالية", "region": "world"},
    {"code": "KR", "flag": "🇰🇷", "name": "South Korea", "name_ar": "كوريا الجنوبية", "region": "world"},
    {"code": "KG", "flag": "🇰🇬", "name": "Kyrgyzstan", "name_ar": "قيرغيزستان", "region": "world"},
    {"code": "LA", "flag": "🇱🇦", "name": "Laos", "name_ar": "لاوس", "region": "world"},
    {"code": "LV", "flag": "🇱🇻", "name": "Latvia", "name_ar": "لاتفيا", "region": "world"},
    {"code": "LS", "flag": "🇱🇸", "name": "Lesotho", "name_ar": "ليسوتو", "region": "world"},
    {"code": "LR", "flag": "🇱🇷", "name": "Liberia", "name_ar": "ليبيريا", "region": "world"},
    {"code": "LI", "flag": "🇱🇮", "name": "Liechtenstein", "name_ar": "ليختنشتاين", "region": "world"},
    {"code": "LT", "flag": "🇱🇹", "name": "Lithuania", "name_ar": "ليتوانيا", "region": "world"},
    {"code": "LU", "flag": "🇱🇺", "name": "Luxembourg", "name_ar": "لوكسمبورغ", "region": "world"},
    {"code": "MG", "flag": "🇲🇬", "name": "Madagascar", "name_ar": "مدغشقر", "region": "world"},
    {"code": "MW", "flag": "🇲🇼", "name": "Malawi", "name_ar": "مالاوي", "region": "world"},
    {"code": "MY", "flag": "🇲🇾", "name": "Malaysia", "name_ar": "ماليزيا", "region": "world"},
    {"code": "MV", "flag": "🇲🇻", "name": "Maldives", "name_ar": "جزر المالديف", "region": "world"},
    {"code": "ML", "flag": "🇲🇱", "name": "Mali", "name_ar": "مالي", "region": "world"},
    {"code": "MT", "flag": "🇲🇹", "name": "Malta", "name_ar": "مالطا", "region": "world"},
    {"code": "MH", "flag": "🇲🇭", "name": "Marshall Islands", "name_ar": "جزر مارشال", "region": "world"},
    {"code": "MU", "flag": "🇲🇺", "name": "Mauritius", "name_ar": "موريشيوس", "region": "world"},
    {"code": "MX", "flag": "🇲🇽", "name": "Mexico", "name_ar": "المكسيك", "region": "world"},
    {"code": "FM", "flag": "🇫🇲", "name": "Micronesia", "name_ar": "ميكرونيزيا", "region": "world"},
    {"code": "MD", "flag": "🇲🇩", "name": "Moldova", "name_ar": "مولدوفا", "region": "world"},
    {"code": "MC", "flag": "🇲🇨", "name": "Monaco", "name_ar": "موناكو", "region": "world"},
    {"code": "MN", "flag": "🇲🇳", "name": "Mongolia", "name_ar": "منغوليا", "region": "world"},
    {"code": "ME", "flag": "🇲🇪", "name": "Montenegro", "name_ar": "الجبل الأسود", "region": "world"},
    {"code": "MZ", "flag": "🇲🇿", "name": "Mozambique", "name_ar": "موزمبيق", "region": "world"},
    {"code": "MM", "flag": "🇲🇲", "name": "Myanmar", "name_ar": "ميانمار", "region": "world"},
    {"code": "NA", "flag": "🇳🇦", "name": "Namibia", "name_ar": "ناميبيا", "region": "world"},
    {"code": "NR", "flag": "🇳🇷", "name": "Nauru", "name_ar": "ناورو", "region": "world"},
    {"code": "NP", "flag": "🇳🇵", "name": "Nepal", "name_ar": "نيبال", "region": "world"},
    {"code": "NL", "flag": "🇳🇱", "name": "Netherlands", "name_ar": "هولندا", "region": "world"},
    {"code": "NZ", "flag": "🇳🇿", "name": "New Zealand", "name_ar": "نيوزيلندا", "region": "world"},
    {"code": "NI", "flag": "🇳🇮", "name": "Nicaragua", "name_ar": "نيكاراغوا", "region": "world"},
    {"code": "NE", "flag": "🇳🇪", "name": "Niger", "name_ar": "النيجر", "region": "world"},
    {"code": "NG", "flag": "🇳🇬", "name": "Nigeria", "name_ar": "نيجيريا", "region": "world"},
    {"code": "MK", "flag": "🇲🇰", "name": "North Macedonia", "name_ar": "مقدونيا الشمالية", "region": "world"},
    {"code": "NO", "flag": "🇳🇴", "name": "Norway", "name_ar": "النرويج", "region": "world"},
    {"code": "PK", "flag": "🇵🇰", "name": "Pakistan", "name_ar": "باكستان", "region": "world"},
    {"code": "PW", "flag": "🇵🇼", "name": "Palau", "name_ar": "بالاو", "region": "world"},
    {"code": "PA", "flag": "🇵🇦", "name": "Panama", "name_ar": "بنما", "region": "world"},
    {"code": "PG", "flag": "🇵🇬", "name": "Papua New Guinea", "name_ar": "بابوا غينيا الجديدة", "region": "world"},
    {"code": "PY", "flag": "🇵🇾", "name": "Paraguay", "name_ar": "باراغواي", "region": "world"},
    {"code": "PE", "flag": "🇵🇪", "name": "Peru", "name_ar": "بيرو", "region": "world"},
    {"code": "PH", "flag": "🇵🇭", "name": "Philippines", "name_ar": "الفلبين", "region": "world"},
    {"code": "PL", "flag": "🇵🇱", "name": "Poland", "name_ar": "بولندا", "region": "world"},
    {"code": "PT", "flag": "🇵🇹", "name": "Portugal", "name_ar": "البرتغال", "region": "world"},
    {"code": "RO", "flag": "🇷🇴", "name": "Romania", "name_ar": "رومانيا", "region": "world"},
    {"code": "RU", "flag": "🇷🇺", "name": "Russia", "name_ar": "روسيا", "region": "world"},
    {"code": "RW", "flag": "🇷🇼", "name": "Rwanda", "name_ar": "رواندا", "region": "world"},
    {"code": "KN", "flag": "🇰🇳", "name": "Saint Kitts and Nevis", "name_ar": "سانت كيتس ونيفيس", "region": "world"},
    {"code": "LC", "flag": "🇱🇨", "name": "Saint Lucia", "name_ar": "سانت لوسيا", "region": "world"},
    {"code": "VC", "flag": "🇻🇨", "name": "Saint Vincent and the Grenadines", "name_ar": "سانت فينسنت والغرينادين", "region": "world"},
    {"code": "WS", "flag": "🇼🇸", "name": "Samoa", "name_ar": "ساموا", "region": "world"},
    {"code": "SM", "flag": "🇸🇲", "name": "San Marino", "name_ar": "سان مارينو", "region": "world"},
    {"code": "ST", "flag": "🇸🇹", "name": "Sao Tome and Principe", "name_ar": "ساو تومي وبرينسيبي", "region": "world"},
    {"code": "SN", "flag": "🇸🇳", "name": "Senegal", "name_ar": "السنغال", "region": "world"},
    {"code": "RS", "flag": "🇷🇸", "name": "Serbia", "name_ar": "صربيا", "region": "world"},
    {"code": "SC", "flag": "🇸🇨", "name": "Seychelles", "name_ar": "سيشل", "region": "world"},
    {"code": "SL", "flag": "🇸🇱", "name": "Sierra Leone", "name_ar": "سيراليون", "region": "world"},
    {"code": "SG", "flag": "🇸🇬", "name": "Singapore", "name_ar": "سنغافورة", "region": "world"},
    {"code": "SK", "flag": "🇸🇰", "name": "Slovakia", "name_ar": "سلوفاكيا", "region": "world"},
    {"code": "SI", "flag": "🇸🇮", "name": "Slovenia", "name_ar": "سلوفينيا", "region": "world"},
    {"code": "SB", "flag": "🇸🇧", "name": "Solomon Islands", "name_ar": "جزر سليمان", "region": "world"},
    {"code": "ZA", "flag": "🇿🇦", "name": "South Africa", "name_ar": "جنوب أفريقيا", "region": "world"},
    {"code": "SS", "flag": "🇸🇸", "name": "South Sudan", "name_ar": "جنوب السودان", "region": "world"},
    {"code": "ES", "flag": "🇪🇸", "name": "Spain", "name_ar": "إسبانيا", "region": "world"},
    {"code": "LK", "flag": "🇱🇰", "name": "Sri Lanka", "name_ar": "سريلانكا", "region": "world"},
    {"code": "SR", "flag": "🇸🇷", "name": "Suriname", "name_ar": "سورينام", "region": "world"},
    {"code": "SE", "flag": "🇸🇪", "name": "Sweden", "name_ar": "السويد", "region": "world"},
    {"code": "CH", "flag": "🇨🇭", "name": "Switzerland", "name_ar": "سويسرا", "region": "world"},
    {"code": "TW", "flag": "🇹🇼", "name": "Taiwan", "name_ar": "تايوان", "region": "world"},
    {"code": "TJ", "flag": "🇹🇯", "name": "Tajikistan", "name_ar": "طاجيكستان", "region": "world"},
    {"code": "TZ", "flag": "🇹🇿", "name": "Tanzania", "name_ar": "تنزانيا", "region": "world"},
    {"code": "TH", "flag": "🇹🇭", "name": "Thailand", "name_ar": "تايلاند", "region": "world"},
    {"code": "TL", "flag": "🇹🇱", "name": "Timor-Leste", "name_ar": "تيمور الشرقية", "region": "world"},
    {"code": "TG", "flag": "🇹🇬", "name": "Togo", "name_ar": "توغو", "region": "world"},
    {"code": "TO", "flag": "🇹🇴", "name": "Tonga", "name_ar": "تونغا", "region": "world"},
    {"code": "TT", "flag": "🇹🇹", "name": "Trinidad and Tobago", "name_ar": "ترينيداد وتوباغو", "region": "world"},
    {"code": "TR", "flag": "🇹🇷", "name": "Turkey", "name_ar": "تركيا", "region": "world"},
    {"code": "TM", "flag": "🇹🇲", "name": "Turkmenistan", "name_ar": "تركمانستان", "region": "world"},
    {"code": "TV", "flag": "🇹🇻", "name": "Tuvalu", "name_ar": "توفالو", "region": "world"},
    {"code": "UG", "flag": "🇺🇬", "name": "Uganda", "name_ar": "أوغندا", "region": "world"},
    {"code": "UA", "flag": "🇺🇦", "name": "Ukraine", "name_ar": "أوكرانيا", "region": "world"},
    {"code": "GB", "flag": "🇬🇧", "name": "United Kingdom", "name_ar": "المملكة المتحدة", "region": "world"},
    {"code": "US", "flag": "🇺🇸", "name": "United States", "name_ar": "الولايات المتحدة", "region": "world"},
    {"code": "UY", "flag": "🇺🇾", "name": "Uruguay", "name_ar": "أوروغواي", "region": "world"},
    {"code": "UZ", "flag": "🇺🇿", "name": "Uzbekistan", "name_ar": "أوزبكستان", "region": "world"},
    {"code": "VU", "flag": "🇻🇺", "name": "Vanuatu", "name_ar": "فانواتو", "region": "world"},
    {"code": "VA", "flag": "🇻🇦", "name": "Vatican City", "name_ar": "الفاتيكان", "region": "world"},
    {"code": "VE", "flag": "🇻🇪", "name": "Venezuela", "name_ar": "فنزويلا", "region": "world"},
    {"code": "VN", "flag": "🇻🇳", "name": "Vietnam", "name_ar": "فيتنام", "region": "world"},
    {"code": "ZM", "flag": "🇿🇲", "name": "Zambia", "name_ar": "زامبيا", "region": "world"},
    {"code": "ZW", "flag": "🇿🇼", "name": "Zimbabwe", "name_ar": "زمبابوي", "region": "world"},
]

# ---------- VIP Catalog ----------
VIP_TIERS = [
    {"level": 1, "price_coins": 5000, "duration_days": 30, "color": "#8E8E93",
     "benefits": ["Do Not Disturb from strangers", "Only friends can DM you"]},
    {"level": 2, "price_coins": 12000, "duration_days": 30, "color": "#32D74B",
     "benefits": ["Green username color", "Do Not Disturb", "Priority queue"]},
    {"level": 3, "price_coins": 25000, "duration_days": 30, "color": "#0A84FF",
     "benefits": ["Hide Wealth & Charm levels", "Green username", "Do Not Disturb"]},
    {"level": 4, "price_coins": 50000, "duration_days": 30, "color": "#FF453A",
     "benefits": ["Red username color", "Hide Wealth/Charm", "All VIP 1-3 benefits"]},
    {"level": 5, "price_coins": 120000, "duration_days": 30, "color": "#BF5AF2",
     "benefits": ["Animated profile picture", "Protected from moderator kicks", "Red username", "All VIP 1-4 benefits"]},
    {"level": 6, "price_coins": 250000, "duration_days": 30, "color": "#FF9500",
     "benefits": ["Rainbow animated username", "Protected from kicks", "Animated PFP", "All VIP 1-5 benefits"]},
    {"level": 7, "price_coins": 500000, "duration_days": 30, "color": "#FFD700",
     "benefits": ["Hide online status completely", "Global entrance banner", "Protected from owner kicks too", "Rainbow username", "All VIP 1-6 benefits"]},
]

# Iter-121 — selectable regions that are NOT sovereign countries (kept out of COUNTRIES).
# Flag emoji is empty: the client renders the circular regional SVG by `code`.
REGIONS = [
    {"code": "KRD", "flag": "", "name": "Kurdistan", "name_ar": "كردستان", "region": "region"},
]
# Rooms → All Countries filter: all Arab countries + selected others (order as specified).
ROOM_FILTER_EXTRA = ["FR", "US", "DE", "KRD", "GB", "NL", "TR"]


def _find_country(code: Optional[str]) -> Optional[dict]:
    if not code:
        return None
    code = code.upper()
    return next((c for c in COUNTRIES + REGIONS if c["code"] == code), None)


async def _sync_owner_rooms_country(db, owner_id: str, code: str, flag: Optional[str]) -> None:
    """Rooms are filtered by the owner's selected country/region — keep them in sync."""
    await db.rooms.update_many({"owner_id": owner_id}, {"$set": {"country_code": code, "country_flag": flag}})


@api.get("/countries")
async def get_countries():
    # Full world list (+ Unknown) followed by selectable regions (flagged region="region").
    return COUNTRIES + REGIONS


@api.get("/room-filter-countries")
async def _room_filter_countries():
    arab = [c for c in COUNTRIES if c.get("region") == "arab"]
    extra = [c for code in ROOM_FILTER_EXTRA for c in [_find_country(code)] if c]
    return arab + extra


# ---------- Iter-121: Room-only supporter badges (per-room, 24h session memory) ----------
ROOM_BADGE_TTL = timedelta(hours=24)


def _room_badge_expired(doc: Optional[dict], present: bool) -> bool:
    left = (doc or {}).get("left_at")
    if present or not left:
        return False
    if left.tzinfo is None:
        left = left.replace(tzinfo=timezone.utc)
    return now_utc() - left > ROOM_BADGE_TTL


async def _room_badge_on_join(db, room_id: str, uid: str) -> None:
    doc = await db.room_badge_sessions.find_one({"room_id": room_id, "user_id": uid})
    upd: dict = {"$set": {"active": True, "joined_at": now_utc()}, "$unset": {"left_at": ""}}
    if _room_badge_expired(doc, present=False):
        upd["$set"].update({"sent": 0, "received": 0, "reset_at": now_utc()})
    await db.room_badge_sessions.update_one({"room_id": room_id, "user_id": uid}, upd, upsert=True)


async def _room_badge_on_leave(db, room_id: str, uid: str) -> None:
    await db.room_badge_sessions.update_one(
        {"room_id": room_id, "user_id": uid}, {"$set": {"active": False, "left_at": now_utc()}})


async def _room_badge_add(db, room_id: Optional[str], sender_id: str, recipient_id: str, pts: int) -> None:
    """Only verified, point-eligible gifts count. Never touches real points/balances."""
    if not room_id or pts <= 0:
        return
    for uid, fld in ((sender_id, "sent"), (recipient_id, "received")):
        doc = await db.room_badge_sessions.find_one({"room_id": room_id, "user_id": uid})
        if _room_badge_expired(doc, present=uid in _hub.presence.get(room_id, {})):
            await db.room_badge_sessions.update_one(
                {"room_id": room_id, "user_id": uid}, {"$set": {"sent": 0, "received": 0, "reset_at": now_utc()}})
        await db.room_badge_sessions.update_one(
            {"room_id": room_id, "user_id": uid}, {"$inc": {fld: pts}, "$setOnInsert": {"active": True}}, upsert=True)
    # Iter-122 — tell every viewer in the room to refresh these users' room badges.
    try:
        await _hub.broadcast(room_id, {"type": "room_badges", "user_ids": list({sender_id, recipient_id})})
    except Exception:
        pass


@api.get("/rooms/{room_id}/support-badges/{user_id}")
async def _room_support_badges(room_id: str, user_id: str, user=Depends(current_user)):
    db = app.state.db
    doc = await db.room_badge_sessions.find_one({"room_id": room_id, "user_id": user_id})
    if not doc or _room_badge_expired(doc, present=user_id in _hub.presence.get(room_id, {})):
        return {"sent": 0, "received": 0}
    return {"sent": int(doc.get("sent", 0)), "received": int(doc.get("received", 0))}


@api.get("/vip/tiers")
async def get_vip_tiers(user=Depends(current_user)):
    my = user.get("vip_level", 0)
    return {"tiers": VIP_TIERS, "my_level": my, "expires_at": user.get("vip_expires_at").isoformat() if user.get("vip_expires_at") else None}


class VipPurchaseIn(BaseModel):
    level: int = Field(ge=1, le=7)


@api.post("/vip/purchase")
async def purchase_vip(body: VipPurchaseIn, user=Depends(current_user)):
    db = app.state.db
    tier = next((t for t in VIP_TIERS if t["level"] == body.level), None)
    if not tier:
        raise HTTPException(404, "VIP tier not found")
    price = tier["price_coins"]
    r = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": price}},
        {"$inc": {"coins": -price}},
    )
    if not r:
        raise HTTPException(402, "Insufficient Diamonds")
    new_bal = r["coins"] - price
    expires = now_utc() + timedelta(days=tier["duration_days"])
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"vip_level": body.level, "vip_expires_at": expires}})
    if int(body.level) > int(user.get("vip_level", 0) or 0):
        await _sys_notify(db, str(user["_id"]), "vip_up", {"level": int(body.level)}, {"type": "vip"},
                          f"Congratulations on reaching VIP{int(body.level)}")
    tx_id = secrets.token_hex(12)
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]), "type": "vip_purchase", "currency": "coins",
        "amount": -price, "balance_after": new_bal, "reference_id": tx_id,
        "description": f"VIP {body.level} activated for {tier['duration_days']} days",
        "status": "completed", "created_at": now_utc(),
    })
    return {"ok": True, "vip_level": body.level, "expires_at": expires.isoformat(), "new_balance": new_bal}


# ---------- Update user profile with additional fields ----------
class ProfilePhotosIn(BaseModel):
    photos: List[str] = Field(default_factory=list, max_length=5)
    background_url: Optional[str] = None
    country_code: Optional[str] = None


@api.patch("/users/me/gallery")
async def update_gallery(body: ProfilePhotosIn, user=Depends(current_user)):
    db = app.state.db
    upd = {}
    if body.photos is not None:
        upd["photos"] = body.photos[:5]
    if body.background_url is not None:
        if int(user.get("vip_level", 0) or 0) < 5:
            raise HTTPException(403, "VIP5_REQUIRED")
        upd["background_url"] = body.background_url
    if body.country_code is not None:
        upd["country_code"] = body.country_code
        c = _find_country(body.country_code)
        if c:
            upd["country_flag"] = c["flag"]
            upd["country"] = c["name"]
    if upd:
        await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
        if upd.get("country_code"):
            await _sync_owner_rooms_country(db, str(user["_id"]), upd["country_code"], upd.get("country_flag"))
    u = await db.users.find_one({"_id": user["_id"]})
    return public_user(u)


# ---------- POSTS ----------
class PostCreateIn(BaseModel):
    text: str = Field(default="", max_length=1000)
    image_url: Optional[str] = None
    # Up to 9 images OR one video (≤60s), plus curated hashtags.
    images: list[str] = Field(default_factory=list, max_length=9)
    visibility: Literal["public", "mutual"] = "public"
    video_url: Optional[str] = None
    video_duration: Optional[float] = None
    hashtags: list[str] = Field(default_factory=list, max_length=7)


POST_HASHTAGS = ["سفر", "طعام", "الحياة_اليومية", "أجواء_الشتاء", "أجواء_الخريف", "أجواء_الصيف", "أجواء_الربيع"]


def public_post(p: dict, my_id: str, liked: bool) -> dict:
    return {
        "id": str(p["_id"]),
        "author": p.get("author_pub"),
        "text": p.get("text", ""),
        "image_url": p.get("image_url"),
        "images": p.get("images") or ([p["image_url"]] if p.get("image_url") else []),
        "video_url": p.get("video_url"),
        "hashtags": p.get("hashtags") or [],
        "visibility": p.get("visibility") or "public",
        "likes_count": p.get("likes_count", 0),
        "comments_count": p.get("comments_count", 0),
        "liked_by_me": liked,
        "created_at": p.get("created_at", now_utc()).isoformat() if isinstance(p.get("created_at"), datetime) else p.get("created_at"),
    }


@api.get("/posts")
async def list_posts(feed: Literal["latest", "popular", "friends"] = "latest", tag: Optional[str] = None,
                     media: Optional[Literal["photos", "videos"]] = None,
                     user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    tag = (tag or "").lstrip("#").strip()
    if tag:
        # Iter-117 — hashtag filter (applies to the Popular feed ordering).
        q: dict = {"hashtags": tag, "is_deleted": {"$ne": True}}
        if feed == "friends":
            following = set(await db.follows.distinct("followee_id", {"follower_id": my_id}))
            followers = set(await db.follows.distinct("follower_id", {"followee_id": my_id}))
            q["author_id"] = {"$in": list(following & followers)}
        posts = await db.posts.find(q).sort([("likes_count", -1), ("created_at", -1)]).to_list(50)
    elif feed == "popular":
        # Iter-105 — all users' posts, most-liked first (then newest).
        posts = await db.posts.find({"is_deleted": {"$ne": True}}).sort([("likes_count", -1), ("created_at", -1)]).to_list(50)
    elif feed == "friends":
        # Iter-105 — only mutual follows (I follow them AND they follow me).
        following = set(await db.follows.distinct("followee_id", {"follower_id": my_id}))
        followers = set(await db.follows.distinct("follower_id", {"followee_id": my_id}))
        mutual = list(following & followers)
        posts = await db.posts.find({"author_id": {"$in": mutual}}).sort("created_at", -1).to_list(50) if mutual else []
    else:
        posts = await db.posts.find({}).sort("created_at", -1).to_list(50)
    if media == "photos":
        posts = [p for p in posts if not p.get("video_url") and (p.get("images") or p.get("image_url"))]
    elif media == "videos":
        posts = [p for p in posts if p.get("video_url")]
    return await _posts_out(db, posts, my_id)


@api.get("/users/{user_id}/posts")
async def _user_posts(user_id: str, limit: int = Query(5, ge=1, le=200), user=Depends(current_user)):
    """Latest posts by one author (visibility + block rules applied)."""
    db = app.state.db
    posts = await db.posts.find({"author_id": user_id}).sort("created_at", -1).to_list(limit * 3)
    return (await _posts_out(db, posts, str(user["_id"])))[:limit]


async def _mutual_ids(db, uid: str) -> set:
    following = set(await db.follows.distinct("followee_id", {"follower_id": uid}))
    followers = set(await db.follows.distinct("follower_id", {"followee_id": uid}))
    return following & followers


async def _can_view_post(db, p: dict, viewer: str, mutual_of_viewer: Optional[set] = None, blocked: Optional[set] = None) -> bool:
    author = p.get("author_id")
    if author == viewer:
        return True
    if blocked is None:
        blocked = await _blocked_ids(db, viewer)
    if author in blocked:
        return False
    if (p.get("visibility") or "public") == "mutual":
        if mutual_of_viewer is None:
            mutual_of_viewer = await _mutual_ids(db, viewer)
        return author in mutual_of_viewer
    return True


async def _posts_out(db, posts: list, my_id: str) -> list:
    """Visibility + block filtering, and LIVE author profile (nickname /
    avatar / VIP) so profile edits show on every post immediately."""
    mutual = await _mutual_ids(db, my_id)
    blocked = await _blocked_ids(db, my_id)
    posts = [p for p in posts if await _can_view_post(db, p, my_id, mutual, blocked)]
    aids = list({p.get("author_id") for p in posts if p.get("author_id")})
    authors = {}
    if aids:
        async for u in db.users.find({"_id": {"$in": [ObjectId(a) for a in aids if ObjectId.is_valid(a)]}},
                                     {"nickname": 1, "avatar_url": 1, "vip_level": 1, "country_flag": 1}):
            authors[str(u["_id"])] = {"id": str(u["_id"]), "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"),
                                      "vip_level": u.get("vip_level", 0), "country_flag": u.get("country_flag"),
                                      "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0))}
    likes = await db.post_likes.find({"user_id": my_id, "post_id": {"$in": [str(p["_id"]) for p in posts]}}).to_list(500)
    liked_set = {l["post_id"] for l in likes}
    out = []
    for p in posts:
        if p.get("author_id") in authors:
            p["author_pub"] = authors[p["author_id"]]
        out.append(public_post(p, my_id, str(p["_id"]) in liked_set))
    return out


async def _get_visible_post(db, post_id: str, viewer: str) -> dict:
    try:
        p = await db.posts.find_one({"_id": ObjectId(post_id)})
    except Exception:
        p = None
    if not p or not await _can_view_post(db, p, viewer):
        raise HTTPException(404, "Post not found")
    return p


@api.get("/posts/{post_id}")
async def _get_post(post_id: str, user=Depends(current_user)):
    db = app.state.db
    p = await _get_visible_post(db, post_id, str(user["_id"]))
    return (await _posts_out(db, [p], str(user["_id"])))[0]


class _PostVisIn(BaseModel):
    visibility: Literal["public", "mutual"]


@api.patch("/posts/{post_id}/visibility")
async def _post_visibility(post_id: str, body: _PostVisIn, user=Depends(current_user)):
    db = app.state.db
    try:
        pid = ObjectId(post_id)
    except Exception:
        raise HTTPException(404, "Post not found")
    r = await db.posts.update_one({"_id": pid, "author_id": str(user["_id"])}, {"$set": {"visibility": body.visibility}})
    if not r.matched_count:
        raise HTTPException(403, "Not your post")
    return {"ok": True, "visibility": body.visibility}


class _PostShareIn(BaseModel):
    recipient_ids: list[str] = Field(min_length=1, max_length=20)


@api.post("/posts/{post_id}/share")
async def _post_share(post_id: str, body: _PostShareIn, user=Depends(current_user)):
    """Share a post to ORIO users as REAL private messages (kind=post).
    Respects visibility (recipient must be allowed to see it) and blocks."""
    db = app.state.db
    me = str(user["_id"])
    p = await _get_visible_post(db, post_id, me)
    sent, skipped = [], []
    for rid in dict.fromkeys(body.recipient_ids):
        try:
            r = await db.users.find_one({"_id": ObjectId(rid)}, {"is_official": 1})
        except Exception:
            r = None
        if not r or r.get("is_official") or rid == me:
            skipped.append(rid); continue
        a, b = await _block_state(db, me, rid)
        if a or b or not await _can_view_post(db, p, rid):
            skipped.append(rid); continue
        await db.messages.insert_one({
            "sender_id": me, "recipient_id": rid, "thread_key": thread_key(me, rid),
            "text": "📝 " + ((p.get("text") or "").strip()[:80] or "Post"),
            "kind": "post", "post_id": post_id,
            "media_url": None, "read": False, "created_at": now_utc(),
        })
        sent.append(rid)
        await _push_users([rid, me], "dm_update", peer_ids=[me, rid])
    return {"ok": True, "sent": sent, "skipped": skipped}


@api.get("/users/me/mutuals")
async def _my_mutuals(user=Depends(current_user)):
    db = app.state.db
    me = str(user["_id"])
    ids = [i for i in await _mutual_ids(db, me) if i not in await _blocked_ids(db, me)]
    out = []
    async for u in db.users.find({"_id": {"$in": [ObjectId(i) for i in ids if ObjectId.is_valid(i)]}}):
        out.append({"id": str(u["_id"]), "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"),
                    "numeric_id": u.get("numeric_id"), "vip_level": u.get("vip_level", 0)})
    return out


@api.post("/posts", status_code=201)
async def create_post(body: PostCreateIn, user=Depends(current_user)):
    _guard_text(body.text)
    db = app.state.db
    text = (body.text or "").strip()
    images = [u for u in (body.images or []) if isinstance(u, str) and u][:9]
    if body.image_url and not images:
        images = [body.image_url]
    if images and body.video_url:
        raise HTTPException(400, "Attach up to 9 images OR one video, not both")
    if body.video_url and body.video_duration is not None and float(body.video_duration) > 60.5:
        raise HTTPException(400, "Video must be 60 seconds or shorter")
    for u in images + ([body.video_url] if body.video_url else []):
        await _assert_media_owned(db, u, str(user["_id"]))
    tags = [t.lstrip("#") for t in (body.hashtags or [])]
    if any(t not in POST_HASHTAGS for t in tags):
        raise HTTPException(400, "Unknown hashtag")
    tags = list(dict.fromkeys(tags))
    if not text and not images and not body.video_url:
        raise HTTPException(400, "Post cannot be empty")
    doc = {
        "author_id": str(user["_id"]),
        "author_pub": {
            "id": str(user["_id"]),
            "nickname": user.get("nickname"),
            "avatar_url": user.get("avatar_url"),
            "vip_level": user.get("vip_level", 0),
            "country_flag": user.get("country_flag"),
        },
        "text": text,
        "image_url": images[0] if images else None,
        "images": images,
        "video_url": body.video_url,
        "visibility": body.visibility,
        "hashtags": tags,
        "likes_count": 0,
        "comments_count": 0,
        "created_at": now_utc(),
    }
    r = await db.posts.insert_one(doc)
    doc["_id"] = r.inserted_id
    await _task_bump(db, str(user["_id"]), "post_5")
    return public_post(doc, str(user["_id"]), False)


@api.post("/posts/{post_id}/like")
async def like_post(post_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    try:
        pid = ObjectId(post_id)
    except Exception:
        raise HTTPException(404, "Post not found")
    existing = await db.post_likes.find_one({"post_id": post_id, "user_id": my_id})
    if existing:
        await db.post_likes.delete_one({"_id": existing["_id"]})
        await db.posts.update_one({"_id": pid, "likes_count": {"$gt": 0}}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    await db.post_likes.insert_one({"post_id": post_id, "user_id": my_id, "created_at": now_utc()})
    await db.posts.update_one({"_id": pid}, {"$inc": {"likes_count": 1}})
    return {"liked": True}


@api.delete("/posts/{post_id}")
async def delete_post(post_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        pid = ObjectId(post_id)
    except Exception:
        raise HTTPException(404, "Post not found")
    r = await db.posts.delete_one({"_id": pid, "author_id": str(user["_id"])})
    if not r.deleted_count:
        raise HTTPException(403, "Not your post")
    await db.post_likes.delete_many({"post_id": post_id})
    await db.post_comments.delete_many({"post_id": post_id})
    return {"ok": True}


# ---------- FRIENDSHIP & CP shared helpers ----------
def _pair_key(a: str, b: str) -> str:
    return "_".join(sorted([a, b]))


async def _relation_public(rel: dict, my_id: str, db) -> dict:
    other_id = rel["b_id"] if rel["a_id"] == my_id else rel["a_id"]
    try:
        other = await db.users.find_one({"_id": ObjectId(other_id)})
    except Exception:
        other = None
    return {
        "id": str(rel["_id"]),
        "status": rel.get("status"),
        "points": rel.get("points", 0),
        "level": min(20, rel.get("points", 0) // 1000 + 1),
        "requested_by_me": rel.get("requested_by") == my_id,
        "other": {
            "id": other_id,
            "nickname": other.get("nickname") if other else None,
            "avatar_url": other.get("avatar_url") if other else None,
            "vip_level": (other or {}).get("vip_level", 0),
            "country_flag": (other or {}).get("country_flag"),
        },
        "created_at": rel.get("created_at").isoformat() if isinstance(rel.get("created_at"), datetime) else rel.get("created_at"),
    }


class RelActionIn(BaseModel):
    user_id: str


# ---------- FRIENDSHIP ----------
@api.get("/friendship")
async def list_friendships(user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    cur = db.friendships.find({"$or": [{"a_id": my_id}, {"b_id": my_id}]}).sort("points", -1).limit(200)
    out = []
    async for r in cur:
        out.append(await _relation_public(r, my_id, db))
    return out


@api.post("/friendship/request", status_code=201)
async def request_friendship(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    if body.user_id == my_id:
        raise HTTPException(400, "Cannot friend yourself")
    try:
        target = await db.users.find_one({"_id": ObjectId(body.user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    a, b = sorted([my_id, body.user_id])
    pk = _pair_key(my_id, body.user_id)
    existing = await db.friendships.find_one({"pair_key": pk})
    if existing:
        if existing["status"] == "accepted":
            return {"ok": True, "status": "accepted"}
        # If the other requested, accept
        if existing["status"] == "pending" and existing["requested_by"] != my_id:
            await db.friendships.update_one({"_id": existing["_id"]}, {"$set": {"status": "accepted", "accepted_at": now_utc()}})
            return {"ok": True, "status": "accepted"}
        return {"ok": True, "status": "pending"}
    await db.friendships.insert_one({
        "pair_key": pk, "a_id": a, "b_id": b,
        "requested_by": my_id, "status": "pending",
        "points": 0, "created_at": now_utc(),
    })
    return {"ok": True, "status": "pending"}


@api.post("/friendship/accept")
async def accept_friendship(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    pk = _pair_key(my_id, body.user_id)
    r = await db.friendships.find_one_and_update(
        {"pair_key": pk, "status": "pending", "requested_by": {"$ne": my_id}},
        {"$set": {"status": "accepted", "accepted_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "No pending request")
    return {"ok": True}


@api.delete("/friendship")
async def delete_friendship(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    pk = _pair_key(my_id, body.user_id)
    await db.friendships.delete_one({"pair_key": pk})
    return {"ok": True}


# ---------- CP (Couple) ----------
@api.get("/cp")
async def list_cp(user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    cur = db.cp_pairs.find({"$or": [{"a_id": my_id}, {"b_id": my_id}]}).sort("points", -1).limit(50)
    out = []
    async for r in cur:
        out.append(await _relation_public(r, my_id, db))
    return out


@api.post("/cp/request", status_code=201)
async def request_cp(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    if body.user_id == my_id:
        raise HTTPException(400, "Cannot CP yourself")
    # One active CP per user
    active = await db.cp_pairs.find_one({"$or": [{"a_id": my_id}, {"b_id": my_id}], "status": "accepted"})
    if active:
        raise HTTPException(409, "You already have an active CP")
    try:
        target = await db.users.find_one({"_id": ObjectId(body.user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    a, b = sorted([my_id, body.user_id])
    pk = _pair_key(my_id, body.user_id)
    existing = await db.cp_pairs.find_one({"pair_key": pk})
    if existing:
        if existing["status"] == "accepted":
            return {"ok": True, "status": "accepted"}
        if existing["status"] == "pending" and existing["requested_by"] != my_id:
            await db.cp_pairs.update_one({"_id": existing["_id"]}, {"$set": {"status": "accepted", "accepted_at": now_utc()}})
            return {"ok": True, "status": "accepted"}
        return {"ok": True, "status": "pending"}
    await db.cp_pairs.insert_one({
        "pair_key": pk, "a_id": a, "b_id": b, "member_ids": [a, b],
        "requested_by": my_id, "status": "pending",
        "points": 0, "created_at": now_utc(),
    })
    return {"ok": True, "status": "pending"}


@api.post("/cp/accept")
async def accept_cp(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    # Not already have active CP
    active = await db.cp_pairs.find_one({"$or": [{"a_id": my_id}, {"b_id": my_id}], "status": "accepted"})
    if active:
        raise HTTPException(409, "You already have an active CP")
    pk = _pair_key(my_id, body.user_id)
    r = await db.cp_pairs.find_one_and_update(
        {"pair_key": pk, "status": "pending", "requested_by": {"$ne": my_id}},
        {"$set": {"status": "accepted", "accepted_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "No pending request")
    return {"ok": True}


@api.delete("/cp")
async def delete_cp(body: RelActionIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    pk = _pair_key(my_id, body.user_id)
    await db.cp_pairs.delete_one({"pair_key": pk})
    return {"ok": True}


# ---------- FAMILIES ----------
FAMILY_CREATE_COST = 10000


class FamilyCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=30)
    description: Optional[str] = Field(default=None, max_length=200)
    logo_url: Optional[str] = None


class FamilyMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


async def _family_public(f: dict, db) -> dict:
    members_count = await db.family_members.count_documents({"family_id": str(f["_id"])})
    return {
        "id": str(f["_id"]),
        "name": f["name"],
        "description": f.get("description", ""),
        "logo_url": f.get("logo_url"),
        "owner_id": f.get("owner_id"),
        "members_count": members_count,
        "points": f.get("points", 0),
        "created_at": f.get("created_at").isoformat() if isinstance(f.get("created_at"), datetime) else f.get("created_at"),
    }


@api.get("/families")
async def list_families(user=Depends(current_user)):
    db = app.state.db
    fams = await db.families.find({}).sort("points", -1).limit(50).to_list(50)
    return [await _family_public(f, db) for f in fams]


@api.get("/families/mine")
async def my_families(user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    memberships = await db.family_members.find({"user_id": my_id}).to_list(20)
    family_ids = [ObjectId(m["family_id"]) for m in memberships]
    fams = await db.families.find({"_id": {"$in": family_ids}}).to_list(20)
    return [await _family_public(f, db) for f in fams]


@api.post("/families", status_code=201)
async def create_family(body: FamilyCreateIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    if await db.families.find_one({"name": body.name}):
        raise HTTPException(409, "Family name is taken")
    r = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": FAMILY_CREATE_COST}},
        {"$inc": {"coins": -FAMILY_CREATE_COST}},
    )
    if not r:
        raise HTTPException(402, f"Need {FAMILY_CREATE_COST} Diamonds to create a family")
    doc = {
        "name": body.name,
        "description": body.description or "",
        "logo_url": body.logo_url or "https://images.unsplash.com/photo-1533377088493-8a7c3b3c4b04?w=400&h=400&fit=crop",
        "owner_id": my_id,
        "admins": [my_id],
        "points": 0,
        "created_at": now_utc(),
    }
    res = await db.families.insert_one(doc)
    fam_id = str(res.inserted_id)
    await db.family_members.insert_one({
        "family_id": fam_id, "user_id": my_id, "role": "owner",
        "user_pub": {"id": my_id, "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"), "vip_level": user.get("vip_level", 0)},
        "joined_at": now_utc(),
    })
    await db.wallet_transactions.insert_one({
        "user_id": my_id, "type": "family_create", "currency": "coins",
        "amount": -FAMILY_CREATE_COST, "balance_after": r["coins"] - FAMILY_CREATE_COST,
        "description": f"Created family: {body.name}", "status": "completed", "created_at": now_utc(),
    })
    doc["_id"] = res.inserted_id
    return await _family_public(doc, db)


@api.post("/families/{family_id}/join")
async def join_family(family_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    try:
        fam = await db.families.find_one({"_id": ObjectId(family_id)})
    except Exception:
        raise HTTPException(404, "Family not found")
    if not fam:
        raise HTTPException(404, "Family not found")
    existing = await db.family_members.find_one({"family_id": family_id, "user_id": my_id})
    if existing:
        return {"ok": True}
    await db.family_members.insert_one({
        "family_id": family_id, "user_id": my_id, "role": "member",
        "user_pub": {"id": my_id, "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"), "vip_level": user.get("vip_level", 0)},
        "joined_at": now_utc(),
    })
    return {"ok": True}


@api.post("/families/{family_id}/leave")
async def leave_family(family_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    try:
        fam = await db.families.find_one({"_id": ObjectId(family_id)})
    except Exception:
        raise HTTPException(404, "Family not found")
    if not fam:
        raise HTTPException(404, "Family not found")
    if fam.get("owner_id") == my_id:
        raise HTTPException(400, "Owner cannot leave — transfer or delete family")
    await db.family_members.delete_one({"family_id": family_id, "user_id": my_id})
    return {"ok": True}


@api.get("/families/{family_id}")
async def get_family(family_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    try:
        fam = await db.families.find_one({"_id": ObjectId(family_id)})
    except Exception:
        raise HTTPException(404, "Family not found")
    if not fam:
        raise HTTPException(404, "Family not found")
    my_member = await db.family_members.find_one({"family_id": family_id, "user_id": my_id})
    members = await db.family_members.find({"family_id": family_id}).sort("joined_at", 1).to_list(200)
    pub = await _family_public(fam, db)
    pub["is_member"] = bool(my_member)
    pub["is_owner"] = fam.get("owner_id") == my_id
    pub["members"] = [{"role": m["role"], **m.get("user_pub", {})} for m in members]
    return pub


@api.get("/families/{family_id}/messages")
async def family_messages(family_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    mem = await db.family_members.find_one({"family_id": family_id, "user_id": my_id})
    if not mem:
        raise HTTPException(403, "Not a family member")
    cur = db.family_messages.find({"family_id": family_id}, {"_id": 0}).sort("created_at", 1).limit(200)
    msgs = await cur.to_list(200)
    for m in msgs:
        if isinstance(m.get("created_at"), datetime):
            m["created_at"] = m["created_at"].isoformat()
    return msgs


@api.post("/families/{family_id}/messages")
async def send_family_message(family_id: str, body: FamilyMessageIn, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    mem = await db.family_members.find_one({"family_id": family_id, "user_id": my_id})
    if not mem:
        raise HTTPException(403, "Not a family member")
    doc = {
        "family_id": family_id,
        "sender_id": my_id,
        "sender_pub": {"nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"), "vip_level": user.get("vip_level", 0)},
        "text": body.text,
        "created_at": now_utc(),
    }
    await db.family_messages.insert_one(doc)
    doc.pop("_id", None)
    doc["created_at"] = doc["created_at"].isoformat()
    return doc


# ---------- Rankings v2 (with period + country + categories) ----------
def _period_start(period: str) -> Optional[datetime]:
    """Server-authoritative ranking window (iter-57):
      daily   → rolling last 24h
      weekly  → rolling last 168h (7×24h)
      monthly → start of the current UTC calendar month
    """
    n = now_utc()
    if period == "daily":   return n - timedelta(hours=24)
    if period == "weekly":  return n - timedelta(hours=168)
    if period == "monthly": return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return None  # all-time


@api.get("/rankings/v2/{category}")
async def rankings_v2(
    category: Literal["charm", "wealth", "gifts", "cp", "friendship", "custom_gifts", "rooms", "family"],
    period: Literal["daily", "weekly", "monthly", "all"] = "all",
    country: Optional[str] = None,
    user=Depends(current_user),
):
    db = app.state.db
    since = _period_start(period)

    # Iter-56 — Custom Gifts leaderboard: top users by # of custom gifts they
    # own (deleted != true). Score = count of their custom gifts.
    if category == "custom_gifts":
        pipeline = [
            {"$match": {"deleted": {"$ne": True}}},
            {"$group": {"_id": "$owner_id", "score": {"$sum": 1}}},
            {"$sort": {"score": -1}},
            {"$limit": 50},
        ]
        rows = []
        async for r in db.custom_gifts.aggregate(pipeline):
            try:
                u = await db.users.find_one({"_id": ObjectId(r["_id"])}) if r["_id"] else None
            except Exception:
                u = None
            if not u:
                continue
            if country and u.get("country_code") != country:
                continue
            rows.append({
                "id": str(u["_id"]),
                "nickname": u.get("nickname"),
                "avatar_url": u.get("avatar_url"),
                "vip_level": u.get("vip_level", 0), "age": u.get("age"), "gender": u.get("gender"), "wealth_level": u.get("wealth_level", 0), "charm_level": u.get("charm_level", 0),
                "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0)),
                "country_flag": u.get("country_flag"),
                "score": r["score"],
                "kind": "user",
            })
        return rows

    # Iter-56 — Rooms leaderboard: top rooms by member_count (live rooms only).
    if category == "rooms":
        q: dict = {}
        cur = db.rooms.find(q, {"name": 1, "cover_url": 1, "background_url": 1,
                                "member_count": 1, "follow_count": 1, "owner_id": 1, "category": 1})\
                      .sort("member_count", -1).limit(50)
        rows = []
        async for r in cur:
            rows.append({
                "id": str(r["_id"]),
                "nickname": r.get("name") or "Room",
                "avatar_url": r.get("cover_url") or r.get("background_url"),
                "score": int(r.get("member_count", 0) or 0),
                "follow_count": int(r.get("follow_count", 0) or 0),
                "category": r.get("category"),
                "kind": "room",
            })
        return rows

    # Iter-56 — Family leaderboard: top families by lifetime points.
    if category == "family":
        cur = db.families.find({}, {"name": 1, "icon_url": 1, "cover_url": 1,
                                    "points": 1}).sort("points", -1).limit(50)
        rows = []
        async for r in cur:
            rows.append({
                "id": str(r["_id"]),
                "nickname": r.get("name") or "Family",
                "avatar_url": r.get("icon_url") or r.get("cover_url"),
                "score": int(r.get("points", 0) or 0),
                "kind": "family",
            })
        return rows

    if category in ("charm", "wealth"):
        field = "charm_level" if category == "charm" else "wealth_level"
        q: dict = {}
        if country: q["country_code"] = country
        cur = db.users.find(q, {"nickname": 1, "avatar_url": 1, "vip_level": 1, "country_flag": 1, "age": 1, "gender": 1, "wealth_level": 1, "charm_level": 1, field: 1}).sort(field, -1).limit(50)
        out = []
        async for u in cur:
            out.append({
                "id": str(u["_id"]), "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"),
                "vip_level": u.get("vip_level", 0), "age": u.get("age"), "gender": u.get("gender"), "wealth_level": u.get("wealth_level", 0), "charm_level": u.get("charm_level", 0),
                "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0)),
                "country_flag": u.get("country_flag"),
                "score": u.get(field, 0),
            })
        return out

    if category == "gifts":
        # Top gifters by coins spent on gifts in period
        match: dict = {}
        if since: match["created_at"] = {"$gte": since}
        pipeline = [
            {"$match": match},
            {"$group": {"_id": "$sender_id", "score": {"$sum": "$total_cost"}, "nickname": {"$first": "$sender_nickname"}}},
            {"$sort": {"score": -1}},
            {"$limit": 50},
        ]
        rows = []
        async for r in db.gift_transactions.aggregate(pipeline):
            try:
                u = await db.users.find_one({"_id": ObjectId(r["_id"])}) if r["_id"] else None
            except Exception:
                u = None
            if not u:
                continue
            if country and u.get("country_code") != country:
                continue
            rows.append({
                "id": str(u["_id"]), "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"),
                "vip_level": u.get("vip_level", 0), "age": u.get("age"), "gender": u.get("gender"), "wealth_level": u.get("wealth_level", 0), "charm_level": u.get("charm_level", 0),
                "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0)),
                "country_flag": u.get("country_flag"),
                "score": r["score"],
            })
        return rows

    if category in ("cp", "friendship"):
        coll = db.cp_pairs if category == "cp" else db.friendships
        q2: dict = {"status": "accepted"}
        if since: q2["created_at"] = {"$gte": since}
        cur = coll.find(q2).sort("points", -1).limit(50)
        out = []
        async for r in cur:
            try:
                a = await db.users.find_one({"_id": ObjectId(r["a_id"])})
                b = await db.users.find_one({"_id": ObjectId(r["b_id"])})
            except Exception:
                continue
            if not a or not b:
                continue
            out.append({
                "id": str(r["_id"]),
                "pair": [
                    {"id": str(a["_id"]), "nickname": a.get("nickname"), "avatar_url": a.get("avatar_url"), "vip_level": a.get("vip_level", 0),
                     "name_color": _vip_name_color(int(a.get("vip_level", 0) or 0))},
                    {"id": str(b["_id"]), "nickname": b.get("nickname"), "avatar_url": b.get("avatar_url"), "vip_level": b.get("vip_level", 0),
                     "name_color": _vip_name_color(int(b.get("vip_level", 0) or 0))},
                ],
                "score": r.get("points", 0),
                "level": min(20, r.get("points", 0) // 1000 + 1),
            })
        return out


# ---------- My Rooms — see earlier declaration above /rooms/{room_id} to avoid path shadowing ----------


# ---------- Referral / Invite ----------
def _make_short_code(user_id: str) -> str:
    return hashlib.sha1(user_id.encode()).hexdigest()[:8].upper()


@api.get("/referral/me")
async def referral_me(user=Depends(current_user)):
    code = _make_short_code(str(user["_id"]))
    db = app.state.db
    count = await db.users.count_documents({"referred_by": code})
    return {"code": code, "referrals_count": count, "reward_per_referral": 500}


# ---------- Enhance gift send to add points to friendship + CP ----------
# NOTE: original send_gift is above; we patch here by wrapping — simpler: post-hook via a lightweight endpoint
# We handled the primary logic; for now award friendship/CP points inside a background task on send.


# ---------- Profile Visitors ----------
VIEW_DEDUP_MINUTES = 5


@api.post("/users/{user_id}/view")
async def record_view(user_id: str, user=Depends(current_user)):
    """Records a profile view with 5-minute dedup per viewer→target pair."""
    db = app.state.db
    my_id = str(user["_id"])
    if user_id == my_id:
        return {"counted": False, "reason": "self"}
    try:
        target_oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(404, "User not found")
    target = await db.users.find_one({"_id": target_oid}, {"_id": 1})
    if not target:
        raise HTTPException(404, "User not found")

    now = now_utc()
    cutoff = now - timedelta(minutes=VIEW_DEDUP_MINUTES)
    existing = await db.profile_visitors.find_one({"target_id": user_id, "viewer_id": my_id})
    if existing and existing.get("last_visit"):
        last = existing["last_visit"]
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last > cutoff:
            return {"counted": False, "reason": "dedup"}
    await _task_bump(db, my_id, "view_10_profiles")

    viewer_pub = {
        "id": my_id,
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
        "country_flag": user.get("country_flag"),
        # Prefer the real 8-digit numeric_id so the owner can act on it
        # (copy / search / message). Fall back to short-hash code when a
        # legacy user has no numeric_id backfilled yet.
        "short_id": user.get("numeric_id") or _make_short_code(my_id),
    }
    if existing:
        await db.profile_visitors.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {"last_visit": now, "viewer_pub": viewer_pub},
                "$inc": {"visits": 1},
            },
        )
    else:
        await db.profile_visitors.insert_one({
            "target_id": user_id, "viewer_id": my_id,
            "viewer_pub": viewer_pub,
            "visits": 1, "first_visit": now, "last_visit": now,
        })
    await db.users.update_one({"_id": target_oid}, {"$inc": {"profile_views_total": 1}})
    return {"counted": True}


@api.get("/users/me/visitors")
async def my_visitors(user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    cur = db.profile_visitors.find({"target_id": my_id}, {"_id": 0}).sort("last_visit", -1).limit(200)
    rows = await cur.to_list(200)
    # Compute today's unique-visitor count using UTC day boundary (server authoritative).
    now = now_utc()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_views = 0
    for r in rows:
        for k in ("first_visit", "last_visit"):
            v = r.get(k)
            if isinstance(v, datetime):
                if v.tzinfo is None:
                    v = v.replace(tzinfo=timezone.utc)
                if k == "last_visit" and v >= today_start:
                    today_views += 1
                r[k] = v.isoformat()
    fresh = await db.users.find_one({"_id": user["_id"]}, {"profile_views_total": 1})
    return {
        "lifetime_views": (fresh or {}).get("profile_views_total", 0),
        "today_views": today_views,
        "visitors": rows,
    }


# ================================================================
# ---------- ORIO Realtime & Production Additions ----------------
# WebSocket rooms, Emergent Google Auth, Agora RTC token,
# Blue Envelopes, Room Moderation, Post Comments, Room Chat.
# ================================================================
import httpx as _httpx  # noqa: E402
from fastapi import WebSocket, WebSocketDisconnect, Query  # noqa: E402
try:
    from agora_token_builder import RtcTokenBuilder as _RtcTokenBuilder  # noqa: E402
    _AGORA_LIB_OK = True
except Exception:
    _AGORA_LIB_OK = False

AGORA_APP_ID = os.environ.get("AGORA_APP_ID", "").strip()
AGORA_APP_CERTIFICATE = os.environ.get("AGORA_APP_CERTIFICATE", "").strip()


class _RoomHub:
    """In-memory pub/sub for real-time room events."""
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}
        self.presence: dict[str, dict[str, dict]] = {}  # room -> uid -> user_public

    async def connect(self, room_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms.setdefault(room_id, set()).add(ws)

    def disconnect(self, room_id: str, ws: WebSocket) -> None:
        s = self.rooms.get(room_id)
        if s:
            s.discard(ws)
            if not s:
                self.rooms.pop(room_id, None)

    async def broadcast(self, room_id: str, message: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(room_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room_id, ws)


_hub = _RoomHub()


class _GlobalHub:
    """Batch B — app-wide socket fan-out (luxury gift announcements)."""
    def __init__(self) -> None:
        self.sockets: set = set()
        self.by_user: dict[str, set] = {}
        self.active_at: dict[str, float] = {}  # uid -> last foreground heartbeat (monotonic)

    def add(self, uid: str, ws) -> None:
        self.sockets.add(ws)
        self.by_user.setdefault(uid, set()).add(ws)

    def remove(self, uid: str, ws) -> None:
        self.sockets.discard(ws)
        s = self.by_user.get(uid)
        if s:
            s.discard(ws)
            if not s:
                self.by_user.pop(uid, None)
                self.active_at.pop(uid, None)

    def mark_active(self, uid: str) -> None:
        self.active_at[uid] = time.monotonic()

    def is_active(self, uid: str, within_s: float = 45.0) -> bool:
        t = self.active_at.get(uid)
        return t is not None and (time.monotonic() - t) <= within_s

    async def broadcast(self, message: dict) -> None:
        for ws in list(self.sockets):
            try:
                await ws.send_json(message)
            except Exception:
                self.sockets.discard(ws)

    async def send_users(self, uids, message: dict) -> None:
        """Push a small event to every socket of the given users (best effort)."""
        for uid in set(u for u in uids if u):
            for ws in list(self.by_user.get(uid, ())):
                try:
                    await ws.send_json(message)
                except Exception:
                    self.remove(uid, ws)


_global_hub = _GlobalHub()


async def _push_users(uids, event: str, **data) -> None:
    try:
        await _global_hub.send_users(uids, {"type": event, **data})
    except Exception:
        pass

# Batch B — 20 animated emoji reactions (Google Noto animated emoji codes).
REACTION_KEYS = {
    "1f60d", "1f618", "1f970", "1f602", "1f923", "1f606", "1f62d", "1f97a", "1f622", "1f621",
    "1f92c", "1f624", "1f973", "1f389", "1f525", "1f44f", "1f4aa", "1f44d", "1f62e", "1f631",
    "1f618_m",  # mirrored (opposite-facing) kissing face
}
REACTION_COOLDOWN_S = 2.5
_reaction_last: dict[str, float] = {}

# Ephemeral in-memory mic invitations. Keyed by room_id → target_user_id →
# {seat_index, inviter, expires_at}. Cleared on accept/reject/timeout. No DB.
_mic_invites: dict[str, dict[str, dict]] = {}
_MIC_INVITE_TTL_S = 60


def _mic_invite_get(room_id: str, target_user_id: str) -> Optional[dict]:
    room = _mic_invites.get(room_id) or {}
    inv = room.get(target_user_id)
    if not inv:
        return None
    if inv.get("expires_at", 0) < time.time():
        room.pop(target_user_id, None)
        if not room:
            _mic_invites.pop(room_id, None)
        return None
    return inv


def _mic_invite_clear(room_id: str, target_user_id: str) -> None:
    room = _mic_invites.get(room_id)
    if not room:
        return
    room.pop(target_user_id, None)
    if not room:
        _mic_invites.pop(room_id, None)


async def _user_from_token(token: str) -> Optional[dict]:
    try:
        p = jwt.decode(token, ACCESS_SECRET, algorithms=[ALG])
        if p.get("typ") != "access":
            return None
        return await app.state.db.users.find_one({"_id": ObjectId(p["sub"])})
    except Exception:
        return None


async def _broadcast_room_state(room_id: str) -> None:
    try:
        r = await app.state.db.rooms.find_one({"_id": ObjectId(room_id)}, {"password_hash": 0})
        if r:
            await _hub.broadcast(room_id, {"type": "room_state", "room": public_room(r)})
    except Exception:
        pass


async def _room_entry(db, room_id: str, uid: str) -> Optional[dict]:
    return await db.room_entries.find_one({"user_id": uid, "room_id": room_id})


async def _room_access_ok(db, room: Optional[dict], uid: str, entry: Optional[dict]) -> bool:
    """Locked / password rooms: only owner, moderators, seated users or a
    user whose /join passed the backend PIN/password check may connect."""
    if not room or not (room.get("pin_hash") or room.get("room_password_hash")):
        return True
    if uid == room.get("owner_id") or uid in (room.get("moderators") or []):
        return True
    if any(s.get("user") and s["user"].get("id") == uid for s in room.get("seats") or []):
        return True
    return bool(entry and entry.get("granted"))


def _entry_cutoff(entry: Optional[dict]) -> datetime:
    """Chat visible to a participant starts at their CURRENT room entry."""
    j = (entry or {}).get("joined_at")
    if isinstance(j, datetime):
        return j if j.tzinfo else j.replace(tzinfo=timezone.utc)
    return now_utc()


@app.websocket("/api/ws/global")
async def _ws_global(ws: WebSocket, token: str = Query(...)):
    user = await _user_from_token(token)
    if not user:
        await ws.close(code=4401)
        return
    await ws.accept()
    uid = str(user["_id"])
    _global_hub.add(uid, ws)
    _global_hub.mark_active(uid)
    logger.info("ws/global connected user=%s", uid)
    try:
        while True:
            msg = await ws.receive_text()
            # "active" = app is in the foreground (lets incoming calls ring); "ping" = keep-alive.
            if msg == "active":
                _global_hub.mark_active(uid)
    except Exception:
        pass
    finally:
        _global_hub.remove(uid, ws)
        logger.info("ws/global disconnected user=%s", uid)


@app.websocket("/api/ws/rooms/{room_id}")
async def _ws_room(ws: WebSocket, room_id: str, token: str = Query(...)):
    user = await _user_from_token(token)
    if not user:
        await ws.close(code=4401)
        return
    uid = str(user["_id"])
    try:
        _room_doc = await app.state.db.rooms.find_one({"_id": ObjectId(room_id)}, {"pin_hash": 1, "room_password_hash": 1, "owner_id": 1, "moderators": 1, "seats": 1})
    except Exception:
        _room_doc = None
    _entry = await _room_entry(app.state.db, room_id, uid)
    if not await _room_access_ok(app.state.db, _room_doc, uid, _entry):
        await ws.accept()  # accept first so the client receives close code 4403
        await ws.close(code=4403)
        return
    _cutoff = _entry_cutoff(_entry)
    await _hub.connect(room_id, ws)
    user_pub = {
        "id": uid,
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
        "wealth_level": int(user.get("wealth_level", 0) or 0),
        "charm_level": int(user.get("charm_level", 0) or 0),
        "country_flag": user.get("country_flag"),
        # Iter-49 — ship the server-computed "جديد" flag so the client doesn't
        # have to track account-age locally. True for 5 days after created_at.
        "is_new": _is_new_user(user.get("created_at")),
    }
    # Iter-131 — equipped VIP entrance (only while VIP is still eligible).
    _ent = _vip_entrance_effect(user)
    # Iter-137 — no overlapping audio: end this user's private call BEFORE room entry.
    await app.state.db.calls.update_many(
        {"status": {"$in": ["ringing", "accepted"]}, "$or": [{"caller_id": uid}, {"callee_id": uid}]},
        {"$set": {"status": "ended", "ended_at": now_utc(), "end_reason": "joined_room", "ended_by": uid}})
    _hub.presence.setdefault(room_id, {})[uid] = user_pub
    # Entrance plays exactly ONCE per genuine /join (not on reconnects / restores).
    if _ent:
        _claim = await app.state.db.room_entries.find_one_and_update(
            {"user_id": uid, "room_id": room_id, "entrance_played": {"$ne": True}},
            {"$set": {"entrance_played": True}})
        if not _claim:
            _ent = None
    _join_user = {**user_pub, "entrance_effect": _ent} if _ent else user_pub
    # Send recent chat history to the newly connected socket only (not broadcast).
    try:
        history = await app.state.db.room_chat.find({"room_id": room_id, "created_at": {"$gte": _cutoff}}, {"_id": 0}) \
            .sort("created_at", -1).limit(30).to_list(30)
        history.reverse()
        # Enrich each with a small user snapshot for consistent rendering.
        author_ids = list({h["user_id"] for h in history if h.get("user_id")})
        authors: dict = {}
        for aid in author_ids:
            try:
                au = await app.state.db.users.find_one({"_id": ObjectId(aid)})
                if au:
                    authors[aid] = {
                        "id": aid,
                        "nickname": au.get("nickname"),
                        "avatar_url": au.get("avatar_url"),
                        "vip_level": au.get("vip_level", 0),
                    }
            except Exception:
                continue
        for h in history:
            u_snap = authors.get(h.get("user_id")) or {"nickname": "User"}
            at = h.get("created_at")
            await ws.send_json({
                "type": "chat",
                "id": h.get("mid") or f"h-{h.get('user_id')}-{at.isoformat() if isinstance(at, datetime) else at}",
                "history": True,
                "user": u_snap,
                "text": h.get("text", ""),
                "kind": h.get("kind") or "text",
                "media_url": h.get("media_url"),
                "at": at.replace(tzinfo=timezone.utc).isoformat() if isinstance(at, datetime) and at.tzinfo is None else (at.isoformat() if isinstance(at, datetime) else at),
            })
    except Exception:
        pass
    await _hub.broadcast(room_id, {"type": "user_joined", "user": _join_user, "present": list(_hub.presence[room_id].values())})
    # Personalized welcome message — auto system chat when welcome_msg is set.
    # Include user_id so the client can dedup reliably (welcome_uid == joiner id) and
    # render the joiner's name as a clickable link to their profile.
    try:
        _wroom = await app.state.db.rooms.find_one({"_id": ObjectId(room_id)}, {"welcome_msg": 1, "owner_id": 1})
        _wmsg = ((_wroom or {}).get("welcome_msg") or "").strip()
        if _wmsg:
            _nick = user_pub.get("nickname") or user_pub.get("username") or "User"
            _handle = user_pub.get("username") or _nick
            # Iter-67: owner's User Notice template may contain `@user` /
            # `@username` placeholders that must be swapped with the live
            # joiner's handle (`@Ahmed`). Case-insensitive, idempotent.
            import re as _re
            # Iter-117 — always mention the entering user; templates without a
            # placeholder get the joiner's name prefixed.
            _ph = r"@user(name)?\b|@?\{(nick)?name\}"
            if not _re.search(_ph, _wmsg, flags=_re.IGNORECASE):
                _wmsg_t = f"@user {_wmsg}"
            else:
                _wmsg_t = _wmsg
            _personalized = _re.sub(
                _ph,
                f"@{_nick}",
                _wmsg_t,
                flags=_re.IGNORECASE,
            )
            _owner_pub = None
            try:
                _ow = await app.state.db.users.find_one({"_id": ObjectId(_wroom.get("owner_id"))})
                if _ow:
                    _owner_pub = public_user(_ow)
            except Exception:
                _owner_pub = None
            await _hub.broadcast(room_id, {
                "type": "system",
                "kind": "welcome",
                "owner": _owner_pub,
                "text": _personalized,
                "welcome_msg": _personalized,
                "template": _wmsg,
                "user_id": uid,
                "nickname": _nick,
                "at": now_utc().isoformat(),
            })
    except Exception:
        pass
    try:
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "ping":
                await ws.send_json({"type": "pong", "at": now_utc().isoformat()})
            elif t == "chat":
                text = (msg.get("text") or "").strip()[:500]
                if not text:
                    continue
                # Room chat moderation (server-enforced): muted users and
                # "Mute Room Chat" (only owner + moderators may send).
                _rc = await app.state.db.rooms.find_one({"_id": ObjectId(room_id)}, {"owner_id": 1, "moderators": 1, "chat_locked": 1, "chat_muted_users": 1})
                if _rc:
                    _priv = uid == _rc.get("owner_id") or uid in (_rc.get("moderators") or [])
                    _code = None
                    if not _priv and uid in (_rc.get("chat_muted_users") or []):
                        _code = "CHAT_MUTED"
                    elif not _priv and _rc.get("chat_locked"):
                        _code = "CHAT_LOCKED"
                    if _code:
                        try:
                            await ws.send_json({"type": "chat_rejected", "code": _code})
                        except Exception:
                            pass
                        continue
                # Iter-135 — blocked content is never stored or broadcast.
                if _mod.find_violation(text):
                    try:
                        await ws.send_json({"type": "content_blocked", "code": "CONTENT_BLOCKED"})
                    except Exception:
                        pass
                    continue
                # Truncate to millisecond precision so live broadcast `at` matches the value
                # Mongo will read back on history replay (Mongo stores dates in ms precision).
                _now = now_utc()
                _now_ms = _now.replace(microsecond=(_now.microsecond // 1000) * 1000)
                entry = {
                    "room_id": room_id,
                    "mid": secrets.token_hex(8),
                    "user_id": uid,
                    "text": text,
                    "created_at": _now_ms,
                }
                await app.state.db.room_chat.insert_one(entry)
                # Iter-117 — live VIP/Wealth/Charm levels under the chat identity.
                try:
                    _lv = await app.state.db.users.find_one({"_id": ObjectId(uid)}, {"vip_level": 1, "wealth_level": 1, "charm_level": 1})
                    if _lv:
                        user_pub = {**user_pub, "vip_level": int(_lv.get("vip_level", 0) or 0),
                                    "wealth_level": int(_lv.get("wealth_level", 0) or 0),
                                    "charm_level": int(_lv.get("charm_level", 0) or 0)}
                except Exception:
                    pass
                await _hub.broadcast(room_id, {
                    "type": "chat",
                    "id": entry["mid"],
                    "user": user_pub,
                    "text": text,
                    "at": _now_ms.isoformat(),
                })
            elif t == "reaction":
                # Batch B — animated emoji reaction (seat overlay or room chat).
                _key = str(msg.get("emoji") or "")
                if _key not in REACTION_KEYS:
                    continue
                _nowt = time.time()
                if _nowt - _reaction_last.get(uid, 0) < REACTION_COOLDOWN_S:
                    try:
                        await ws.send_json({"type": "reaction_rejected", "code": "COOLDOWN"})
                    except Exception:
                        pass
                    continue
                _reaction_last[uid] = _nowt
                _rs = await app.state.db.rooms.find_one({"_id": ObjectId(room_id)}, {"seats": 1})
                _seat_idx = None
                for _s in (_rs or {}).get("seats") or []:
                    if ((_s or {}).get("user") or {}).get("id") == uid:
                        _seat_idx = _s.get("index")
                        break
                await _hub.broadcast(room_id, {
                    "type": "reaction",
                    "id": secrets.token_hex(6),
                    "user": user_pub,
                    "emoji": _key,
                    "seat_index": _seat_idx,
                    "at": now_utc().isoformat(),
                })
            elif t == "voice_state":
                await _hub.broadcast(room_id, {
                    "type": "voice_state",
                    "user_id": uid,
                    "muted": bool(msg.get("muted")),
                    "speaking": bool(msg.get("speaking")),
                })
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _hub.disconnect(room_id, ws)
        pres = _hub.presence.get(room_id, {})
        pres.pop(uid, None)
        if not pres:
            _hub.presence.pop(room_id, None)
        # Iter-121 — start the 24h room-badge memory window on socket drop.
        if uid not in _hub.presence.get(room_id, {}):
            try:
                await _room_badge_on_leave(app.state.db, room_id, uid)
            except Exception:
                pass
        # Seats are NEVER vacated on a transient socket drop (reconnect, background,
        # re-render). Only if the user stays fully disconnected for the grace
        # window (app killed / offline for good) is the seat released.
        asyncio.create_task(_seat_grace_vacate(room_id, uid))
        try:
            await _hub.broadcast(room_id, {"type": "user_left", "user_id": uid, "present": list(pres.values())})
        except Exception:
            pass


# ---------- Emergent Google Auth (disabled) ----------
# Replaced by /auth/google/firebase below. Kept for reference.
# class _GoogleSessionIn(BaseModel):
#     session_id: str = Field(min_length=8, max_length=512)
#
#
# @api.post("/auth/google/session", response_model=Tokens)
# async def _auth_google_session(body: _GoogleSessionIn):
#     db = app.state.db
#     try:
#         async with _httpx.AsyncClient(timeout=10.0) as client:
#             r = await client.get(
#                 "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
#                 headers={"X-Session-ID": body.session_id},
#             )
#         if r.status_code != 200:
#             raise HTTPException(401, "Invalid or expired Google session")
#         data = r.json()
#     except HTTPException:
#         raise
#     except Exception:
#         raise HTTPException(401, "Google auth service unavailable")
#
#     email = norm_email(data.get("email") or "")
#     if not email:
#         raise HTTPException(400, "Google did not return an email")
#     name = (data.get("name") or "ORIO User")[:30]
#     picture = data.get("picture")
#
#     user = await db.users.find_one({"email": email})
#     if not user:
#         from account_deletion import assert_credential_reusable as _reuse_ok
#         await _reuse_ok(db, email=email)
#         base = "".join(ch for ch in email.split("@")[0] if ch.isalnum())[:14] or "user"
#         candidate = base
#         i = 0
#         while await db.users.find_one({"username": candidate}):
#             i += 1
#             candidate = f"{base}{i}"
#         doc = {
#             "email": email,
#             "username": candidate,
#             "nickname": name,
#             "password_hash": pw_hash(secrets.token_hex(24)),
#             "auth_provider": "google",
#             "avatar_url": picture or f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
#             "bio": "",
#             "level": 1,
#             "wealth_level": 0,
#             "charm_level": 0,
#             "vip_level": 0,
#             # Iter-36: seed the preserved points fields on account creation.
#             "wealth_points": 0,
#             "charm_points": 0,
#             "growth_points": 0,
#             "coins": 500,
#             "diamonds": 10,
#             "experience": 0,
#             "followers_count": 0,
#             "following_count": 0,
#             "created_at": now_utc(),
#             "language": "en",
#         }
#         ins = await db.users.insert_one(doc)
#         uid = str(ins.inserted_id)
#         await db.wallet_transactions.insert_one({
#             "user_id": uid, "type": "welcome_bonus", "currency": "coins",
#             "amount": 500, "balance_after": 500, "created_at": now_utc(),
#             "status": "completed", "description": "Welcome to ORIO!",
#         })
#     else:
#         uid = str(user["_id"])
#     return await issue_pair(db, uid)


# ---------- Google Sign-In via Firebase Authentication (web) ----------
# The browser signs in with Google through Firebase and sends us the Firebase ID
# token. We verify it with the Firebase Admin SDK (signature, expiry, audience =
# our project) and only then trust its uid / email claims.
FIREBASE_PROJECT_ID = (os.environ.get("FIREBASE_PROJECT_ID") or "orio-4d359").strip()


class _FirebaseGoogleIn(BaseModel):
    id_token: str = Field(min_length=20, max_length=8192)


def _verify_firebase_google_token(token: str) -> dict:
    import push as _fb_push
    from firebase_admin import auth as _fb_auth
    try:
        fb_app = _fb_push._firebase()
    except Exception:
        logger.exception("Firebase Admin is not configured")
        raise HTTPException(503, "Google sign-in is not configured")
    try:
        claims = _fb_auth.verify_id_token(token, app=fb_app, clock_skew_seconds=10)
    except (_fb_auth.ExpiredIdTokenError, _fb_auth.RevokedIdTokenError):
        raise HTTPException(401, "Google sign-in expired, please try again")
    except _fb_auth.CertificateFetchError:
        logger.exception("Could not fetch Firebase signing certificates")
        raise HTTPException(503, "Google sign-in is temporarily unavailable")
    except (_fb_auth.InvalidIdTokenError, ValueError):
        raise HTTPException(401, "Invalid Google sign-in token")
    except Exception as e:

        logger.warning("Firebase ID token rejected (%s)", type(e).__name__)
        raise HTTPException(401, "Invalid Google sign-in token")
    if claims.get("aud") != FIREBASE_PROJECT_ID:
        raise HTTPException(401, "Invalid Google sign-in token")
    if (claims.get("firebase") or {}).get("sign_in_provider") != "google.com":
        raise HTTPException(401, "Token is not from Google sign-in")
    return claims


@api.post("/auth/google/firebase", response_model=Tokens)
async def _auth_google_firebase(body: _FirebaseGoogleIn):
    from starlette.concurrency import run_in_threadpool
    claims = await run_in_threadpool(_verify_firebase_google_token, body.id_token.strip())
    firebase_uid = str(claims.get("uid") or claims.get("sub") or "").strip()
    email = norm_email(claims.get("email") or "")
    if not firebase_uid or not email:
        raise HTTPException(400, "Google did not return an account email")
    if claims.get("email_verified") is not True:
        raise HTTPException(403, "Your Google email is not verified")
    name = (claims.get("name") or "Yazeen User").strip()[:30] or "Yazeen User"
    picture = claims.get("picture")

    db = app.state.db
    user = await db.users.find_one({"firebase_uid": firebase_uid})
    if not user:
        # Link only by a Google-verified email, and never take over an account
        # that is already linked to a different Google identity.
        user = await db.users.find_one({"email": email})
        if user:
            if user.get("firebase_uid") and user["firebase_uid"] != firebase_uid:
                raise HTTPException(409, "This email is linked to a different Google account")
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"firebase_uid": firebase_uid}})
    if user:
        return await issue_pair(db, str(user["_id"]))

    from account_deletion import assert_credential_reusable as _reuse_ok
    await _reuse_ok(db, firebase_uid=firebase_uid, email=email)
    base = "".join(ch for ch in email.split("@")[0] if ch.isalnum())[:14] or "user"
    candidate = base
    i = 0
    while await db.users.find_one({"username": candidate}):
        i += 1
        candidate = f"{base}{i}"
    doc = {
        "firebase_uid": firebase_uid,
        "email": email,
        "username": candidate,
        "nickname": name,
        "password_hash": pw_hash(secrets.token_hex(24)),
        "auth_provider": "google",
        "avatar_url": picture or f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
        "bio": "",
        "level": 1, "wealth_level": 0, "charm_level": 0, "vip_level": 0,
        "wealth_points": 0, "charm_points": 0, "growth_points": 0,
        "coins": 500, "diamonds": 10, "experience": 0,
        "followers_count": 0, "following_count": 0,
        "numeric_id": await _generate_unique_numeric_id(db),
        "created_at": now_utc(),
        "language": "en",
    }
    try:
        ins = await db.users.insert_one(doc)
    except Exception:
        # Concurrent first sign-in with the same Google account.
        user = await db.users.find_one({"firebase_uid": firebase_uid}) or await db.users.find_one({"email": email})
        if user:
            return await issue_pair(db, str(user["_id"]))
        raise HTTPException(500, "Could not create Google account")
    uid = str(ins.inserted_id)
    await db.wallet_transactions.insert_one({
        "user_id": uid, "type": "welcome_bonus", "currency": "coins",
        "amount": 500, "balance_after": 500, "created_at": now_utc(),
        "status": "completed", "description": "Welcome to Yazeen!",
    })
    return await issue_pair(db, uid)


# ---------- Sign in with Apple (iOS) ----------
APPLE_AUDIENCES = [a.strip() for a in os.environ.get("APPLE_AUDIENCES", "").split(",") if a.strip()]
_apple_jwks_client = jwt.PyJWKClient("https://appleid.apple.com/auth/keys", cache_keys=True, lifespan=3600)


class _AppleSignInIn(BaseModel):
    identity_token: str = Field(min_length=20, max_length=8192)
    full_name: Optional[str] = Field(default=None, max_length=60)
    email: Optional[str] = Field(default=None, max_length=254)


def _verify_apple_token(token: str) -> dict:
    if not APPLE_AUDIENCES:
        raise HTTPException(503, "Apple sign-in is not configured")
    try:
        key = _apple_jwks_client.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token, key, algorithms=["RS256"],
            audience=APPLE_AUDIENCES, issuer="https://appleid.apple.com",
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid Apple identity token")
    except Exception:
        raise HTTPException(401, "Apple identity token could not be verified")


@api.post("/auth/apple", response_model=Tokens)
async def _auth_apple(body: _AppleSignInIn):
    from starlette.concurrency import run_in_threadpool
    claims = await run_in_threadpool(_verify_apple_token, body.identity_token.strip())
    apple_sub = str(claims.get("sub") or "").strip()
    if not apple_sub:
        raise HTTPException(401, "Apple did not return a user id")
    email = norm_email(claims.get("email") or body.email or "") or None
    name = (body.full_name or "").strip()[:30] or "Yazeen User"

    db = app.state.db
    user = await db.users.find_one({"apple_sub": apple_sub})
    if not user and email:
        user = await db.users.find_one({"email": email})
        if user:
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"apple_sub": apple_sub}})
    if user:
        return await issue_pair(db, str(user["_id"]))

    from account_deletion import assert_credential_reusable as _reuse_ok
    await _reuse_ok(db, apple_sub=apple_sub, email=email)
    base = "ap" + "".join(ch for ch in apple_sub if ch.isalnum())[-8:]
    candidate = base[:14]
    i = 0
    while await db.users.find_one({"username": candidate}):
        i += 1
        candidate = f"{base[:12]}{i}"[:14]
    doc = {
        "apple_sub": apple_sub,
        # `email` has a non-sparse unique index → use a unique placeholder when Apple hides it.
        "email": email or f"{hashlib.sha256(apple_sub.encode()).hexdigest()[:20]}@apple.orio.invalid",
        "username": candidate,
        "nickname": name,
        "auth_provider": "apple",
        "password_hash": pw_hash(secrets.token_hex(24)),
        "avatar_url": f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
        "bio": "",
        "level": 1, "wealth_level": 0, "charm_level": 0, "vip_level": 0,
        "wealth_points": 0, "charm_points": 0, "growth_points": 0,
        "coins": 500, "diamonds": 10, "experience": 0,
        "followers_count": 0, "following_count": 0,
        "numeric_id": await _generate_unique_numeric_id(db),
        "created_at": now_utc(),
        "language": "en",
    }
    try:
        ins = await db.users.insert_one(doc)
    except Exception:
        user = await db.users.find_one({"apple_sub": apple_sub})
        if user:
            return await issue_pair(db, str(user["_id"]))
        raise HTTPException(500, "Could not create Apple account")
    uid = str(ins.inserted_id)
    await db.wallet_transactions.insert_one({
        "user_id": uid, "type": "welcome_bonus", "currency": "coins",
        "amount": 500, "balance_after": 500, "created_at": now_utc(),
        "status": "completed", "description": "Welcome to Yazeen!",
    })
    return await issue_pair(db, uid)



# ---------- Agora RTC Token ----------
class _RtcTokenIn(BaseModel):
    channel: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    uid: int = Field(ge=1, le=2_147_483_647)


@api.get("/rtc/config")
async def _rtc_config():
    return {
        "enabled": bool(AGORA_APP_ID and AGORA_APP_CERTIFICATE and _AGORA_LIB_OK),
        "app_id": AGORA_APP_ID or None,
    }


@api.post("/rtc/token")
async def _rtc_token(body: _RtcTokenIn, user=Depends(current_user)):
    if not (AGORA_APP_ID and AGORA_APP_CERTIFICATE):
        raise HTTPException(503, "Voice service not configured. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE.")
    if not _AGORA_LIB_OK:
        raise HTTPException(503, "Voice service library unavailable")
    # Determine role: publisher if user is owner or seated in room matching channel; else subscriber.
    can_publish = False
    room_id_from_channel = body.channel[5:] if body.channel.startswith("orio_") else body.channel
    try:
        r = await app.state.db.rooms.find_one({"_id": ObjectId(room_id_from_channel)})
        if r and not await _room_access_ok(app.state.db, r, str(user["_id"]), await _room_entry(app.state.db, room_id_from_channel, str(user["_id"]))):
            raise HTTPException(403, "ROOM_LOCKED")
        if r:
            uid_str = str(user["_id"])
            if r.get("owner_id") == uid_str:
                can_publish = True
            elif any(s.get("user") and s["user"].get("id") == uid_str for s in r.get("seats", [])):
                can_publish = True
    except HTTPException:
        raise
    except Exception:
        pass
    role = 1 if can_publish else 2  # 1=Publisher, 2=Subscriber
    expires = int(now_utc().timestamp()) + 3600
    token = _RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID, AGORA_APP_CERTIFICATE, body.channel, body.uid, role, expires
    )
    return {
        "app_id": AGORA_APP_ID,
        "channel": body.channel,
        "uid": body.uid,
        "token": token,
        "expires_at": expires,
        "role": "publisher" if can_publish else "subscriber",
    }


# ---------- Iter-134: One-to-one voice calls (Agora, server-issued tokens) ----------
_CALL_RING_S = 40
_CALL_ACTIVE = ("ringing", "accepted")


def _in_voice_room(uid: str) -> bool:
    """True while the user's room socket is connected (incl. minimized room)."""
    return any(uid in (p or {}) for p in _hub.presence.values())


def _call_uid(user_id: str) -> int:
    return (int(user_id[-8:], 16) % 2_000_000_000) + 1


def _call_token(channel: str, user_id: str) -> dict:
    if not (AGORA_APP_ID and AGORA_APP_CERTIFICATE and _AGORA_LIB_OK):
        raise HTTPException(503, "Voice service not configured")
    uid = _call_uid(user_id)
    expires = int(now_utc().timestamp()) + 3600
    token = _RtcTokenBuilder.buildTokenWithUid(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channel, uid, 1, expires)
    return {"app_id": AGORA_APP_ID, "channel": channel, "uid": uid, "token": token, "expires_at": expires}


_CALL_ROOM_MSG = "CALL_BLOCKED_IN_ROOM"


async def _call_pub(db, c: dict, me: str) -> dict:
    other_id = c["callee_id"] if c["caller_id"] == me else c["caller_id"]
    o = await db.users.find_one({"_id": ObjectId(other_id)}, {"nickname": 1, "avatar_url": 1, "vip_level": 1})
    return {
        "id": str(c["_id"]), "status": c["status"], "channel": c["channel"],
        "direction": "outgoing" if c["caller_id"] == me else "incoming",
        "caller_id": c["caller_id"], "callee_id": c["callee_id"],

        "accepted_at": _aware(c["accepted_at"]).isoformat() if isinstance(c.get("accepted_at"), datetime) else None,
        # Set once both sides are in the voice channel; until then clients show "Connecting…".
        "connected_at": _aware(c["connected_at"]).isoformat() if isinstance(c.get("connected_at"), datetime) else None,
        # Seconds since the call connected, by the server clock (clients count on from it).
        "elapsed_s": max(0, int((now_utc() - _aware(c["connected_at"])).total_seconds()))
                     if isinstance(c.get("connected_at"), datetime) else None,
        "peer": {"id": other_id, "nickname": (o or {}).get("nickname"), "avatar_url": (o or {}).get("avatar_url"),
                 "vip_level": int((o or {}).get("vip_level", 0) or 0)},
    }


async def _flush_call_logs(db) -> None:
    """Write a call-history entry into the private chat for every finished
    call exactly once: answered → real duration, otherwise "No Answer"."""
    while True:
        c = await db.calls.find_one_and_update(
            {"status": {"$nin": list(_CALL_ACTIVE)}, "logged": {"$ne": True}},
            {"$set": {"logged": True}})
        if not c:
            return
        acc, end = _aware(c.get("accepted_at")), _aware(c.get("ended_at")) or now_utc()
        # Duration counts from when both sides were connected (older calls: from accept).
        start = _aware(c.get("connected_at")) or (acc if not c.get("connect_tracked") else None)
        dur = int(max(0, (end - start).total_seconds())) if start else 0
        answered = bool(acc)
        await db.messages.insert_one({
            "sender_id": c["caller_id"], "recipient_id": c["callee_id"],
            "thread_key": thread_key(c["caller_id"], c["callee_id"]),
            "kind": "call", "text": (f"Voice call {dur // 60}:{dur % 60:02d}" if answered else "No Answer"),
            "call_status": "answered" if answered else "no_answer", "duration": dur,
            "call_id": str(c["_id"]), "media_url": None, "read": answered, "created_at": end,
        })
        await _push_users([c["caller_id"], c["callee_id"]], "dm_update", peer_ids=[c["caller_id"], c["callee_id"]])


async def _expire_ringing(db) -> None:
    await db.calls.update_many(
        {"status": "ringing", "created_at": {"$lt": now_utc() - timedelta(seconds=_CALL_RING_S)}},
        {"$set": {"status": "missed", "ended_at": now_utc()}})


class _CallStartIn(BaseModel):
    callee_id: str


@api.post("/calls/start")
async def _call_start(body: _CallStartIn, user=Depends(current_user)):
    if not (AGORA_APP_ID and AGORA_APP_CERTIFICATE and _AGORA_LIB_OK):
        raise HTTPException(503, "Voice service not configured")
    db = app.state.db
    me = str(user["_id"])
    if body.callee_id == me:
        raise HTTPException(400, "Cannot call yourself")
    try:
        callee = await db.users.find_one({"_id": ObjectId(body.callee_id)}, {"is_official": 1})
    except Exception:
        callee = None
    if not callee or callee.get("is_official") or user.get("is_official"):
        raise HTTPException(404, "User not available")
    await _assert_not_blocked(db, me, body.callee_id)
    # Server-enforced: calls only while BOTH users are outside voice rooms.
    if _in_voice_room(me):
        raise HTTPException(409, "CALLER_IN_ROOM")
    if _in_voice_room(body.callee_id):
        raise HTTPException(409, "CALLEE_IN_ROOM")
    await _expire_ringing(db)
    busy = await db.calls.find_one({"status": {"$in": list(_CALL_ACTIVE)},
                                     "$or": [{"caller_id": {"$in": [me, body.callee_id]}},
                                             {"callee_id": {"$in": [me, body.callee_id]}}]})
    if busy:
        raise HTTPException(409, "CALL_BUSY")
    # Incoming calls only ring while the callee is actively inside ORIO
    # (foreground heartbeat via /calls/current every ~1.5 s).
    cal = await db.users.find_one({"_id": ObjectId(body.callee_id)}, {"app_active_at": 1})
    act = _aware((cal or {}).get("app_active_at"))
    app_recent = bool(act and (now_utc() - act).total_seconds() <= 12)
    if not (app_recent or _global_hub.is_active(body.callee_id)):
        await db.calls.insert_one({"caller_id": me, "callee_id": body.callee_id, "status": "missed",
                                   "end_reason": "offline", "created_at": now_utc(), "ended_at": now_utc(), "channel": None})
        await _flush_call_logs(db)
        raise HTTPException(409, "CALLEE_UNAVAILABLE")
    doc = {"caller_id": me, "callee_id": body.callee_id, "status": "ringing", "created_at": now_utc()}
    r = await db.calls.insert_one(doc)
    channel = f"call_{r.inserted_id}"
    await db.calls.update_one({"_id": r.inserted_id}, {"$set": {"channel": channel}})
    doc.update({"_id": r.inserted_id, "channel": channel})
    await _push_users([me, body.callee_id], "call_update", call_id=str(r.inserted_id))
    return {"call": await _call_pub(db, doc, me), "rtc": _call_token(channel, me)}


@api.get("/calls/current")
async def _call_current(user=Depends(current_user)):
    db = app.state.db
    me = str(user["_id"])
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"app_active_at": now_utc()}})
    await _expire_ringing(db)
    await _flush_call_logs(db)
    c = await db.calls.find_one({"status": {"$in": list(_CALL_ACTIVE)}, "$or": [{"caller_id": me}, {"callee_id": me}]},
                                sort=[("created_at", -1)])
    last = None
    if not c:
        e = await db.calls.find_one({"$or": [{"caller_id": me}, {"callee_id": me}],
                                     "ended_at": {"$gte": now_utc() - timedelta(seconds=15)}}, sort=[("ended_at", -1)])
        if e:
            last = {"id": str(e["_id"]), "status": e["status"], "end_reason": e.get("end_reason"),
                    "ended_by_me": e.get("ended_by") == me}
    return {"call": await _call_pub(db, c, me) if c else None, "last": last}


async def _get_my_call(db, call_id: str, me: str) -> dict:
    try:
        c = await db.calls.find_one({"_id": ObjectId(call_id)})
    except Exception:
        c = None
    if not c or me not in (c["caller_id"], c["callee_id"]):
        raise HTTPException(404, "Call not found")
    return c


@api.post("/calls/{call_id}/accept")
async def _call_accept(call_id: str, user=Depends(current_user)):
    if not (AGORA_APP_ID and AGORA_APP_CERTIFICATE and _AGORA_LIB_OK):
        raise HTTPException(503, "Voice service not configured")
    db = app.state.db
    me = str(user["_id"])
    c = await _get_my_call(db, call_id, me)
    if c["callee_id"] != me:
        raise HTTPException(403, "Only the callee can accept")
    if _in_voice_room(c["caller_id"]) or _in_voice_room(me):
        await db.calls.update_one({"_id": c["_id"], "status": "ringing"}, {"$set": {"status": "ended", "ended_at": now_utc(), "end_reason": "in_room"}})
        raise HTTPException(409, "CALLER_IN_ROOM" if _in_voice_room(me) else "CALLEE_IN_ROOM")
    res = await db.calls.find_one_and_update(
        {"_id": c["_id"], "status": "ringing", "created_at": {"$gte": now_utc() - timedelta(seconds=_CALL_RING_S)}},
        {"$set": {"status": "accepted", "accepted_at": now_utc(), "connect_tracked": True}}, return_document=True)
    if not res:
        raise HTTPException(409, "CALL_NOT_RINGING")
    await _push_users([c["caller_id"], c["callee_id"]], "call_update", call_id=call_id)
    return {"call": await _call_pub(db, res, me), "rtc": _call_token(res["channel"], me)}


@api.post("/calls/{call_id}/connected")
async def _call_connected(call_id: str, user=Depends(current_user)):
    """A participant reports it has joined the voice channel and can see the other
    party there — i.e. both sides are connected. The first report sets connected_at
    (idempotent); both sides then start the call timer from it."""
    db = app.state.db
    me = str(user["_id"])
    c = await _get_my_call(db, call_id, me)
    if c["status"] != "accepted":
        raise HTTPException(409, "CALL_NOT_ACTIVE")
    res = await db.calls.find_one_and_update(
        {"_id": c["_id"], "status": "accepted", "connected_at": {"$exists": False}},
        {"$set": {"connected_at": now_utc()}}, return_document=True)
    if res:
        await _push_users([c["caller_id"], c["callee_id"]], "call_update", call_id=call_id)
    return {"call": await _call_pub(db, res or await db.calls.find_one({"_id": c["_id"]}), me)}


@api.post("/calls/{call_id}/token")
async def _call_renew(call_id: str, user=Depends(current_user)):
    db = app.state.db
    me = str(user["_id"])
    c = await _get_my_call(db, call_id, me)
    if c["status"] not in _CALL_ACTIVE:
        raise HTTPException(409, "Call ended")
    return _call_token(c["channel"], me)


@api.post("/calls/{call_id}/end")
async def _call_end(call_id: str, user=Depends(current_user)):
    """Hang up / reject / cancel (idempotent)."""
    db = app.state.db
    me = str(user["_id"])
    c = await _get_my_call(db, call_id, me)
    if c["status"] in _CALL_ACTIVE:
        status_ = "rejected" if (c["status"] == "ringing" and c["callee_id"] == me) else (
            "cancelled" if c["status"] == "ringing" else "ended")
        await db.calls.update_one({"_id": c["_id"], "status": {"$in": list(_CALL_ACTIVE)}},
                                  {"$set": {"status": status_, "ended_at": now_utc(), "ended_by": me}})
    await _flush_call_logs(db)
    await _push_users([c["caller_id"], c["callee_id"]], "call_update", call_id=call_id)
    return {"ok": True}


# ---------- Blue Envelopes ----------
class _EnvelopeCreateIn(BaseModel):
    amount: int = Field(ge=10, le=1_000_000)
    slots: int = Field(ge=1, le=200)
    message: Optional[str] = Field(default="Blue Envelope!", max_length=80)


def _split_random(total: int, slots: int) -> list[int]:
    if slots <= 1:
        return [total]
    if total <= slots:
        parts = [1] * total + [0] * (slots - total)
        random.shuffle(parts)
        return parts
    parts = [1] * slots
    remaining = total - slots
    for _ in range(remaining):
        parts[random.randint(0, slots - 1)] += 1
    random.shuffle(parts)
    return parts


@api.post("/rooms/{room_id}/envelopes", status_code=201)
async def _create_envelope(room_id: str, body: _EnvelopeCreateIn, user=Depends(current_user)):
    db = app.state.db
    try:
        room = await db.rooms.find_one({"_id": ObjectId(room_id)})
    except Exception:
        raise HTTPException(404, "Room not found")
    if not room:
        raise HTTPException(404, "Room not found")
    total = body.amount
    u = await db.users.find_one_and_update(
        {"_id": user["_id"], "diamonds": {"$gte": total}},
        {"$inc": {"diamonds": -total}},
    )
    if not u:
        raise HTTPException(402, "Insufficient diamonds")
    parts = _split_random(total, body.slots)
    env_id = secrets.token_hex(10)
    now_t = now_utc()
    sender_pub = {
        "id": str(user["_id"]),
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
    }
    doc = {
        "env_id": env_id,
        "room_id": room_id,
        "sender_id": str(user["_id"]),
        "sender_pub": sender_pub,
        "amount": total,
        "slots_total": body.slots,
        "slots_remaining": body.slots,
        "amount_remaining": total,
        "message": body.message or "Blue Envelope!",
        "parts": parts,
        "claims": [],
        "created_at": now_t,
        "expires_at": now_t + timedelta(hours=24),
    }
    await db.envelopes.insert_one(doc)
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "envelope_sent",
        "currency": "diamonds",
        "amount": -total,
        "reference_id": env_id,
        "description": f"Blue Envelope × {body.slots} slots",
        "status": "completed",
        "created_at": now_t,
    })
    await _hub.broadcast(room_id, {
        "type": "envelope_created",
        "envelope": {
            "env_id": env_id,
            "sender": sender_pub,
            "amount": total,
            "slots": body.slots,
            "slots_remaining": body.slots,
            "message": doc["message"],
            "created_at": now_t.isoformat(),
        },
    })
    return {"ok": True, "env_id": env_id, "amount": total, "slots": body.slots}


@api.post("/envelopes/{env_id}/claim")
async def _claim_envelope(env_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    env = await db.envelopes.find_one({"env_id": env_id})
    if not env:
        raise HTTPException(404, "Envelope not found")
    if env["sender_id"] == my_id:
        raise HTTPException(400, "You cannot claim your own envelope")
    if any(c.get("user_id") == my_id for c in env.get("claims", [])):
        raise HTTPException(409, "Already claimed")
    if env.get("slots_remaining", 0) <= 0:
        raise HTTPException(410, "All slots claimed")
    exp = env.get("expires_at")
    if isinstance(exp, datetime) and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < now_utc():
        raise HTTPException(410, "Envelope expired")
    idx = env["slots_total"] - env["slots_remaining"]
    part = int(env["parts"][idx])
    claim = {
        "user_id": my_id,
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "amount": part,
        "at": now_utc(),
    }
    r = await db.envelopes.find_one_and_update(
        {"env_id": env_id, "slots_remaining": {"$gt": 0}, "claims.user_id": {"$ne": my_id}},
        {"$push": {"claims": claim}, "$inc": {"slots_remaining": -1, "amount_remaining": -part}},
    )
    if not r:
        raise HTTPException(409, "Already claimed or no slots left")
    if part > 0:
        await db.users.update_one({"_id": user["_id"]}, {"$inc": {"diamonds": part}})
        await db.wallet_transactions.insert_one({
            "user_id": my_id,
            "type": "envelope_claimed",
            "currency": "diamonds",
            "amount": part,
            "reference_id": env_id,
            "description": f"Claimed Blue Envelope from {env['sender_pub'].get('nickname')}",
            "status": "completed",
            "created_at": now_utc(),
        })
    await _hub.broadcast(env["room_id"], {
        "type": "envelope_claimed",
        "env_id": env_id,
        "user": {"id": my_id, "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url")},
        "amount": part,
        "slots_remaining": max(0, r["slots_remaining"] - 1),
    })
    return {"ok": True, "amount": part}


@api.get("/rooms/{room_id}/envelopes")
async def _list_envelopes(room_id: str, user=Depends(current_user)):
    db = app.state.db
    rows = await db.envelopes.find({
        "room_id": room_id,
        "slots_remaining": {"$gt": 0},
        "expires_at": {"$gt": now_utc()},
    }, {"parts": 0}).sort("created_at", -1).to_list(30)
    out = []
    for e in rows:
        out.append({
            "env_id": e["env_id"],
            "sender": e.get("sender_pub"),
            "amount": e["amount"],
            "amount_remaining": e["amount_remaining"],
            "slots": e["slots_total"],
            "slots_remaining": e["slots_remaining"],
            "message": e["message"],
            "created_at": e["created_at"].isoformat() if isinstance(e["created_at"], datetime) else e["created_at"],
            "expires_at": e["expires_at"].isoformat() if isinstance(e.get("expires_at"), datetime) else None,
            "claimed_by_me": any(c.get("user_id") == str(user["_id"]) for c in e.get("claims", [])),
        })
    return out


# ---------- Room Moderation ----------
class _ModerateIn(BaseModel):
    action: Literal["mute_seat", "unmute_seat", "lock_seat", "unlock_seat", "kick_seat"]
    seat_index: int = Field(ge=0, le=25)


@api.post("/rooms/{room_id}/moderate")
async def _moderate(room_id: str, body: _ModerateIn, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    my_id = str(user["_id"])
    is_owner = room.get("owner_id") == my_id
    is_mod = my_id in (room.get("moderators") or [])
    if not (is_owner or is_mod):
        raise HTTPException(403, "Only owner or moderator can moderate")
    idx = body.seat_index
    seats = room.get("seats", [])
    if idx < 0 or idx >= len(seats):
        raise HTTPException(400, "Invalid seat")
    seat_user_id = (seats[idx].get("user") or {}).get("id")
    if body.action == "kick_seat" and seat_user_id == room["owner_id"]:
        raise HTTPException(403, "Cannot kick the owner")
    upd: dict = {}
    if body.action == "mute_seat":
        upd[f"seats.{idx}.muted"] = True
    elif body.action == "unmute_seat":
        upd[f"seats.{idx}.muted"] = False
    elif body.action == "lock_seat":
        upd[f"seats.{idx}.locked"] = True
    elif body.action == "unlock_seat":
        upd[f"seats.{idx}.locked"] = False
    elif body.action == "kick_seat":
        upd[f"seats.{idx}.user"] = None
        upd[f"seats.{idx}.muted"] = False
    await db.rooms.update_one({"_id": oid}, {"$set": upd})
    await _broadcast_room_state(room_id)
    # Iter-98 — persisted system notification for the kicked user.
    if body.action == "kick_seat" and seat_user_id and seat_user_id != my_id:
        await _notify_room_kick(db, seat_user_id, user, room)
    r2 = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    return public_room(r2)



# ---------- Real-time participants ----------
@api.get("/rooms/{room_id}/participants")
async def _room_participants(room_id: str, user=Depends(current_user)):
    """Return the users currently connected to a room via WebSocket presence.

    This is the authoritative live-participant list; it is *not* the same as
    the `listeners_count` counter (which is incremented per join HTTP call).
    """
    pres = list((_hub.presence.get(room_id) or {}).values())
    return {"room_id": room_id, "count": len(pres), "participants": pres}


# ---------- Room lock (5-digit code required to join) ----------
_PIN_RE = re.compile(r"^\d{5}$")


class _RoomLockIn(BaseModel):
    pin: str


@api.post("/rooms/{room_id}/lock")
async def _room_lock(room_id: str, body: _RoomLockIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can lock the room")
    if not _PIN_RE.match(body.pin or ""):
        raise HTTPException(400, "PIN must be exactly 5 digits")
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": {"pin_hash": pw_hash(body.pin)}})
    await db.room_entries.update_many({"room_id": room_id}, {"$set": {"granted": False}})
    await _broadcast_room_state(room_id)
    try:
        await _hub.broadcast(room_id, {"type": "system", "kind": "room_locked", "at": now_utc().isoformat()})
    except Exception:
        pass
    return {"ok": True, "is_locked": True}


@api.post("/rooms/{room_id}/unlock")
async def _room_unlock(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can unlock the room")
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$unset": {"pin_hash": ""}})
    await _broadcast_room_state(room_id)
    try:
        await _hub.broadcast(room_id, {"type": "system", "kind": "room_unlocked", "at": now_utc().isoformat()})
    except Exception:
        pass
    return {"ok": True, "is_locked": False}


# ---------- Room settings: Notice + Welcome Message + Legacy toggles ----------
class _RoomSettingsIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
    notice: Optional[str] = None
    welcome_msg: Optional[str] = None
    entrance_effects: Optional[bool] = None
    noise_reduction: Optional[bool] = None
    music_control_role: Optional[Literal["owner", "mods", "seat"]] = None


@api.patch("/rooms/{room_id}/settings")
async def _room_update_settings(room_id: str, body: _RoomSettingsIn, user=Depends(current_user)):
    _guard_text(body.name, body.notice, body.welcome_msg)
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can edit room settings")
    upd: dict = {}
    if body.name is not None:
        # Iter-117 — room name is owner-only.
        if room.get("owner_id") != str(user["_id"]):
            raise HTTPException(403, "Only the room owner can rename the room")
        nm = body.name.strip()
        if not nm:
            raise HTTPException(400, "Room name cannot be empty")
        upd["name"] = nm[:40]
    if body.notice is not None:
        upd["notice"] = str(body.notice)[:500]
    if body.welcome_msg is not None:
        upd["welcome_msg"] = str(body.welcome_msg)[:200]
    # Legacy nested settings toggles (entrance effects / noise reduction / music role)
    current = room.get("settings") or {
        "entrance_effects": True, "noise_reduction": True, "music_control_role": "owner",
    }
    legacy_changed = False
    if body.entrance_effects is not None:
        current["entrance_effects"] = bool(body.entrance_effects); legacy_changed = True
    if body.noise_reduction is not None:
        current["noise_reduction"] = bool(body.noise_reduction); legacy_changed = True
    if body.music_control_role is not None:
        current["music_control_role"] = body.music_control_role; legacy_changed = True
    if legacy_changed:
        upd["settings"] = current
    if not upd:
        raise HTTPException(400, "Nothing to update")
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": upd})
    await _broadcast_room_state(room_id)
    resp = {"ok": True}
    resp.update({k: v for k, v in upd.items() if k != "settings"})
    if "settings" in upd:
        resp["settings"] = upd["settings"]
    return resp


# ---------- Iter-67 — Room cover (avatar) upload + 3-day block list ----------
#
# ALLOW_INAPPROPRIATE flag: a real production system would call a vision
# moderation API here (Rekognition / OpenAI moderation / etc.). For the MVP
# we expose the full infrastructure (per-user block list, 3-day TTL,
# `/rooms/cover/moderate` hook) so moderators can block an exact image hash
# at any time. The hook defaults to "pass" so the flow remains usable.
_ROOM_COVER_BLOCK_DAYS = 3


def _hash_image_url(url: str) -> str:
    """Stable sha256 of a data URI or remote URL used as the block key."""
    return hashlib.sha256((url or "").strip().encode("utf-8")).hexdigest()


async def _is_cover_blocked_for_user(db, user_id: str, image_url: str) -> Optional[datetime]:
    """Returns the UTC `blocked_until` if the user is currently blocked from
    using this exact image, otherwise None."""
    h = _hash_image_url(image_url)
    now_t = now_utc()
    row = await db.room_image_blocks.find_one({
        "user_id": str(user_id),
        "image_hash": h,
    })
    if not row:
        return None
    b = row.get("blocked_until")
    if isinstance(b, datetime) and b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    if not isinstance(b, datetime) or b <= now_t:
        return None
    return b


async def _moderate_cover_image(image_url: str) -> dict:
    """Return `{"ok": True}` or `{"ok": False, "reason": "..."}`.

    Hard safety floor:
      • Must have an http(s):// scheme or a data:image/* prefix.
      • Data URIs must be ≥ 2 kB (reject obvious 1-byte / corrupted uploads).
      • Image hash must not be in the shared `moderation.blocked_image_hashes`
        collection (populated by moderators / future AI pipeline).

    Iter-71 — if the payload is a GIF, enforce ORIO's hard GIF limits:
      • 5 MB max file size
      • 512×512 max dimensions
      • 60 frames max
      • 5 s max duration
    """
    url = (image_url or "").strip()
    if not url:
        return {"ok": False, "reason": "Image is required"}
    is_data = url.startswith("data:image/")
    is_http = url.startswith("http://") or url.startswith("https://")
    if not (is_data or is_http):
        return {"ok": False, "reason": "Unsupported image format"}
    if is_data:
        # Rough size check — base64 is ~4/3 the bytes. Skip for GIFs since
        # legitimate 1×1 placeholder GIFs are tiny but perfectly valid; the
        # dedicated `_validate_gif_limits` handles GIF payload sanity.
        _, _, payload = url.partition(",")
        if not _looks_like_gif(url) and len(payload) < 2000:
            return {"ok": False, "reason": "Image is too small / corrupted"}
    # Global blocked-hash list (admin-populated).
    db = app.state.db
    h = _hash_image_url(url)
    hit = await db.moderation_blocked_hashes.find_one({"image_hash": h})
    if hit:
        return {"ok": False, "reason": "Image was flagged as inappropriate"}
    return {"ok": True}


# -------- Iter-71 — hard GIF limits (shared by profile + room avatars) ---------
GIF_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
GIF_MAX_DIM = 512                # 512×512 px
GIF_MAX_FRAMES = 60              # 60 frames
GIF_MAX_SECONDS = 5.0            # 5 seconds


async def _validate_gif_limits(image_url: str) -> dict:
    """Parse the GIF payload (data URI or http URL) and verify every ORIO
    GIF limit. Returns `{"ok": True}` or `{"ok": False, "reason": "..."}`.
    """
    import base64, io
    try:
        if image_url.startswith("data:"):
            _, _, b64 = image_url.partition(",")
            try:
                raw = base64.b64decode(b64, validate=False)
            except Exception:
                return {"ok": False, "reason": "GIF payload could not be decoded"}
        else:
            # Fetch remote URL (small timeout so moderation stays fast).
            import httpx
            try:
                async with httpx.AsyncClient(timeout=6.0) as c:
                    r = await c.get(image_url)
                    r.raise_for_status()
                    raw = r.content
            except Exception as e:
                return {"ok": False, "reason": f"Could not download GIF ({e})"}
        # 5 MB size cap
        if len(raw) > GIF_MAX_BYTES:
            mb = len(raw) / (1024 * 1024)
            return {"ok": False, "reason": f"GIF is too large ({mb:.1f} MB, max 5 MB)"}
        # Open with Pillow and iterate frames
        try:
            from PIL import Image, ImageSequence
            img = Image.open(io.BytesIO(raw))
            if (img.format or "").upper() != "GIF":
                return {"ok": False, "reason": "Only GIF files are allowed"}
            w, h = img.size
            if w > GIF_MAX_DIM or h > GIF_MAX_DIM:
                return {"ok": False, "reason": f"GIF is too large ({w}×{h} px, max 512×512)"}
            frames = 0
            total_ms = 0
            for frame in ImageSequence.Iterator(img):
                frames += 1
                total_ms += int(frame.info.get("duration") or 0)
                if frames > GIF_MAX_FRAMES:
                    return {"ok": False, "reason": f"GIF has too many frames (max {GIF_MAX_FRAMES})"}
            total_s = total_ms / 1000.0
            if total_s > GIF_MAX_SECONDS + 0.05:
                return {"ok": False, "reason": f"GIF is too long ({total_s:.1f}s, max 5s)"}
        except HTTPException:
            raise
        except Exception as e:
            return {"ok": False, "reason": f"GIF could not be parsed ({e})"}
    except HTTPException:
        raise
    except Exception as e:
        return {"ok": False, "reason": f"GIF validation failed ({e})"}
    return {"ok": True}


async def _is_user_media_blocked(db, user_id: str) -> Optional[datetime]:
    """Iter-69 — user-level 3-day block that covers BOTH profile avatars/GIFs
    and room avatars. Enforced server-side so the restriction cannot be
    bypassed by refreshing, logging out, or switching devices."""
    row = await db.users.find_one({"_id": ObjectId(user_id)}, {"media_blocked_until": 1})
    if not row:
        return None
    b = row.get("media_blocked_until")
    if isinstance(b, datetime) and b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    if not isinstance(b, datetime) or b <= now_utc():
        return None
    return b


async def _apply_user_media_block(db, user_id: str, reason: str) -> datetime:
    """Flag the user as blocked from uploading avatar/GIF for 3 days."""
    until = now_utc() + timedelta(days=_ROOM_COVER_BLOCK_DAYS)
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "media_blocked_until": until,
            "media_blocked_reason": reason or "inappropriate",
            "media_blocked_at": now_utc(),
        }},
    )
    return until


async def _ensure_cover_allowed(db, user_id: str, image_url: str):
    """Combines the per-user 3-day block list with the moderation check.
    Raises HTTPException(403) on inappropriate-content failures (and records
    a fresh 3-day block). GIF-limit violations are returned as 400 WITHOUT
    triggering the block.
    """
    # Iter-69 — user-level block takes precedence (covers profile+room).
    uu = await _is_user_media_blocked(db, user_id)
    if uu:
        raise HTTPException(
            403,
            "USER_MEDIA_BLOCKED",
        )
    blocked_until = await _is_cover_blocked_for_user(db, user_id, image_url)
    if blocked_until:
        secs = int((blocked_until - now_utc()).total_seconds())
        hours = max(1, (secs + 3599) // 3600)
        raise HTTPException(
            403,
            f"This image is blocked for {hours} more hours. Please choose a different image.",
        )
    # Iter-71 — GIF-limit violations are rejected with a clear message and
    # DO NOT trigger the 3-day block (they aren't inappropriate content).
    if _looks_like_gif(image_url):
        v = await _validate_gif_limits(image_url)
        if not v.get("ok"):
            raise HTTPException(400, v.get("reason") or "GIF rejected")
    verdict = await _moderate_cover_image(image_url)
    if not verdict.get("ok"):
        # Record a 3-day block for the user+hash so retries are rejected.
        await db.room_image_blocks.update_one(
            {"user_id": str(user_id), "image_hash": _hash_image_url(image_url)},
            {"$set": {
                "user_id": str(user_id),
                "image_hash": _hash_image_url(image_url),
                "blocked_until": now_utc() + timedelta(days=_ROOM_COVER_BLOCK_DAYS),
                "reason": verdict.get("reason") or "inappropriate",
                "created_at": now_utc(),
            }},
            upsert=True,
        )
        # Iter-69 — moderation failure also triggers the user-wide
        # media block that covers profile avatar/GIF uploads.
        await _apply_user_media_block(db, user_id, verdict.get("reason") or "inappropriate")
        raise HTTPException(
            403,
            "USER_MEDIA_BLOCKED",
        )


class _RoomCoverIn(BaseModel):
    cover_url: str


@api.post("/room-covers/moderate")
async def _room_cover_moderate(body: _RoomCoverIn, user=Depends(current_user)):
    """Pre-flight check so the client can validate an image BEFORE submitting
    it to Create Room / cover update. Returns `{ok: True, cover_url}` or
    HTTPException with the appropriate 403."""
    db = app.state.db
    await _ensure_cover_allowed(db, str(user["_id"]), body.cover_url)
    return {"ok": True, "cover_url": body.cover_url}


@api.patch("/rooms/{room_id}/cover")
async def _room_update_cover(room_id: str, body: _RoomCoverIn, user=Depends(current_user)):
    """Owner-only: update the room's avatar/cover. Persists immediately and
    broadcasts the new state so every connected client reflects the change."""
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if str(user["_id"]) != str(room.get("owner_id")):
        raise HTTPException(403, "Only the room owner can change the room avatar")
    is_gif = _looks_like_gif(body.cover_url or "")
    if is_gif and int(user.get("vip_level") or 0) < 5:
        raise HTTPException(403, "GIF_VIP5_REQUIRED")
    await _ensure_cover_allowed(db, str(user["_id"]), body.cover_url)
    await db.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$set": {"cover_url": body.cover_url}},
    )
    await _broadcast_room_state(room_id)
    return {"ok": True, "cover_url": body.cover_url}


# ---------- Iter-69 — Profile avatar / GIF with same block system ----------
#
# Shared VIP5+ gate for GIF uploads applies to BOTH profile and room avatars.
# A single user-level media block (`users.media_blocked_until`) is enforced
# across every avatar/GIF endpoint so the restriction cannot be bypassed by
# switching surfaces or devices.
def _looks_like_gif(url: str) -> bool:
    u = (url or "").strip()
    ul = u.lower()
    if ul.startswith("data:image/gif"):
        return True
    if ul.endswith(".gif"):
        return True
    # Fallback: query-string tricks won't rename the mimetype — if the base
    # path has `.gif` in it, treat as GIF.
    if ".gif?" in ul or ".gif#" in ul:
        return True
    # Iter-72 — strict byte-level detection. If the payload is a data URI
    # (even one that advertises itself as `image/jpeg` or `image/png`),
    # decode the first few bytes of the base64 and look for the GIF magic
    # signatures `GIF87a` / `GIF89a`. This catches clients that lie about
    # the MIME type when uploading GIF files through the "static photo"
    # entry point.
    if ul.startswith("data:") and "base64," in u:
        try:
            import base64 as _b64_mod
            b64 = u.split("base64,", 1)[1][:32]
            # Pad to multiple of 4 so base64.b64decode doesn't choke.
            pad = (-len(b64)) % 4
            raw = _b64_mod.b64decode(b64 + ("=" * pad), validate=False)
            if raw[:6] in (b"GIF87a", b"GIF89a") or raw[:3] == b"GIF":
                return True
        except Exception:
            pass
    return False


class _ProfileAvatarIn(BaseModel):
    avatar_url: str
    kind: Literal["photo", "gif"] = "photo"


@api.get("/me/media-block")
async def _me_media_block(user=Depends(current_user)):
    """Lightweight status endpoint so the client can pre-check whether the
    current user is under the 3-day avatar/GIF restriction."""
    db = app.state.db
    bu = await _is_user_media_blocked(db, str(user["_id"]))
    return {
        "blocked": bool(bu),
        "blocked_until": bu.isoformat() if bu else None,
    }


def _gif_first_frame_data_uri(url: str) -> Optional[str]:
    """Static PNG of a GIF's first frame (used when GIF access expires)."""
    try:
        import io as _io
        from PIL import Image as _PILImage
        if url.startswith("data:"):
            raw = _b64.b64decode(url.split(",", 1)[1])
        else:
            raw = _requests.get(url, timeout=8).content
        im = _PILImage.open(_io.BytesIO(raw))
        im.seek(0)
        im = im.convert("RGBA")
        im.thumbnail((512, 512))
        buf = _io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + _b64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        logger.warning(f"gif first frame failed: {e}")
        return None


async def _freeze_expired_gifs(db) -> int:
    """Users whose GIF eligibility lapsed: freeze the animated avatar into a
    static first-frame image (never deleted; GIF kept for re-activation)."""
    n = 0
    async for u in db.users.find({"animated_avatar_url": {"$nin": [None, ""]}},
                                 {"vip_level": 1, "gif_access_until": 1, "animated_avatar_url": 1, "avatar_static_url": 1, "avatar_url": 1}):
        if _gif_eligible(u):
            continue
        static = u.get("avatar_static_url") or _gif_first_frame_data_uri(u["animated_avatar_url"])
        upd = {"animated_avatar_url": None, "frozen_gif_url": u["animated_avatar_url"]}
        if static:
            upd["avatar_url"] = static
            upd["avatar_static_url"] = static
        await db.users.update_one({"_id": u["_id"]}, {"$set": upd})
        n += 1
    return n


class _GifPurchaseIn(BaseModel):
    request_id: str = Field(min_length=8, max_length=64)


@api.post("/me/gif-access/purchase")
async def _gif_access_purchase(body: _GifPurchaseIn, user=Depends(current_user)):
    """7 days of GIF avatar access for exactly 19,999 diamonds. Idempotent by
    request_id; refused while VIP4+ or an active pass already exists."""
    db = app.state.db
    uid = str(user["_id"])
    prior = await db.gif_purchases.find_one({"user_id": uid, "request_id": body.request_id})
    if prior:
        return {"ok": True, "duplicate": True, "gif_access_until": _gif_access_until({"gif_access_until": prior["until"]}).isoformat()}
    if int(user.get("vip_level", 0) or 0) >= 4:
        raise HTTPException(409, "VIP4_ALREADY_HAS_GIF")
    if _gif_eligible(user):
        raise HTTPException(409, "GIF_ACCESS_ALREADY_ACTIVE")
    now = now_utc()
    until = now + timedelta(days=GIF_ACCESS_DAYS)
    try:
        await db.gif_purchases.insert_one({"user_id": uid, "request_id": body.request_id, "status": "pending", "created_at": now, "until": until})
    except Exception:
        raise HTTPException(409, "DUPLICATE_REQUEST")
    # Atomic: only charge if balance suffices AND no active pass (race-safe).
    deducted = await db.users.find_one_and_update(
        {"_id": user["_id"], "diamonds": {"$gte": GIF_ACCESS_PRICE},
         "$or": [{"gif_access_until": {"$exists": False}}, {"gif_access_until": None}, {"gif_access_until": {"$lte": now}}]},
        {"$inc": {"diamonds": -GIF_ACCESS_PRICE}, "$set": {"gif_access_until": until, "gif_access_purchased_at": now}},
        return_document=True)
    if not deducted:
        await db.gif_purchases.delete_one({"user_id": uid, "request_id": body.request_id})
        raise HTTPException(402, "Insufficient diamonds")
    await db.gif_purchases.update_one({"user_id": uid, "request_id": body.request_id}, {"$set": {"status": "completed"}})
    await db.wallet_transactions.insert_one({
        "user_id": uid, "type": "gif_access_7d", "currency": "diamonds", "amount": -GIF_ACCESS_PRICE,
        "reference_id": body.request_id, "description": "GIF avatar access — 7 days",
        "status": "completed", "created_at": now})
    # Re-activate a previously frozen GIF avatar.
    if deducted.get("frozen_gif_url") and not deducted.get("animated_avatar_url"):
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"animated_avatar_url": deducted["frozen_gif_url"], "avatar_url": deducted["frozen_gif_url"]}})
    return {"ok": True, "gif_access_until": until.isoformat(), "diamonds": int(deducted.get("diamonds", 0))}


@api.post("/me/profile-avatar/moderate")
async def _profile_avatar_moderate(body: _ProfileAvatarIn, user=Depends(current_user)):
    """Pre-flight validation for profile avatars/GIFs. Mirrors the room-cover
    moderation flow + VIP5+ gate for GIFs."""
    db = app.state.db
    if body.kind == "gif":
        if not _looks_like_gif(body.avatar_url):
            raise HTTPException(400, "This endpoint accepts GIFs only")
        if not _gif_eligible(user):
            raise HTTPException(403, "GIF_VIP4_REQUIRED")
    else:
        if _looks_like_gif(body.avatar_url):
            raise HTTPException(400, "Use the GIF option to upload a GIF")
    await _ensure_cover_allowed(db, str(user["_id"]), body.avatar_url)
    return {"ok": True, "avatar_url": body.avatar_url, "kind": body.kind}


@api.patch("/me/profile-avatar")
async def _profile_avatar_update(body: _ProfileAvatarIn, user=Depends(current_user)):
    """Persist the user's profile avatar. Photos write `avatar_url`, GIFs
    additionally write `animated_avatar_url` so the client can keep the
    static fallback for places that cannot render animation."""
    db = app.state.db
    if body.kind == "gif":
        if not _looks_like_gif(body.avatar_url):
            raise HTTPException(400, "This endpoint accepts GIFs only")
        if not _gif_eligible(user):
            raise HTTPException(403, "GIF_VIP4_REQUIRED")
    else:
        if _looks_like_gif(body.avatar_url):
            raise HTTPException(400, "Use the GIF option to upload a GIF")
    await _ensure_cover_allowed(db, str(user["_id"]), body.avatar_url)
    upd: dict = {}
    if body.kind == "gif":
        upd["animated_avatar_url"] = body.avatar_url
        upd["avatar_url"] = body.avatar_url
        upd["avatar_static_url"] = _gif_first_frame_data_uri(body.avatar_url)
        upd["frozen_gif_url"] = None
    else:
        upd["avatar_url"] = body.avatar_url
        upd["animated_avatar_url"] = None    # clear previous GIF
    await db.users.update_one({"_id": user["_id"]}, {"$set": upd})
    if body.kind == "gif":
        # Iter-98 — GIF passed moderation and is now live.
        await _sys_notify(db, str(user["_id"]), "gif_approved", {}, {"type": "profile", "id": str(user["_id"])},
                          "Your GIF was successfully approved.")
    me = await db.users.find_one({"_id": user["_id"]})
    return public_user(me)


# ---------- Room Password (5-digit) — separate from PIN Lock ----------
_ROOM_PW_RE = re.compile(r"^\d{5}$")


class _RoomPasswordIn(BaseModel):
    password: str


@api.post("/rooms/{room_id}/password")
async def _room_password_set(room_id: str, body: _RoomPasswordIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can set the room password")
    if not _ROOM_PW_RE.match(body.password or ""):
        raise HTTPException(400, "Room Password must be exactly 5 digits")
    await db.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$set": {"room_password_hash": pw_hash(body.password)}},
    )
    await db.room_entries.update_many({"room_id": room_id}, {"$set": {"granted": False}})
    await _broadcast_room_state(room_id)
    return {"ok": True, "has_room_password": True}


@api.delete("/rooms/{room_id}/password")
async def _room_password_clear(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can remove the room password")
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$unset": {"room_password_hash": ""}})
    await _broadcast_room_state(room_id)
    return {"ok": True, "has_room_password": False}


# ---------- Mic invite / change-seat (owner+mod only) ----------
class _MicInviteIn(BaseModel):
    target_user_id: str
    seat_index: int = Field(ge=0, le=25)


@api.post("/rooms/{room_id}/mic-invite")
async def _mic_invite(room_id: str, body: _MicInviteIn, user=Depends(current_user)):
    """
    Owner/moderator invites a user (who is currently in the room but NOT on a
    seat) to a specific empty seat. This is a REAL invitation with Accept /
    Reject — it does NOT force-seat the target. The invitation is stored in
    memory (60s TTL) and broadcast as a `mic_invite_request` WS event so the
    target's client can present the Accept/Reject modal. See
    /mic-invite/accept and /mic-invite/reject.
    """
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can invite")
    seats = room.get("seats") or []
    idx = body.seat_index
    if idx < 0 or idx >= len(seats):
        raise HTTPException(400, "Invalid seat")
    if seats[idx].get("locked"):
        raise HTTPException(403, "Seat is locked")
    if seats[idx].get("user"):
        raise HTTPException(409, "Seat is occupied")
    # Host seat only for owner/mods
    if idx == 0 and body.target_user_id not in {room.get("owner_id"), *(room.get("moderators") or [])}:
        raise HTTPException(403, "هذا المقعد لصاحب الغرفة فقط")
    if body.target_user_id == str(user["_id"]):
        raise HTTPException(400, "Cannot invite yourself")
    try:
        target = await db.users.find_one({"_id": ObjectId(body.target_user_id)})
    except Exception:
        raise HTTPException(404, "Target user not found")
    if not target:
        raise HTTPException(404, "Target user not found")
    # Ensure target is present in the room (WS presence).
    present_ids = set((_hub.presence.get(room_id) or {}).keys())
    if body.target_user_id not in present_ids:
        raise HTTPException(400, "Target user is not in the room")
    # Target must NOT already occupy any seat.
    for s in seats:
        u = s.get("user")
        if u and u.get("id") == body.target_user_id:
            raise HTTPException(400, "Target user is already on a mic")
    # Store the invitation.
    inviter_pub = {
        "id": str(user["_id"]),
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
    }
    _mic_invites.setdefault(room_id, {})[body.target_user_id] = {
        "seat_index": idx,
        "inviter": inviter_pub,
        "expires_at": time.time() + _MIC_INVITE_TTL_S,
    }
    # Broadcast a targeted invite event — every socket receives it, and each
    # client compares `target.id` with its own user id to decide whether to
    # render the modal (kept simple to avoid a per-user hub map).
    try:
        await _hub.broadcast(room_id, {
            "type": "mic_invite_request",
            "target": {"id": body.target_user_id, "nickname": target.get("nickname"), "avatar_url": target.get("avatar_url")},
            "inviter": inviter_pub,
            "seat_index": idx,
            "expires_in_s": _MIC_INVITE_TTL_S,
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    await _notify_push([body.target_user_id], "Yazeen",
                       f"{inviter_pub.get('nickname') or 'Yazeen'} invited you to a mic seat 🎤",
                       f"/room/{room_id}", key=f"micinv:{room_id}:{body.target_user_id}:{int(time.time() // 60)}")
    return {"ok": True, "seat_index": idx, "target_user_id": body.target_user_id, "expires_in_s": _MIC_INVITE_TTL_S}


@api.post("/rooms/{room_id}/mic-invite/accept")
async def _mic_invite_accept(room_id: str, user=Depends(current_user)):
    """Target user accepts a pending mic invite → seats them, broadcasts state."""
    db = app.state.db
    my_id = str(user["_id"])
    inv = _mic_invite_get(room_id, my_id)
    if not inv:
        raise HTTPException(404, "No pending invitation")
    room = await _get_room_or_404(db, room_id)
    seats = room.get("seats") or []
    idx = int(inv.get("seat_index", -1))
    if idx < 0 or idx >= len(seats):
        _mic_invite_clear(room_id, my_id)
        raise HTTPException(400, "Invalid seat")
    if seats[idx].get("locked"):
        _mic_invite_clear(room_id, my_id)
        raise HTTPException(403, "Seat is locked")
    if seats[idx].get("user"):
        _mic_invite_clear(room_id, my_id)
        raise HTTPException(409, "Seat is occupied")
    # If the accepter was somehow on another seat, free it first.
    await db.rooms.update_one(
        {"_id": ObjectId(room_id), "seats.user.id": my_id},
        {"$set": {"seats.$.user": None, "seats.$.muted": False}},
    )
    seat_user = {
        "id": my_id,
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
    }
    await db.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$set": {f"seats.{idx}.user": seat_user, f"seats.{idx}.muted": False}},
    )
    _mic_invite_clear(room_id, my_id)
    await _broadcast_room_state(room_id)
    try:
        await _hub.broadcast(room_id, {
            "type": "system", "kind": "mic_invite_accepted",
            "user": {"id": my_id, "nickname": user.get("nickname")},
            "seat_index": idx,
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    r2 = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"password_hash": 0, "pin_hash": 0})
    return public_room(r2)


@api.post("/rooms/{room_id}/mic-invite/reject")
async def _mic_invite_reject(room_id: str, user=Depends(current_user)):
    """Target user rejects a pending mic invite → clears + notifies inviter."""
    my_id = str(user["_id"])
    inv = _mic_invite_get(room_id, my_id)
    if not inv:
        # Idempotent — nothing to reject.
        return {"ok": True}
    _mic_invite_clear(room_id, my_id)
    try:
        await _hub.broadcast(room_id, {
            "type": "mic_invite_rejected",
            "target": {"id": my_id, "nickname": user.get("nickname")},
            "inviter_id": (inv.get("inviter") or {}).get("id"),
            "seat_index": inv.get("seat_index"),
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    return {"ok": True}


class _MicChangeSeatIn(BaseModel):
    from_index: int = Field(ge=0, le=25)
    to_index: int = Field(ge=0, le=25)


@api.post("/rooms/{room_id}/mic-change-seat")
async def _mic_change_seat(room_id: str, body: _MicChangeSeatIn, user=Depends(current_user)):
    """Owner/moderator moves the user currently on seat `from` to empty seat `to`."""
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can move seats")
    seats = room.get("seats") or []
    if body.from_index < 0 or body.from_index >= len(seats) or body.to_index < 0 or body.to_index >= len(seats):
        raise HTTPException(400, "Invalid seat")
    if body.from_index == body.to_index:
        return public_room(room)
    src = seats[body.from_index]
    dst = seats[body.to_index]
    if not src.get("user"):
        raise HTTPException(400, "Source seat is empty")
    if dst.get("user"):
        raise HTTPException(409, "Destination seat is occupied")
    if dst.get("locked"):
        raise HTTPException(403, "Destination seat is locked")
    # Host chair restriction still applies to the moved user
    if body.to_index == 0 and src["user"]["id"] not in {room.get("owner_id"), *(room.get("moderators") or [])}:
        raise HTTPException(403, "هذا المقعد لصاحب الغرفة فقط")
    moved_user = src["user"]
    was_muted = bool(src.get("muted", False))
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": {
        f"seats.{body.from_index}.user": None,
        f"seats.{body.from_index}.muted": False,
        f"seats.{body.to_index}.user": moved_user,
        f"seats.{body.to_index}.muted": was_muted,
    }})
    await _broadcast_room_state(room_id)
    r2 = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"password_hash": 0, "pin_hash": 0})
    return public_room(r2)



# ---------- Room Follow / Membership / Moderators / Bans ----------

class _MembershipReviewIn(BaseModel):
    request_id: str
    action: Literal["approve", "reject"]


class _ModeratorIn(BaseModel):
    user_id: str


class _BanIn(BaseModel):
    user_id: str
    reason: Optional[str] = None


async def _room_follow_count(db, room_id: str) -> int:
    return await db.room_follows.count_documents({"room_id": room_id})


async def _room_member_count(db, room_id: str) -> int:
    return await db.room_members.count_documents({"room_id": room_id})


@api.post("/rooms/{room_id}/follow")
async def _room_follow(room_id: str, user=Depends(current_user)):
    """Idempotent follow — persists across sessions."""
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    my_id = str(user["_id"])
    # Insert-if-absent to guarantee at-most-one follow row per (user, room).
    existed = await db.room_follows.find_one({"user_id": my_id, "room_id": room_id})
    if not existed:
        await db.room_follows.insert_one({
            "user_id": my_id,
            "room_id": room_id,
            "created_at": now_utc(),
        })
    count = await _room_follow_count(db, room_id)
    await db.rooms.update_one({"_id": room["_id"]}, {"$set": {"follow_count": count}})
    return {"ok": True, "following": True, "follow_count": count}


@api.delete("/rooms/{room_id}/follow")
async def _room_unfollow(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    my_id = str(user["_id"])
    await db.room_follows.delete_one({"user_id": my_id, "room_id": room_id})
    count = await _room_follow_count(db, room_id)
    await db.rooms.update_one({"_id": room["_id"]}, {"$set": {"follow_count": count}})
    return {"ok": True, "following": False, "follow_count": count}


@api.get("/rooms/{room_id}/follow-status")
async def _room_follow_status(room_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    is_following = bool(await db.room_follows.find_one({"user_id": my_id, "room_id": room_id}))
    is_member = bool(await db.room_members.find_one({"user_id": my_id, "room_id": room_id}))
    pending = await db.room_membership_requests.find_one({
        "user_id": my_id, "room_id": room_id, "status": "pending",
    })
    return {
        "is_following": is_following,
        "is_member": is_member,
        "has_pending_request": bool(pending),
        "follow_count": await _room_follow_count(db, room_id),
        "member_count": await _room_member_count(db, room_id),
    }


@api.post("/rooms/{room_id}/membership/request")
async def _room_membership_request(room_id: str, user=Depends(current_user)):
    """User applies for membership. Must be following the room first."""
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    my_id = str(user["_id"])
    # Must be following
    if not await db.room_follows.find_one({"user_id": my_id, "room_id": room_id}):
        raise HTTPException(400, "Follow the room before requesting membership")
    # No duplicate pending request
    if await db.room_membership_requests.find_one({
        "user_id": my_id, "room_id": room_id, "status": "pending",
    }):
        raise HTTPException(409, "Membership request already pending")
    # Already a member?
    if await db.room_members.find_one({"user_id": my_id, "room_id": room_id}):
        raise HTTPException(409, "You are already a member")
    doc = {
        "user_id": my_id,
        "room_id": room_id,
        "status": "pending",
        "created_at": now_utc(),
        "reviewed_at": None,
        "reviewed_by": None,
        "user_snapshot": {
            "nickname": user.get("nickname"),
            "avatar_url": user.get("avatar_url"),
            "numeric_id": user.get("numeric_id"),
        },
    }
    r = await db.room_membership_requests.insert_one(doc)
    doc["_id"] = r.inserted_id
    return {"ok": True, "request_id": str(r.inserted_id), "status": "pending"}


@api.get("/rooms/{room_id}/membership/pending")
async def _room_membership_pending(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can list pending requests")
    out = []
    cur = db.room_membership_requests.find(
        {"room_id": room_id, "status": "pending"}
    ).sort("created_at", -1).limit(200)
    async for d in cur:
        out.append({
            "id": str(d["_id"]),
            "user_id": d["user_id"],
            "user": d.get("user_snapshot"),
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
        })
    return out


@api.post("/rooms/{room_id}/membership/review")
async def _room_membership_review(room_id: str, body: _MembershipReviewIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if str(user["_id"]) != room.get("owner_id"):
        raise HTTPException(403, "Only the room owner can approve/reject membership")
    try:
        req_oid = ObjectId(body.request_id)
    except Exception:
        raise HTTPException(400, "Invalid request id")
    req = await db.room_membership_requests.find_one({"_id": req_oid, "room_id": room_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, "Request already reviewed")
    new_status = "approved" if body.action == "approve" else "rejected"
    await db.room_membership_requests.update_one(
        {"_id": req_oid},
        {"$set": {
            "status": new_status,
            "reviewed_at": now_utc(),
            "reviewed_by": str(user["_id"]),
        }},
    )
    if new_status == "approved":
        # Add a members row if none exists yet
        already = await db.room_members.find_one({"user_id": req["user_id"], "room_id": room_id})
        if not already:
            await db.room_members.insert_one({
                "user_id": req["user_id"],
                "room_id": room_id,
                "created_at": now_utc(),
                "approved_by": str(user["_id"]),
                "user_snapshot": req.get("user_snapshot"),
            })
            new_count = await _room_member_count(db, room_id)
            await db.rooms.update_one({"_id": room["_id"]}, {"$set": {"member_count": new_count}})
    return {"ok": True, "status": new_status}


@api.get("/rooms/{room_id}/members")
async def _room_members_list(room_id: str, user=Depends(current_user)):
    db = app.state.db
    out = []
    cur = db.room_members.find({"room_id": room_id}).sort("created_at", -1).limit(500)
    async for d in cur:
        out.append({
            "user_id": d["user_id"],
            "user": d.get("user_snapshot"),
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
        })
    return out


@api.get("/rooms/{room_id}/moderators")
async def _room_moderators_list(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    mod_ids = list(room.get("moderators") or [])
    if not mod_ids:
        return []
    users = await db.users.find({"_id": {"$in": [ObjectId(x) for x in mod_ids if _is_valid_oid(x)]}}).to_list(200)
    return [{
        "user_id": str(u["_id"]),
        "nickname": u.get("nickname"),
        "avatar_url": u.get("avatar_url"),
        "numeric_id": u.get("numeric_id"),
    } for u in users]


def _is_valid_oid(s: str) -> bool:
    try:
        ObjectId(s)
        return True
    except Exception:
        return False


class _ChatMuteIn(BaseModel):
    user_id: str
    muted: bool


class _ChatLockIn(BaseModel):
    locked: bool


async def _assert_room_priv(room: dict, uid: str):
    if uid != room.get("owner_id") and uid not in (room.get("moderators") or []):
        raise HTTPException(403, "Only the room owner or moderators can do this")


@api.post("/rooms/{room_id}/chat-mute")
async def _room_chat_mute(room_id: str, body: _ChatMuteIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    me = str(user["_id"])
    await _assert_room_priv(room, me)
    if body.user_id == room.get("owner_id") or body.user_id == me:
        raise HTTPException(400, "Cannot mute this user")
    if me != room.get("owner_id") and body.user_id in (room.get("moderators") or []):
        raise HTTPException(403, "Moderators cannot mute other moderators")
    op = {"$addToSet": {"chat_muted_users": body.user_id}} if body.muted else {"$pull": {"chat_muted_users": body.user_id}}
    await db.rooms.update_one({"_id": room["_id"]}, op)
    await _broadcast_room_state(room_id)
    return {"ok": True, "muted": body.muted}


@api.post("/rooms/{room_id}/chat-lock")
async def _room_chat_lock(room_id: str, body: _ChatLockIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    await _assert_room_priv(room, str(user["_id"]))
    await db.rooms.update_one({"_id": room["_id"]}, {"$set": {"chat_locked": body.locked}})
    await _broadcast_room_state(room_id)
    return {"ok": True, "locked": body.locked}


def _norm_reasons(payload, fallback: str) -> list:
    rs = [r.strip().lower()[:48] for r in (payload.reasons or []) if isinstance(r, str) and r.strip()]
    rs = list(dict.fromkeys(r for r in rs if r in _ALLOWED_REPORT_REASONS))
    if len(rs) > 3:
        raise HTTPException(400, "Select up to 3 reasons")
    return rs or [fallback]


@api.post("/posts/{post_id}/report", status_code=201)
async def _report_post(post_id: str, payload: ReportUserIn, user=Depends(current_user)):
    """Post / comment report → moderation review queue (1–3 reasons)."""
    db = app.state.db
    p = await _get_visible_post(db, post_id, str(user["_id"]))
    return await _store_content_report(db, user, payload, "post", {"post_id": post_id, "reported_id": p.get("author_id")})


@api.post("/comments/{comment_id}/report", status_code=201)
async def _report_comment(comment_id: str, payload: ReportUserIn, user=Depends(current_user)):
    db = app.state.db
    try:
        c = await db.post_comments.find_one({"_id": ObjectId(comment_id)})
    except Exception:
        c = None
    if not c:
        raise HTTPException(404, "Comment not found")
    return await _store_content_report(db, user, payload, "comment",
                                       {"comment_id": comment_id, "post_id": c.get("post_id"), "reported_id": c.get("author_id") or c.get("user_id") or (c.get("author") or {}).get("id")})


async def _store_content_report(db, user, payload, target_type: str, extra: dict):
    raw = (payload.reason or "other").strip().lower()[:48]
    if raw not in _ALLOWED_REPORT_REASONS:
        raw = "other"
    rs = _norm_reasons(payload, raw)
    doc = {"reporter_id": str(user["_id"]), "target_type": target_type, **extra, "reason": rs[0], "reasons": rs,
           "details": (payload.details or "")[:250], "status": "open", "created_at": now_utc()}
    r = await db.user_reports.insert_one(doc)
    return {"reported": True, "id": str(r.inserted_id)}


@api.post("/rooms/{room_id}/report", status_code=201)
async def _report_room(room_id: str, payload: ReportUserIn, user=Depends(current_user)):
    """Whole-room report → moderation review queue (never auto-bans)."""
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    raw_reason = (payload.reason or "other").strip().lower()[:48]
    if raw_reason not in _ALLOWED_REPORT_REASONS:
        raw_reason = "other"
    doc: dict = {
        "reporter_id": str(user["_id"]), "target_type": "room", "reported_room_id": room_id,
        "reported_id": room.get("owner_id"), "room_name": room.get("name"),
        "reason": raw_reason, "reasons": _norm_reasons(payload, raw_reason), "details": (payload.details or "")[:250],
        "status": "open", "created_at": now_utc(),
    }
    m_urls = [u for u in (payload.media_urls or []) if isinstance(u, str) and u]
    if m_urls:
        if payload.media_kind == "video" and len(m_urls) > 1:
            raise HTTPException(400, "Only one video allowed")
        if len(m_urls) > 3:
            raise HTTPException(400, "Up to 3 images allowed")
        for u in m_urls:
            await _assert_media_owned(db, u, str(user["_id"]))
        doc["media_kind"] = payload.media_kind or "image"
        doc["media_urls"] = m_urls
    r = await db.user_reports.insert_one(doc)
    await _sys_notify(db, str(user["_id"]), "report_received", {}, None,
                      "We received your report and will do our best to handle it. Thank you. Yazeen Team.")
    return {"reported": True, "id": str(r.inserted_id)}


@api.post("/rooms/{room_id}/moderators/add")
async def _room_moderator_add(room_id: str, body: _ModeratorIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if str(user["_id"]) != room.get("owner_id"):
        raise HTTPException(403, "Only the room owner can add moderators")
    # Target must be an approved member
    if not await db.room_members.find_one({"user_id": body.user_id, "room_id": room_id}):
        raise HTTPException(400, "User must be an approved member first")
    if body.user_id == room.get("owner_id"):
        raise HTTPException(400, "Owner is already the highest role")
    await db.rooms.update_one({"_id": room["_id"]}, {"$addToSet": {"moderators": body.user_id}})
    return {"ok": True}


@api.post("/rooms/{room_id}/moderators/remove")
async def _room_moderator_remove(room_id: str, body: _ModeratorIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if str(user["_id"]) != room.get("owner_id"):
        raise HTTPException(403, "Only the room owner can remove moderators")
    await db.rooms.update_one({"_id": room["_id"]}, {"$pull": {"moderators": body.user_id}})
    return {"ok": True}


@api.get("/rooms/{room_id}/bans")
async def _room_bans_list(room_id: str, user=Depends(current_user)):
    db = app.state.db
    out = []
    cur = db.room_bans.find({"room_id": room_id}).sort("created_at", -1).limit(500)
    async for d in cur:
        out.append({
            "user_id": d["user_id"],
            "user": d.get("user_snapshot"),
            "reason": d.get("reason"),
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
        })
    return out


@api.post("/rooms/{room_id}/bans/add")
async def _room_ban_add(room_id: str, body: _BanIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can ban users")
    if body.user_id == room.get("owner_id"):
        raise HTTPException(400, "Cannot ban the owner")
    try:
        target = await db.users.find_one({"_id": ObjectId(body.user_id)})
    except Exception:
        raise HTTPException(404, "User not found")
    if not target:
        raise HTTPException(404, "User not found")
    existed = await db.room_bans.find_one({"user_id": body.user_id, "room_id": room_id})
    if existed:
        return {"ok": True, "already": True}
    await db.room_bans.insert_one({
        "user_id": body.user_id,
        "room_id": room_id,
        "reason": body.reason,
        "created_at": now_utc(),
        "created_by": str(user["_id"]),
        "user_snapshot": {
            "nickname": target.get("nickname"),
            "avatar_url": target.get("avatar_url"),
            "numeric_id": target.get("numeric_id"),
        },
    })
    # Iter-98 — persisted system notification for the kicked/banned user.
    await _notify_room_kick(db, body.user_id, user, room)
    return {"ok": True}


@api.post("/rooms/{room_id}/bans/remove")
async def _room_ban_remove(room_id: str, body: _ModeratorIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can unban users")
    await db.room_bans.delete_one({"user_id": body.user_id, "room_id": room_id})
    return {"ok": True}



# ---------- PK Challenge (minimal 1v1 score battle between two seats) ----------
class _PkStartIn(BaseModel):
    seat_a: int = Field(ge=0, le=25)
    seat_b: int = Field(ge=0, le=25)
    duration_seconds: int = Field(default=180, ge=30, le=1800)


def _pk_public(pk: dict) -> dict:
    return {
        "id": str(pk["_id"]),
        "room_id": pk.get("room_id"),
        "seat_a": pk.get("seat_a"),
        "seat_b": pk.get("seat_b"),
        "user_a": pk.get("user_a"),
        "user_b": pk.get("user_b"),
        "score_a": int(pk.get("score_a", 0)),
        "score_b": int(pk.get("score_b", 0)),
        "status": pk.get("status", "pending"),
        "winner": pk.get("winner"),
        "started_at": pk["started_at"].isoformat() if isinstance(pk.get("started_at"), datetime) else pk.get("started_at"),
        "ends_at": pk["ends_at"].isoformat() if isinstance(pk.get("ends_at"), datetime) else pk.get("ends_at"),
        "ended_at": pk["ended_at"].isoformat() if isinstance(pk.get("ended_at"), datetime) else pk.get("ended_at"),
    }


@api.post("/rooms/{room_id}/pk/start")
async def _pk_start(room_id: str, body: _PkStartIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can start PK")
    seats = room.get("seats") or []
    if body.seat_a == body.seat_b:
        raise HTTPException(400, "seat_a and seat_b must differ")
    for i in (body.seat_a, body.seat_b):
        if i < 0 or i >= len(seats) or not seats[i].get("user"):
            raise HTTPException(400, "Both seats must be occupied")
    # Only one active PK per room
    active = await db.pk_matches.find_one({"room_id": room_id, "status": "active"})
    if active:
        raise HTTPException(409, "A PK is already active in this room")
    now = now_utc()
    ends = now + timedelta(seconds=body.duration_seconds)
    doc = {
        "room_id": room_id,
        "seat_a": body.seat_a,
        "seat_b": body.seat_b,
        "user_a": {"id": seats[body.seat_a]["user"]["id"], "nickname": seats[body.seat_a]["user"].get("nickname")},
        "user_b": {"id": seats[body.seat_b]["user"]["id"], "nickname": seats[body.seat_b]["user"].get("nickname")},
        "score_a": 0,
        "score_b": 0,
        "status": "active",
        "winner": None,
        "started_at": now,
        "ends_at": ends,
        "ended_at": None,
    }
    r = await db.pk_matches.insert_one(doc)
    doc["_id"] = r.inserted_id
    try:
        await _hub.broadcast(room_id, {"type": "pk_start", "pk": _pk_public(doc)})
    except Exception:
        pass
    return _pk_public(doc)


@api.get("/rooms/{room_id}/pk")
async def _pk_state(room_id: str, user=Depends(current_user)):
    db = app.state.db
    active = await db.pk_matches.find_one({"room_id": room_id, "status": "active"})
    return _pk_public(active) if active else {"active": False}


@api.post("/rooms/{room_id}/pk/end")
async def _pk_end(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can end PK")
    active = await db.pk_matches.find_one_and_update(
        {"room_id": room_id, "status": "active"},
        {"$set": {"status": "ended", "ended_at": now_utc()}},
        return_document=True,
    )
    if not active:
        raise HTTPException(404, "No active PK")
    active["winner"] = (
        "a" if active["score_a"] > active["score_b"]
        else "b" if active["score_b"] > active["score_a"]
        else "tie"
    )
    await db.pk_matches.update_one({"_id": active["_id"]}, {"$set": {"winner": active["winner"]}})
    try:
        await _hub.broadcast(room_id, {"type": "pk_end", "pk": _pk_public(active)})
    except Exception:
        pass
    return _pk_public(active)




# ---------- Room Layout / Settings / Close / Clear Chat ----------
ALLOWED_LAYOUTS = {8, 15, 20}


async def _get_room_or_404(db, room_id: str) -> dict:
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    r = await db.rooms.find_one({"_id": oid})
    if not r:
        raise HTTPException(404, "Room not found")
    return r


def _is_owner_or_mod(room: dict, user_id: str) -> bool:
    if room.get("owner_id") == user_id:
        return True
    return user_id in (room.get("moderators") or [])


class _RoomLayoutIn(BaseModel):
    num_seats: int


@api.patch("/rooms/{room_id}/layout")
async def _room_change_layout(room_id: str, body: _RoomLayoutIn, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    my_id = str(user["_id"])
    if not _is_owner_or_mod(room, my_id):
        raise HTTPException(403, "Only owner or moderator can change layout")
    if body.num_seats not in ALLOWED_LAYOUTS:
        raise HTTPException(400, f"Layout must be one of {sorted(ALLOWED_LAYOUTS)}")
    old_seats = room.get("seats") or []
    new_n = body.num_seats
    # Total slots = 1 host chair + new_n numbered mic seats
    total_slots = new_n + 1
    # Preserve users on seats we still have, drop any beyond new capacity
    new_seats: list[dict] = []
    for i in range(total_slots):
        if i < len(old_seats):
            s = old_seats[i]
            new_seats.append({
                "index": i,
                "user": s.get("user"),
                "muted": bool(s.get("muted", False)),
                "locked": bool(s.get("locked", False)),
            })
        else:
            new_seats.append({"index": i, "user": None, "muted": False, "locked": False})
    await db.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$set": {"num_seats": new_n, "seats": new_seats}},
    )
    await _broadcast_room_state(room_id)
    try:
        await _hub.broadcast(room_id, {
            "type": "system",
            "kind": "layout_changed",
            "num_seats": new_n,
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    r2 = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"password_hash": 0})
    return public_room(r2)


@api.post("/rooms/{room_id}/close")
async def _room_close(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can close the room")
    await db.rooms.update_one(
        {"_id": ObjectId(room_id)},
        {"$set": {"is_live": False, "closed_at": now_utc(), "listeners_count": 0}},
    )
    # Best-effort: clear chat history so a re-created room starts fresh
    try:
        await db.room_chat.delete_many({"room_id": room_id})
    except Exception:
        pass
    try:
        await _hub.broadcast(room_id, {
            "type": "room_closed",
            "by": {
                "id": str(user["_id"]),
                "nickname": user.get("nickname"),
            },
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    return {"ok": True}


@api.post("/rooms/{room_id}/chat/clear")
async def _room_chat_clear(room_id: str, user=Depends(current_user)):
    db = app.state.db
    room = await _get_room_or_404(db, room_id)
    if not _is_owner_or_mod(room, str(user["_id"])):
        raise HTTPException(403, "Only owner or moderator can clear chat")
    await db.room_chat.delete_many({"room_id": room_id})
    try:
        await _hub.broadcast(room_id, {
            "type": "chat_cleared",
            "by": {"id": str(user["_id"]), "nickname": user.get("nickname")},
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass
    return {"ok": True}


# ---------- Room Chat REST fallback ----------
@api.get("/rooms/{room_id}/chat")
async def _room_chat_history(room_id: str, user=Depends(current_user)):
    db = app.state.db
    _cut = _entry_cutoff(await _room_entry(db, room_id, str(user["_id"])))
    cur = db.room_chat.find({"room_id": room_id, "created_at": {"$gte": _cut}}, {"_id": 0}).sort("created_at", -1).limit(50)
    rows = await cur.to_list(50)
    rows.reverse()
    ids = list({r["user_id"] for r in rows})
    lookup: dict = {}
    for uid in ids:
        try:
            u = await db.users.find_one({"_id": ObjectId(uid)})
            if u:
                lookup[uid] = {
                    "id": uid,
                    "nickname": u.get("nickname"),
                    "avatar_url": u.get("avatar_url"),
                    "vip_level": u.get("vip_level", 0),
                }
        except Exception:
            continue
    for r in rows:
        r["user"] = lookup.get(r["user_id"])
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return rows


# ---------- Post Comments ----------
class _PostCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    parent_id: Optional[str] = None  # Batch B — replies


@api.get("/posts/{post_id}/comments")
async def _list_comments(post_id: str, user=Depends(current_user)):
    db = app.state.db
    cur = db.post_comments.find({"post_id": post_id}).sort("created_at", 1).limit(300)
    rows = await cur.to_list(300)
    # Batch B — live author identity (VIP color / age / wealth / charm / deleted).
    ids = list({(r.get("author") or {}).get("id") for r in rows if (r.get("author") or {}).get("id")})
    live: dict = {}
    try:
        async for u in db.users.find({"_id": {"$in": [ObjectId(i) for i in ids]}},
                                     {"nickname": 1, "avatar_url": 1, "vip_level": 1, "age": 1, "gender": 1,
                                      "wealth_level": 1, "charm_level": 1, "account_deleted": 1, "country_flag": 1}):
            live[str(u["_id"])] = u
    except Exception:
        pass
    for r in rows:
        r["id"] = str(r.pop("_id"))
        a = r.get("author") or {}
        u = live.get(a.get("id"))
        if u:
            _vl = int(u.get("vip_level", 0) or 0)
            r["author"] = {**a, "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"), "vip_level": _vl,
                           "name_color": _vip_name_color(_vl), "age": u.get("age"), "gender": u.get("gender"),
                           "wealth_level": int(u.get("wealth_level", 0) or 0), "charm_level": int(u.get("charm_level", 0) or 0),
                           "country_flag": u.get("country_flag"), "is_deleted": bool(u.get("account_deleted"))}
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return rows


@api.post("/posts/{post_id}/comments", status_code=201)
async def _add_comment(post_id: str, body: _PostCommentIn, user=Depends(current_user)):
    _guard_text(getattr(body, 'text', None))
    db = app.state.db
    try:
        pid = ObjectId(post_id)
    except Exception:
        raise HTTPException(404, "Post not found")
    post = await db.posts.find_one({"_id": pid})
    if not post:
        raise HTTPException(404, "Post not found")
    doc = {
        "post_id": post_id,
        "author": {
            "id": str(user["_id"]),
            "nickname": user.get("nickname"),
            "avatar_url": user.get("avatar_url"),
            "vip_level": user.get("vip_level", 0),
        },
        "text": body.text,
        "created_at": now_utc(),
    }
    if body.parent_id:
        try:
            _par = await db.post_comments.find_one({"_id": ObjectId(body.parent_id), "post_id": post_id}, {"parent_id": 1, "author": 1})
        except Exception:
            _par = None
        if not _par:
            raise HTTPException(404, "Comment not found")
        # One reply level: replies to a reply attach to the top-level comment.
        doc["parent_id"] = _par.get("parent_id") or body.parent_id
        doc["reply_to"] = {"id": (_par.get("author") or {}).get("id"), "nickname": (_par.get("author") or {}).get("nickname")}
    r_ins = await db.post_comments.insert_one(doc)
    await db.posts.update_one({"_id": pid}, {"$inc": {"comments_count": 1}})
    doc.pop("_id", None)
    doc["id"] = str(r_ins.inserted_id)
    doc["created_at"] = doc["created_at"].isoformat()
    return doc


# ================================================================
# ---------- Room Levels, Mic Requests, Background Moderation ----
# ================================================================
ROOM_LEVEL_THRESHOLDS = [0, 10_000_000, 40_000_000, 100_000_000, 350_000_000]  # LV1..LV5

def _room_level_from_spent(spent: int) -> dict:
    lv = 1
    for i, thr in enumerate(ROOM_LEVEL_THRESHOLDS):
        if spent >= thr:
            lv = i + 1
    # progress towards next
    if lv >= 5:
        return {"level": 5, "spent": spent, "current": ROOM_LEVEL_THRESHOLDS[4], "next": None, "remaining": 0, "progress": 1.0}
    current = ROOM_LEVEL_THRESHOLDS[lv - 1]
    nxt = ROOM_LEVEL_THRESHOLDS[lv]
    denom = max(1, nxt - current)
    progress = min(1.0, max(0.0, (spent - current) / denom))
    return {"level": lv, "spent": spent, "current": current, "next": nxt, "remaining": nxt - spent, "progress": progress}


@api.get("/rooms/{room_id}/level")
async def _room_level(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    if not room:
        raise HTTPException(404, "Room not found")
    spent = int(room.get("total_diamond_spent", 0))
    info = _room_level_from_spent(spent)
    # fan/support count = unique contributors on gift_transactions in this room
    supporters = await db.gift_transactions.distinct("sender_id", {"room_id": room_id})
    info["supporters"] = len(supporters)
    return info


# Mic request queue (each room maintains a small queue)
class _MicRequestIn(BaseModel):
    action: Literal["request", "cancel", "accept", "reject", "remove"]
    user_id: Optional[str] = None
    seat_index: Optional[int] = Field(default=None, ge=0, le=14)


@api.get("/rooms/{room_id}/mic-requests")
async def _list_mic_requests(room_id: str, user=Depends(current_user)):
    db = app.state.db
    rows = await db.mic_requests.find({"room_id": room_id, "status": "pending"}, {"_id": 0}).sort("created_at", 1).to_list(100)
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return rows


@api.post("/rooms/{room_id}/mic-requests")
async def _mic_request(room_id: str, body: _MicRequestIn, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    my_id = str(user["_id"])
    is_owner = room.get("owner_id") == my_id
    is_mod = my_id in (room.get("moderators") or [])
    now_t = now_utc()

    if body.action == "request":
        # user asks for mic
        existing = await db.mic_requests.find_one({"room_id": room_id, "user_id": my_id, "status": "pending"})
        if existing:
            return {"ok": True, "already": True}
        doc = {
            "room_id": room_id,
            "user_id": my_id,
            "user": {
                "id": my_id,
                "nickname": user.get("nickname"),
                "avatar_url": user.get("avatar_url"),
                "vip_level": user.get("vip_level", 0),
                "country_flag": user.get("country_flag"),
            },
            "status": "pending",
            "created_at": now_t,
        }
        await db.mic_requests.insert_one(doc)
        await _hub.broadcast(room_id, {"type": "mic_request", "user": doc["user"]})
        return {"ok": True}
    if body.action == "cancel":
        await db.mic_requests.update_many(
            {"room_id": room_id, "user_id": my_id, "status": "pending"},
            {"$set": {"status": "cancelled", "resolved_at": now_t}},
        )
        await _hub.broadcast(room_id, {"type": "mic_request_cancelled", "user_id": my_id})
        return {"ok": True}
    # accept/reject/remove require mod
    if not (is_owner or is_mod):
        raise HTTPException(403, "Only owner or moderator")
    if body.action in ("accept", "reject") and not body.user_id:
        raise HTTPException(400, "user_id required")
    if body.action == "accept":
        req = await db.mic_requests.find_one_and_update(
            {"room_id": room_id, "user_id": body.user_id, "status": "pending"},
            {"$set": {"status": "accepted", "resolved_at": now_t}},
        )
        if not req:
            raise HTTPException(404, "Request not found")
        # Place onto first available unlocked seat
        seats = room.get("seats", [])
        target_idx = body.seat_index
        if target_idx is None:
            target_idx = next((s["index"] for s in seats if not s.get("locked") and not s.get("user")), None)
        if target_idx is None:
            raise HTTPException(409, "No available seat")
        seat_user = req["user"]
        await db.rooms.update_one(
            {"_id": oid, "seats.user.id": body.user_id},
            {"$set": {"seats.$.user": None, "seats.$.muted": False}},
        )
        await db.rooms.update_one(
            {"_id": oid},
            {"$set": {f"seats.{target_idx}.user": seat_user, f"seats.{target_idx}.muted": False}},
        )
        await _broadcast_room_state(room_id)
        await _hub.broadcast(room_id, {"type": "mic_request_accepted", "user_id": body.user_id, "seat_index": target_idx})
        return {"ok": True, "seat_index": target_idx}
    if body.action == "reject":
        r2 = await db.mic_requests.find_one_and_update(
            {"room_id": room_id, "user_id": body.user_id, "status": "pending"},
            {"$set": {"status": "rejected", "resolved_at": now_t}},
        )
        if not r2:
            raise HTTPException(404, "Request not found")
        await _hub.broadcast(room_id, {"type": "mic_request_rejected", "user_id": body.user_id})
        return {"ok": True}
    if body.action == "remove":
        if body.seat_index is None:
            raise HTTPException(400, "seat_index required")
        # remove user from seat
        seats = room.get("seats", [])
        if body.seat_index < 0 or body.seat_index >= len(seats):
            raise HTTPException(400, "Invalid seat")
        seat_user_id = (seats[body.seat_index].get("user") or {}).get("id")
        if seat_user_id == room["owner_id"]:
            raise HTTPException(403, "Cannot remove the owner")
        await db.rooms.update_one({"_id": oid}, {"$set": {f"seats.{body.seat_index}.user": None, f"seats.{body.seat_index}.muted": False}})
        await _broadcast_room_state(room_id)
        return {"ok": True}


# Custom room background moderation workflow
# Iter-74 — Price raised to 50,000 Diamonds and NSFW rejection is enforced
# at submission time (not just at admin review) so inappropriate images
# never get stored or displayed, even transiently.
ROOM_BACKGROUND_COST = 50000  # Diamonds

# Iter-73 — Ready-made premium backgrounds for the Room Tools "الخلفية"
# selector. These are curated royalty-free Unsplash URLs chosen to cover
# the user-requested themes: luxury cars, lions, tigers, falcons, flowers,
# houses, abstract luxury, and other popular stylish backdrops. The owner
# can apply one instantly without the custom-upload moderation workflow
# because every URL in this list is already vetted content.
PREMIUM_ROOM_BACKGROUNDS: list[dict] = [
    # --- ORIO branded defaults ---
    # Iter-82 — Dedicated ORIO Welcome bg that every brand-new room ships
    # with. The owner can later swap it from Room Tools → الخلفية.
    {"id": "orio_welcome",    "title_en": "Yazeen Welcome",     "title_ar": "خلفية يازين الترحيبية",   "category": "orio",    "image_url": "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&q=85"},
    {"id": "orio_default",    "title_en": "Yazeen Default",     "title_ar": "خلفية يازين الافتراضية",  "category": "orio",    "image_url": "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&q=85"},
    # --- Luxury Cars ---
    {"id": "car_lamborghini", "title_en": "Lamborghini",      "title_ar": "لامبورغيني",  "category": "cars",    "image_url": "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1200&q=80"},
    {"id": "car_ferrari",     "title_en": "Ferrari",          "title_ar": "فيراري",      "category": "cars",    "image_url": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80"},
    {"id": "car_bugatti",     "title_en": "Bugatti",          "title_ar": "بوغاتي",      "category": "cars",    "image_url": "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&q=80"},
    {"id": "car_rollsroyce",  "title_en": "Rolls-Royce",      "title_ar": "رولز رويس",   "category": "cars",    "image_url": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=1200&q=80"},
    # --- Wild Cats & Birds ---
    {"id": "lion_king",       "title_en": "Lion King",        "title_ar": "الأسد الملك",  "category": "animals", "image_url": "https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=1200&q=80"},
    {"id": "lion_golden",     "title_en": "Golden Lion",      "title_ar": "أسد ذهبي",     "category": "animals", "image_url": "https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?w=1200&q=80"},
    {"id": "tiger_royal",     "title_en": "Royal Tiger",      "title_ar": "النمر الملكي", "category": "animals", "image_url": "https://images.unsplash.com/photo-1561731216-c3a4d99437d5?w=1200&q=80"},
    {"id": "tiger_night",     "title_en": "Night Tiger",      "title_ar": "نمر الليل",    "category": "animals", "image_url": "https://images.unsplash.com/photo-1615963244664-5b845b2025ee?w=1200&q=80"},
    {"id": "falcon_desert",   "title_en": "Desert Falcon",    "title_ar": "صقر الصحراء",  "category": "animals", "image_url": "https://images.unsplash.com/photo-1551085254-e96b210db58a?w=1200&q=80"},
    {"id": "falcon_flight",   "title_en": "Falcon in Flight", "title_ar": "صقر محلّق",    "category": "animals", "image_url": "https://images.unsplash.com/photo-1551717743-49959800b1f6?w=1200&q=80"},
    # --- Flowers ---
    {"id": "flower_roses",    "title_en": "Red Roses",        "title_ar": "ورود حمراء",   "category": "flowers", "image_url": "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=1200&q=80"},
    {"id": "flower_sakura",   "title_en": "Sakura",           "title_ar": "أزهار الكرز",  "category": "flowers", "image_url": "https://images.unsplash.com/photo-1522383225653-ed111181a951?w=1200&q=80"},
    {"id": "flower_lavender", "title_en": "Lavender Field",   "title_ar": "حقل الخزامى",  "category": "flowers", "image_url": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=1200&q=80"},
    # --- Houses / Architecture ---
    {"id": "house_mansion",   "title_en": "Luxury Mansion",   "title_ar": "قصر فاخر",     "category": "houses",  "image_url": "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80"},
    {"id": "house_villa",     "title_en": "Beach Villa",      "title_ar": "فيلا الشاطئ",  "category": "houses",  "image_url": "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&q=80"},
    {"id": "house_penthouse", "title_en": "Penthouse",        "title_ar": "بنتهاوس",      "category": "houses",  "image_url": "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80"},
    # --- Luxury / Abstract ---
    {"id": "lux_gold",        "title_en": "Gold Shards",      "title_ar": "شظايا ذهبية",  "category": "luxury",  "image_url": "https://images.unsplash.com/photo-1517999144091-3d9dca6d1e43?w=1200&q=80"},
    {"id": "lux_diamond",     "title_en": "Diamond Glow",     "title_ar": "توهج الألماس", "category": "luxury",  "image_url": "https://images.unsplash.com/photo-1551845728-6820a30c64e1?w=1200&q=80"},
    {"id": "lux_marble",      "title_en": "Black Marble",     "title_ar": "رخام أسود",    "category": "luxury",  "image_url": "https://images.unsplash.com/photo-1618828665011-0abd973f7bb8?w=1200&q=80"},
    {"id": "lux_neon",        "title_en": "Neon Nights",      "title_ar": "ليالي النيون", "category": "luxury",  "image_url": "https://images.unsplash.com/photo-1518544801976-3e188ea7fab6?w=1200&q=80"},
    # --- Space / Galaxy ---
    {"id": "space_galaxy",    "title_en": "Galaxy",           "title_ar": "المجرة",       "category": "space",   "image_url": "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?w=1200&q=80"},
    {"id": "space_nebula",    "title_en": "Nebula",           "title_ar": "سديم",         "category": "space",   "image_url": "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1200&q=80"},
    {"id": "space_aurora",    "title_en": "Aurora",           "title_ar": "الشفق القطبي", "category": "space",   "image_url": "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=1200&q=80"},
    # --- Nature extras ---
    {"id": "nature_sunset",   "title_en": "Golden Sunset",    "title_ar": "غروب ذهبي",    "category": "nature",  "image_url": "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&q=80"},
    {"id": "nature_mountain", "title_en": "Mountain Peak",    "title_ar": "قمة الجبل",    "category": "nature",  "image_url": "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80"},
]


@api.get("/rooms/backgrounds/catalog")
async def _rooms_backgrounds_catalog(user=Depends(current_user)):
    """Iter-73 — return the curated premium backgrounds catalog so every room
    owner has the same 20+ ready-made options to pick from inside Room Tools
    → "الخلفية"."""
    return {"backgrounds": PREMIUM_ROOM_BACKGROUNDS}


class _RoomBgPresetIn(BaseModel):
    bg_id: Optional[str] = None
    image_url: Optional[str] = None


@api.post("/rooms/{room_id}/background/preset")
async def _rooms_set_background_preset(room_id: str, body: _RoomBgPresetIn, user=Depends(current_user)):
    """Apply a curated premium background to the room. Owner-only.

    Accepts either `bg_id` (preferred — must match one of the catalog ids) or
    a raw `image_url` that was already in the catalog. Rejects arbitrary URLs
    so this endpoint can't be used to bypass the custom-upload moderation
    workflow at `/rooms/{id}/background`.
    """
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    if room.get("owner_id") != str(user["_id"]):
        raise HTTPException(403, "Only the room owner can change the background")
    chosen: Optional[dict] = None
    # Iter-75 — allow switching back to the owner's previously-approved custom
    # background by passing `bg_id="my_custom"`.
    if body.bg_id == "my_custom":
        cu = room.get("custom_background_url")
        if not cu:
            raise HTTPException(400, "No custom background on file")
        await db.rooms.update_one(
            {"_id": oid},
            {"$set": {"background_url": cu, "background_preset_id": "my_custom"}},
        )
        try:
            await _broadcast_room_state(room_id)
        except Exception:
            pass
        return {"ok": True, "background_url": cu, "bg_id": "my_custom"}
    if body.bg_id:
        chosen = next((b for b in PREMIUM_ROOM_BACKGROUNDS if b["id"] == body.bg_id), None)
    if chosen is None and body.image_url:
        chosen = next((b for b in PREMIUM_ROOM_BACKGROUNDS if b["image_url"] == body.image_url), None)
    if chosen is None:
        raise HTTPException(400, "Unknown background preset")
    await db.rooms.update_one(
        {"_id": oid},
        {"$set": {"background_url": chosen["image_url"], "background_preset_id": chosen["id"]}},
    )
    try:
        await _broadcast_room_state(room_id)
    except Exception:
        pass
    return {"ok": True, "background_url": chosen["image_url"], "bg_id": chosen["id"]}


class _RoomBgSubmitIn(BaseModel):
    # Iter-74 — the client sends either an http(s) URL or a `data:image/*;base64,…`
    # data URI. A 1 MB PNG becomes ~1.4 M base64 chars, so the previous
    # 800-char ceiling made real data-URI uploads impossible. The actual
    # byte-level limits are enforced by `_moderate_cover_image` and
    # `_validate_gif_limits`.
    image_url: str = Field(min_length=8, max_length=8_000_000)


def _bg_entitlement_active(ent_until) -> bool:
    """Iter-82 — safe comparison: Mongo often returns naive datetimes while
    `now_utc()` is tz-aware. Normalize both to tz-aware before comparing."""
    if not isinstance(ent_until, datetime):
        return False
    eu = ent_until if ent_until.tzinfo else ent_until.replace(tzinfo=timezone.utc)
    return eu > now_utc()


@api.post("/rooms/{room_id}/background", status_code=201)
async def _submit_room_background(room_id: str, body: _RoomBgSubmitIn, user=Depends(current_user)):
    """Iter-82 — Owner uploads a custom background for moderation (within 24h).

    Access rules:
      - VIP6+ owners  → unlimited uploads, no diamond cost.
      - 15-day pass   → unlimited uploads while entitlement is active, no cost
                        (pass is bought separately via /purchase-15d for 50 000 diamonds).
      - Everyone else → 403; must buy the 15-day pass or upgrade to VIP6+.
    """
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    my_id = str(user["_id"])
    if room.get("owner_id") != my_id:
        raise HTTPException(403, "Only the room owner can submit a background")
    # Entitlement check — server-side authoritative.
    vip_level = int(user.get("vip_level") or 0)
    ent_until = user.get("custom_bg_entitlement_until")
    ent_active = _bg_entitlement_active(ent_until)
    if vip_level < 6 and not ent_active:
        raise HTTPException(403, "CUSTOM_BG_ENTITLEMENT_REQUIRED")
    # NSFW / corrupt image → rejected IMMEDIATELY (no persist, no state change).
    verdict = await _moderate_cover_image(body.image_url)
    if not verdict.get("ok"):
        reason = verdict.get("reason") or "inappropriate"
        try:
            await _apply_user_media_block(db, my_id, reason)
        except Exception:
            pass
        raise HTTPException(400, f"Image rejected: {reason}")
    sub_id = secrets.token_hex(10)
    doc = {
        "sub_id": sub_id,
        "room_id": room_id,
        "owner_id": my_id,
        "image_url": body.image_url,
        "status": "pending",
        "created_at": now_utc(),
        # Record the access path used — helpful for audit / refunds.
        "access_mode": "vip6" if vip_level >= 6 else "pass_15d",
    }
    await db.room_backgrounds.insert_one(doc)
    return {"ok": True, "sub_id": sub_id, "status": "pending", "message": "Image will be reviewed within 24 hours"}


# Iter-82 — 15-day custom background pass purchase. Flat 50 000 Diamonds.
CUSTOM_BG_PASS_COST = 50000
CUSTOM_BG_PASS_DAYS = 15


@api.post("/rooms/custom-background/purchase-15d")
async def _purchase_custom_bg_pass(user=Depends(current_user)):
    """Deduct 50 000 Diamonds and grant a 15-day custom-background entitlement.

    - Server-authoritative balance check (atomic deduction).
    - If the user already has an active pass, the new 15 days are added on
      top of the remaining time (never reduces an existing window).
    """
    db = app.state.db
    u = await db.users.find_one({"_id": user["_id"]}, {"diamonds": 1, "custom_bg_entitlement_until": 1, "vip_level": 1})
    if not u:
        raise HTTPException(404, "User not found")
    if int(u.get("vip_level") or 0) >= 6:
        # VIP6+ already enjoys unlimited custom backgrounds for free; no sale.
        raise HTTPException(409, "VIP6_UNLIMITED_ALREADY")
    # Atomic deduction.
    deducted = await db.users.find_one_and_update(
        {"_id": user["_id"], "diamonds": {"$gte": CUSTOM_BG_PASS_COST}},
        {"$inc": {"diamonds": -CUSTOM_BG_PASS_COST}},
        return_document=True,
    )
    if not deducted:
        raise HTTPException(402, "Insufficient diamonds")
    # Extend window: if already active, add to the remaining time; else start now.
    cur = u.get("custom_bg_entitlement_until")
    base = cur if _bg_entitlement_active(cur) else now_utc()
    if isinstance(base, datetime) and base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    new_until = base + timedelta(days=CUSTOM_BG_PASS_DAYS)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"custom_bg_entitlement_until": new_until}})
    # Ledger entry.
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]), "type": "custom_bg_pass_15d", "currency": "diamonds",
        "amount": -CUSTOM_BG_PASS_COST, "reference_id": None,
        "description": "Custom background 15-day pass",
        "status": "completed", "created_at": now_utc(),
    })
    return {
        "ok": True,
        "entitlement_until": new_until.isoformat(),
        "diamonds_remaining": int(deducted.get("diamonds", 0)),
        "days": CUSTOM_BG_PASS_DAYS,
    }


@api.get("/rooms/custom-background/entitlement")
async def _get_custom_bg_entitlement(user=Depends(current_user)):
    """Returns the current user's custom-background access status."""
    vip_level = int(user.get("vip_level") or 0)
    ent_until = user.get("custom_bg_entitlement_until")
    ent_active = _bg_entitlement_active(ent_until)
    return {
        "vip_level": vip_level,
        "vip6_unlimited": vip_level >= 6,
        "pass_active": ent_active,
        "entitlement_until": ent_until.isoformat() if isinstance(ent_until, datetime) else None,
        "can_submit": vip_level >= 6 or ent_active,
        "price_diamonds": CUSTOM_BG_PASS_COST,
        "days": CUSTOM_BG_PASS_DAYS,
    }


@api.get("/rooms/{room_id}/background/status")
async def _room_bg_status(room_id: str, user=Depends(current_user)):
    db = app.state.db
    rows = await db.room_backgrounds.find({"room_id": room_id}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        if isinstance(r.get("reviewed_at"), datetime):
            r["reviewed_at"] = r["reviewed_at"].isoformat()
    return rows


class _AdminBgDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    reason: Optional[str] = None


@api.post("/admin/room-backgrounds/{sub_id}/decision")
async def _admin_room_bg_decision(sub_id: str, body: _AdminBgDecisionIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    sub = await db.room_backgrounds.find_one({"sub_id": sub_id})
    if not sub:
        raise HTTPException(404, "Submission not found")
    if sub["status"] != "pending":
        raise HTTPException(409, "Already decided")
    now_t = now_utc()
    upd = {"status": "approved" if body.decision == "approve" else "rejected", "reviewed_at": now_t, "review_reason": body.reason}
    await db.room_backgrounds.update_one({"sub_id": sub_id}, {"$set": upd})
    if body.decision == "approve":
        # Iter-74/75/82 — approved submissions set the room-specific
        # `background_url` (NOT the cover), so the backdrop applies only
        # to this room and leaves the cover image untouched. Also persist
        # it as `custom_background_url` so the owner can later switch
        # between their custom pick and any preset.
        await db.rooms.update_one(
            {"_id": ObjectId(sub["room_id"])},
            {"$set": {
                "background_url": sub["image_url"],
                "custom_background_url": sub["image_url"],
                "background_preset_id": "my_custom",
            }},
        )
        try:
            await _broadcast_room_state(sub["room_id"])
        except Exception:
            pass
    else:
        # Iter-82 — rejected submissions no longer refund diamonds here
        # because the per-submission diamond deduction has been removed
        # (users pay once via /purchase-15d for a 15-day pass). The
        # submission simply moves to `rejected` and the owner must try
        # another image within the pass window.
        pass
    return {"ok": True, "status": upd["status"]}


# ---------- Emoji Packs ----------
DEFAULT_EMOJI_PACKS = [
    {"id": "pack_orio_1", "name": "Yazeen Vibes",  "emojis": ["😀","😁","😂","🤣","😊","😍","😎","🤩","🥳","😜","🤯","🥺"]},
    {"id": "pack_orio_2", "name": "Party Time",  "emojis": ["🎉","🎊","🎁","🍾","🥂","💃","🕺","🎶","🎵","🔥","✨","🌟"]},
    {"id": "pack_orio_3", "name": "Hearts",      "emojis": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💖","💗","💓","💞"]},
    {"id": "pack_orio_4", "name": "Reactions",   "emojis": ["👍","👎","👏","🙏","💪","🤝","👌","✌️","🤞","🤟","🤘","👋"]},
    {"id": "pack_orio_5", "name": "Diamonds",    "emojis": ["💎","💰","🏆","👑","🎖️","🥇","🥈","🥉","⭐","🌈","🚀","🌠"]},
]


@api.get("/emoji-packs")
async def _list_emoji_packs(user=Depends(current_user)):
    return DEFAULT_EMOJI_PACKS


# ---------- VIP heads metadata ----------
VIP_HEADS = [
    {"level": 1, "animal": "sheep",   "emoji": "🐑", "color": "#32D74B", "label_en": "Sheep",   "label_ar": "الخروف"},
    {"level": 2, "animal": "horse",   "emoji": "🐴", "color": "#C7C7CC", "label_en": "Horse",   "label_ar": "الحصان"},
    {"level": 3, "animal": "deer",    "emoji": "🦌", "color": "#BF5AF2", "label_en": "Deer",    "label_ar": "الغزال"},
    {"level": 4, "animal": "fox",     "emoji": "🦊", "color": "#FF453A", "label_en": "Fox",     "label_ar": "الثعلب"},
    {"level": 5, "animal": "bear",    "emoji": "🐻", "color": "#A0522D", "label_en": "Bear",    "label_ar": "الدب"},
    {"level": 6, "animal": "eagle",   "emoji": "🦅", "color": "#FF9500", "label_en": "Eagle",   "label_ar": "النسر"},
    {"level": 7, "animal": "cheetah", "emoji": "🐆", "color": "#FFD700", "label_en": "Cheetah", "label_ar": "الفهد"},
]


@api.get("/vip/heads")
async def _vip_heads():
    return VIP_HEADS


# ---------- Tasks system ----------
TASK_CATALOG = [
    {"id": "enter_room",     "name_en": "Enter a room",              "name_ar": "ادخل غرفة",                  "target": 1,  "reward": 20},
    {"id": "take_mic",       "name_en": "Take a mic seat",           "name_ar": "خذ مقعد ميكروفون",           "target": 1,  "reward": 30},
    {"id": "mic_10m",        "name_en": "10 minutes on mic",         "name_ar": "10 دقائق على الميكروفون",   "target": 10, "reward": 60},
    {"id": "mic_20m",        "name_en": "20 minutes on mic",         "name_ar": "20 دقيقة على الميكروفون",   "target": 20, "reward": 120},
    {"id": "mic_30m",        "name_en": "30 minutes on mic",         "name_ar": "30 دقيقة على الميكروفون",   "target": 30, "reward": 200},
    {"id": "room_10m",       "name_en": "10 minutes in a room",      "name_ar": "10 دقائق في الغرفة",         "target": 10, "reward": 40},
    {"id": "recharge",       "name_en": "Recharge diamonds",         "name_ar": "شحن ألماس",                 "target": 1,  "reward": 100},
    {"id": "view_10_profiles","name_en": "View 10 profiles",         "name_ar": "اطلع على 10 ملفات شخصية",   "target": 10, "reward": 50},
    {"id": "post_5",         "name_en": "Publish 5 posts",           "name_ar": "انشر 5 منشورات",             "target": 5,  "reward": 80},
]


def _today_key() -> str:
    return now_utc().strftime("%Y-%m-%d")


@api.get("/tasks")
async def _list_tasks(user=Depends(current_user)):
    db = app.state.db
    day = _today_key()
    my_id = str(user["_id"])
    prog = await db.tasks_progress.find({"user_id": my_id, "day": day}, {"_id": 0}).to_list(100)
    prog_map = {p["task_id"]: p for p in prog}
    out = []
    for t in TASK_CATALOG:
        p = prog_map.get(t["id"], {})
        out.append({
            **t,
            "progress": int(p.get("progress", 0)),
            "completed": bool(p.get("completed", False)),
            "claimed": bool(p.get("claimed", False)),
        })
    return out


class _TaskProgressIn(BaseModel):
    task_id: str
    increment: int = Field(default=1, ge=1, le=60)


@api.post("/tasks/progress")
async def _task_progress(body: _TaskProgressIn, user=Depends(current_user)):
    db = app.state.db
    task = next((t for t in TASK_CATALOG if t["id"] == body.task_id), None)
    if not task:
        raise HTTPException(404, "Task not found")
    day = _today_key()
    my_id = str(user["_id"])
    r = await db.tasks_progress.find_one_and_update(
        {"user_id": my_id, "day": day, "task_id": body.task_id},
        {"$inc": {"progress": body.increment}, "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
        return_document=True,
    )
    progress = int((r or {}).get("progress", body.increment))
    completed = progress >= task["target"]
    if completed and not (r or {}).get("completed"):
        await db.tasks_progress.update_one(
            {"user_id": my_id, "day": day, "task_id": body.task_id},
            {"$set": {"completed": True, "completed_at": now_utc()}},
        )
    return {"ok": True, "progress": min(progress, task["target"]), "target": task["target"], "completed": completed}


@api.post("/tasks/{task_id}/claim")
async def _task_claim(task_id: str, user=Depends(current_user)):
    db = app.state.db
    task = next((t for t in TASK_CATALOG if t["id"] == task_id), None)
    if not task:
        raise HTTPException(404, "Task not found")
    day = _today_key()
    my_id = str(user["_id"])
    row = await db.tasks_progress.find_one({"user_id": my_id, "day": day, "task_id": task_id})
    if not row or not row.get("completed"):
        raise HTTPException(409, "Task not yet completed")
    if row.get("claimed"):
        raise HTTPException(409, "Already claimed")
    # award diamonds and mark claimed atomically
    r = await db.tasks_progress.find_one_and_update(
        {"user_id": my_id, "day": day, "task_id": task_id, "claimed": {"$ne": True}},
        {"$set": {"claimed": True, "claimed_at": now_utc()}},
    )
    if not r:
        raise HTTPException(409, "Already claimed")
    await db.users.update_one({"_id": user["_id"]}, {"$inc": {"diamonds": task["reward"]}})
    await db.wallet_transactions.insert_one({
        "user_id": my_id, "type": "task_reward", "currency": "diamonds",
        "amount": task["reward"], "reference_id": task_id,
        "description": f"Task reward: {task['name_en']}",
        "status": "completed", "created_at": now_utc(),
    })
    return {"ok": True, "reward": task["reward"]}


# ---------- VIP Progression ----------
# Iter-133 — 10 levels. TOTAL lifetime RECHARGED Diamonds (cumulative, not additive).
VIP_PROGRESSION_THRESHOLDS = [
    {"level": 1, "threshold": 5_000},
    {"level": 2, "threshold": 100_000},
    {"level": 3, "threshold": 300_000},
    {"level": 4, "threshold": 650_000},
    {"level": 5, "threshold": 2_000_000},
    {"level": 6, "threshold": 7_000_000},
    {"level": 7, "threshold": 20_000_000},
    {"level": 8, "threshold": 40_000_000},
    {"level": 9, "threshold": 60_000_000},
    {"level": 10, "threshold": 100_000_000},
]
VIP_MAX_LEVEL = 10


# ============================================================================
# Iter-36 — Global Level System Framework
# ----------------------------------------------------------------------------
# ORIO has 4 level systems:
#   - vip    → underlying points: growth_points  (permanent, never deducted)
#   - wealth → underlying points: wealth_points  (accumulates from gifts sent)
#   - charm  → underlying points: charm_points   (accumulates from gifts received)
#   - level  → underlying points: experience     (game activity)
#
# For all four systems the DISPLAY level is derived server-side from the
# preserved point balance and the current threshold configuration. Points are
# never deleted, never reduced, and never rewritten during a threshold change.
# When admins update thresholds, every user's displayed level is recomputed
# from their preserved point balance.
#
# VIP already uses the same pattern via `_load_vip_thresholds` and
# `_maybe_activate_vip` — the helpers below extend the same contract to the
# other three systems and expose a single admin migration surface.
# ============================================================================

# Sentinel systems for the generic framework (VIP is intentionally NOT in this
# list — it has its own admin surface at /admin/vip/thresholds).
LEVEL_SYSTEMS = ("wealth", "charm", "level")

# Field names on the user doc for each generic system.
_LEVEL_FIELDS: dict[str, dict] = {
    "wealth": {"points": "wealth_points", "level": "wealth_level", "max": 51},
    "charm":  {"points": "charm_points",  "level": "charm_level",  "max": 51},
    "level":  {"points": "experience",    "level": "level",        "max": 100},
}


def _default_level_thresholds(system: str) -> list[dict]:
    """Identity mapping (1 point = 1 level) up to the system max. This means
    the very first bootstrap changes NOTHING for existing users — their
    display level stays exactly where it was. Admins can push a non-linear
    curve later via the migration endpoints."""
    cap = _LEVEL_FIELDS[system]["max"]
    return [{"level": i, "points": i} for i in range(1, cap + 1)]


async def _bootstrap_level_configs(db) -> None:
    """Idempotent — writes default threshold configs if they don't exist."""
    for sys in LEVEL_SYSTEMS:
        existing = await db.level_configs.find_one({"_id": sys})
        if existing:
            continue
        await db.level_configs.insert_one({
            "_id": sys,
            "system": sys,
            "thresholds": _default_level_thresholds(sys),
            "max_level": _LEVEL_FIELDS[sys]["max"],
            "created_at": now_utc(),
            "created_by": "bootstrap",
        })


async def _load_level_thresholds(system: str) -> list[dict]:
    if system not in _LEVEL_FIELDS:
        raise HTTPException(400, f"Unknown level system: {system}")
    doc = await app.state.db.level_configs.find_one({"_id": system})
    if doc and isinstance(doc.get("thresholds"), list) and doc["thresholds"]:
        return sorted(doc["thresholds"], key=lambda x: int(x.get("level", 0)))
    return _default_level_thresholds(system)


def _compute_display_level(thresholds: list[dict], points: int, max_level: int) -> int:
    """Return the highest tier whose `points` requirement is <= supplied points.
    Capped at `max_level`. Threshold list is expected sorted ascending by level.
    """
    pts = max(0, int(points or 0))
    display = 0
    for t in thresholds:
        req = int(t.get("points", 0))
        lvl = int(t.get("level", 0))
        if pts >= req:
            display = max(display, lvl)
        else:
            break
    return min(display, int(max_level or 0))


async def _migrate_legacy_levels_to_points(db) -> None:
    """One-shot idempotent migration that copies the legacy
    `wealth_level`/`charm_level` counters into new `wealth_points`/`charm_points`
    fields WITHOUT deleting the original values. Uses a config flag so it
    runs once per migration id."""
    guard = await db.config.find_one({"_id": "level_migration_v1"})
    if guard and guard.get("done"):
        return
    # Wealth: seed wealth_points := wealth_level when wealth_points is missing.
    await db.users.update_many(
        {"wealth_points": {"$exists": False}},
        [{"$set": {"wealth_points": {"$ifNull": ["$wealth_level", 0]}}}],
    )
    # Charm: same pattern.
    await db.users.update_many(
        {"charm_points": {"$exists": False}},
        [{"$set": {"charm_points": {"$ifNull": ["$charm_level", 0]}}}],
    )
    # `level` system already uses `experience` as its raw counter — nothing
    # to seed; just ensure the field is present so aggregations don't NPE.
    await db.users.update_many(
        {"experience": {"$exists": False}},
        {"$set": {"experience": 0}},
    )
    await db.config.update_one(
        {"_id": "level_migration_v1"},
        {"$set": {"done": True, "migrated_at": now_utc()}},
        upsert=True,
    )


# ---------------------------------------------------------------------------
# Iter-115 — Official ORIO Wealth/Charm table (51 levels). Each value is the
# INDIVIDUAL requirement of that level; thresholds are stored cumulatively so
# excess points carry over automatically and multi level-ups are exact.
# ---------------------------------------------------------------------------
ORIO_LEVEL_REQUIREMENTS: list[int] = [
    1_000, 5_000, 15_000, 25_000, 50_000, 100_000, 500_000, 1_500_000, 3_000_000, 5_000_000,
    7_500_000, 10_000_000, 15_000_000, 25_000_000, 50_000_000, 100_000_000, 120_000_000,
    150_000_000, 200_000_000, 250_000_000, 300_000_000, 350_000_000, 400_000_000, 450_000_000,
    500_000_000, 550_000_000, 600_000_000, 650_000_000, 700_000_000, 750_000_000, 800_000_000,
    850_000_000, 900_000_000, 950_000_000, 1_000_000_000, 1_100_000_000, 1_200_000_000,
    1_300_000_000, 1_400_000_000, 1_500_000_000, 1_600_000_000, 1_700_000_000, 1_800_000_000,
    1_900_000_000, 2_000_000_000, 2_200_000_000, 2_400_000_000, 2_600_000_000, 2_800_000_000,
    3_100_000_000, 3_500_000_000,
]


def _orio_cumulative_thresholds() -> list[dict]:
    out, cum = [], 0
    for i, req in enumerate(ORIO_LEVEL_REQUIREMENTS, start=1):
        cum += req
        out.append({"level": i, "points": cum, "requirement": req})
    return out


async def _level_reset_v2(db) -> None:
    """ONE-TIME: back up wealth/charm progress, reset it to zero for all users
    and install the official 51-level table. Guarded by a config flag so it
    never repeats. Wallets, diamonds, gifts, transactions and VIP untouched."""
    guard = await db.config.find_one({"_id": "level_reset_v2"})
    if guard and guard.get("done"):
        return
    fields = {"wealth_points": 1, "charm_points": 1, "wealth_level": 1, "charm_level": 1}
    backup = [{"user_id": str(u["_id"]), **{k: u.get(k) for k in fields}, "backed_up_at": now_utc()}
              async for u in db.users.find({}, fields)]
    if backup:
        await db.level_reset_backup_v2.insert_many(backup)
    await db.users.update_many({}, {"$set": {"wealth_points": 0, "charm_points": 0,
                                              "wealth_level": 0, "charm_level": 0}})
    for sys in ("wealth", "charm"):
        await db.level_configs.update_one(
            {"_id": sys},
            {"$set": {"system": sys, "thresholds": _orio_cumulative_thresholds(), "max_level": 51,
                      "updated_at": now_utc(), "updated_by": "level_reset_v2"}},
            upsert=True,
        )
    await db.config.update_one({"_id": "level_reset_v2"},
                               {"$set": {"done": True, "at": now_utc(), "backed_up": len(backup)}},
                               upsert=True)


def _gift_awards_points(gift: dict) -> bool:
    """Only paid gifts award Wealth (sender) / Charm (recipient) points."""
    return int(gift.get("price") or 0) > 0 and not gift.get("is_free")


async def _supporter_total(db, user_id: str) -> int:
    """Total eligible diamonds this user spent on gifts (verified, non-reversed)."""
    rows = await db.gift_transactions.aggregate([
        {"$match": {"sender_id": user_id, "status": {"$ne": "reversed"}}},
        {"$group": {"_id": None, "t": {"$sum": {"$ifNull": ["$wealth_awarded", "$total_cost"]}}}},
    ]).to_list(1)
    return int(rows[0]["t"]) if rows else 0


class _GiftReverseIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)
    refund_coins: bool = False


@api.post("/admin/gifts/{tx_id}/reverse")
async def _admin_reverse_gift(tx_id: str, body: _GiftReverseIn, user=Depends(current_user)):
    """Safely reverse an invalid/refunded gift: removes exactly the points it
    awarded (never below 0), optionally refunds the sender, idempotent."""
    if not user.get("is_admin"):
        try:
            from admin_dashboard import resolve_admin_access as _ra
            if not await _ra(app.state.db, user):
                raise HTTPException(403, "Admins only")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(403, "Admins only")
    db = app.state.db
    tx = await db.gift_transactions.find_one_and_update(
        {"tx_id": tx_id, "status": {"$ne": "reversed"}},
        {"$set": {"status": "reversed", "reversed_at": now_utc(), "reversed_by": str(user["_id"]), "reverse_reason": body.reason}},
    )
    if not tx:
        if await db.gift_transactions.find_one({"tx_id": tx_id}):
            return {"ok": True, "already_reversed": True}
        raise HTTPException(404, "Gift transaction not found")
    w = int(tx.get("wealth_awarded", tx.get("total_cost", 0)) or 0)
    c = int(tx.get("charm_awarded", tx.get("total_cost", 0)) or 0)
    for uid, fld, amt in ((tx["sender_id"], "wealth_points", w), (tx["recipient_id"], "charm_points", c)):
        if amt > 0:
            await db.users.update_one({"_id": ObjectId(uid)},
                                      [{"$set": {fld: {"$max": [0, {"$subtract": [{"$ifNull": [f"${fld}", 0]}, amt]}]}}}])
    if body.refund_coins:
        await db.users.update_one({"_id": ObjectId(tx["sender_id"])}, {"$inc": {"coins": int(tx.get("total_cost", 0))}})
    for uid in {tx["sender_id"], tx["recipient_id"]}:
        try:
            await _recompute_user_levels(ObjectId(uid))
        except Exception:
            pass
    try:
        await _refund_ledger_tx(db, tx_id, actor_user_id=str(user["_id"]))
    except Exception:
        pass
    await _audit(db, str(user["_id"]), "gift_tx_reversed", "gift_tx", tx_id,
                 {"wealth_removed": w, "charm_removed": c, "refund_coins": body.refund_coins, "reason": body.reason})
    return {"ok": True, "wealth_removed": w, "charm_removed": c}


async def _claim_gift_request(db, user: dict, request_id: Optional[str]) -> None:
    """Idempotency: the same client request_id can only ever be processed once."""
    if not request_id:
        return
    try:
        await db.gift_requests.insert_one({"_id": f"{user['_id']}:{request_id}", "created_at": now_utc()})
    except Exception:
        raise HTTPException(409, "Duplicate gift request")


async def _release_gift_request(db, user: dict, request_id: Optional[str]) -> None:
    if request_id:
        await db.gift_requests.delete_one({"_id": f"{user['_id']}:{request_id}"})


async def _recompute_user_levels(user_oid, user_doc: Optional[dict] = None) -> dict:
    """Recompute display levels for wealth/charm/level from the user's
    preserved points and the CURRENT threshold configs. Writes the derived
    fields back to the user doc. Returns the updated set for logging.
    Points are NEVER modified here."""
    db = app.state.db
    if user_doc is None:
        user_doc = await db.users.find_one({"_id": user_oid})
        if not user_doc:
            return {}
    updates: dict = {}
    for sys in LEVEL_SYSTEMS:
        cfg = _LEVEL_FIELDS[sys]
        thresholds = await _load_level_thresholds(sys)
        pts = int(user_doc.get(cfg["points"], 0))
        new_lvl = _compute_display_level(thresholds, pts, cfg["max"])
        if int(user_doc.get(cfg["level"], 0)) != new_lvl:
            updates[cfg["level"]] = new_lvl
    if updates:
        await db.users.update_one({"_id": user_oid}, {"$set": updates})
        # Iter-117 — level-up notifications (Wealth / Charm only, increases only).
        for sys in ("wealth", "charm"):
            fld = _LEVEL_FIELDS[sys]["level"]
            if fld in updates and int(updates[fld]) > int(user_doc.get(fld, 0) or 0):
                lv = int(updates[fld])
                try:
                    await db.level_history.insert_one({
                        "user_id": str(user_oid), "system": sys, "from": int(user_doc.get(fld, 0) or 0), "to": lv,
                        "source": "gift", "reason": None, "admin_email": None, "created_at": now_utc(),
                    })
                except Exception:
                    pass
                try:
                    await _sys_notify(db, str(user_oid), "level_up", {"system": sys, "level": lv},
                                      {"type": "level", "id": sys},
                                      f"Congratulations on reaching {sys.title()} LV {lv}",
                                      dedup_key=f"lvl:{user_oid}:{sys}:{lv}")
                except Exception:
                    pass
    return updates


async def _recompute_all_users_for_system(system: str) -> int:
    """Bulk recompute the display level for `system` across all users. Idempotent."""
    db = app.state.db
    if system not in _LEVEL_FIELDS:
        raise HTTPException(400, f"Unknown level system: {system}")
    cfg = _LEVEL_FIELDS[system]
    thresholds = await _load_level_thresholds(system)
    max_lvl = cfg["max"]
    affected = 0
    async for u in db.users.find({}, {cfg["points"]: 1, cfg["level"]: 1}):
        pts = int(u.get(cfg["points"], 0))
        new_lvl = _compute_display_level(thresholds, pts, max_lvl)
        old_lvl = int(u.get(cfg["level"], 0))
        if new_lvl != old_lvl:
            await db.users.update_one({"_id": u["_id"]}, {"$set": {cfg["level"]: new_lvl}})
            affected += 1
    return affected


# ---- Admin: generic level system config & migration ------------------------

class _LevelThresholdsIn(BaseModel):
    thresholds: list[dict]
    max_level: Optional[int] = None


@api.get("/admin/levels/{system}")
async def _admin_get_levels(system: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    if system not in _LEVEL_FIELDS:
        raise HTTPException(400, "Unknown system")
    doc = await app.state.db.level_configs.find_one({"_id": system}) or {}
    return {
        "system": system,
        "thresholds": doc.get("thresholds") or _default_level_thresholds(system),
        "max_level": doc.get("max_level", _LEVEL_FIELDS[system]["max"]),
    }


def _validate_thresholds(thresholds: list[dict]) -> list[dict]:
    if not isinstance(thresholds, list) or not thresholds:
        raise HTTPException(400, "thresholds must be a non-empty list")
    rows = []
    for t in thresholds:
        try:
            rows.append({"level": int(t["level"]), "points": int(t["points"])})
        except Exception:
            raise HTTPException(400, "Each threshold requires integer level+points")
    rows.sort(key=lambda x: x["level"])
    # levels strictly increasing starting at 1; points non-decreasing.
    if rows[0]["level"] != 1:
        raise HTTPException(400, "Thresholds must start at level 1")
    for i, r in enumerate(rows):
        if r["level"] != i + 1:
            raise HTTPException(400, "Threshold levels must be consecutive")
        if r["points"] < 0:
            raise HTTPException(400, "Threshold points must be non-negative")
        if i > 0 and r["points"] < rows[i - 1]["points"]:
            raise HTTPException(400, "Threshold points must be non-decreasing")
    return rows


@api.post("/admin/levels/{system}/preview")
async def _admin_preview_levels(system: str, body: _LevelThresholdsIn, user=Depends(current_user)):
    """Dry-run: report how many users' displayed level would change, and
    include up to 25 sample rows (id/current_level/new_level/points)."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    if system not in _LEVEL_FIELDS:
        raise HTTPException(400, "Unknown system")
    cfg = _LEVEL_FIELDS[system]
    new_thresholds = _validate_thresholds(body.thresholds)
    new_max = int(body.max_level or new_thresholds[-1]["level"])
    old_doc = await app.state.db.level_configs.find_one({"_id": system}) or {}
    old_thresholds = old_doc.get("thresholds") or _default_level_thresholds(system)
    old_max = int(old_doc.get("max_level", cfg["max"]))
    affected = 0
    samples: list[dict] = []
    total = 0
    async for u in app.state.db.users.find({}, {cfg["points"]: 1, cfg["level"]: 1, "nickname": 1}):
        total += 1
        pts = int(u.get(cfg["points"], 0))
        old_lvl = _compute_display_level(old_thresholds, pts, old_max)
        new_lvl = _compute_display_level(new_thresholds, pts, new_max)
        if old_lvl != new_lvl:
            affected += 1
            if len(samples) < 25:
                samples.append({
                    "id": str(u["_id"]),
                    "nickname": u.get("nickname"),
                    "points": pts,
                    "old_level": old_lvl,
                    "new_level": new_lvl,
                })
    return {
        "system": system,
        "total_users": total,
        "affected_users": affected,
        "old_thresholds": old_thresholds,
        "new_thresholds": new_thresholds,
        "old_max_level": old_max,
        "new_max_level": new_max,
        "samples": samples,
    }


@api.post("/admin/levels/{system}/apply")
async def _admin_apply_levels(system: str, body: _LevelThresholdsIn, user=Depends(current_user)):
    """Atomically install the new config and recompute all users' display
    level from their PRESERVED points. Writes an audit record to
    `level_migrations`. Idempotent (safe to re-run)."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    if system not in _LEVEL_FIELDS:
        raise HTTPException(400, "Unknown system")
    new_thresholds = _validate_thresholds(body.thresholds)
    new_max = int(body.max_level or new_thresholds[-1]["level"])
    old_doc = await app.state.db.level_configs.find_one({"_id": system}) or {}
    old_thresholds = old_doc.get("thresholds") or _default_level_thresholds(system)
    old_max = int(old_doc.get("max_level", _LEVEL_FIELDS[system]["max"]))
    migration_id = secrets.token_hex(10)
    await app.state.db.level_configs.update_one(
        {"_id": system},
        {"$set": {
            "system": system,
            "thresholds": new_thresholds,
            "max_level": new_max,
            "updated_at": now_utc(),
            "updated_by": str(user["_id"]),
            "migration_id": migration_id,
        }},
        upsert=True,
    )
    affected = await _recompute_all_users_for_system(system)
    await app.state.db.level_migrations.insert_one({
        "migration_id": migration_id,
        "admin_id": str(user["_id"]),
        "system": system,
        "old_thresholds": old_thresholds,
        "new_thresholds": new_thresholds,
        "old_max_level": old_max,
        "new_max_level": new_max,
        "affected_users": affected,
        "created_at": now_utc(),
    })
    return {
        "ok": True,
        "migration_id": migration_id,
        "system": system,
        "affected_users": affected,
        "max_level": new_max,
    }


@api.get("/admin/level-migrations")
async def _admin_list_migrations(user=Depends(current_user), limit: int = 50):
    """Audit list of level migrations. Points and history are never touched
    by migrations — this endpoint proves it by showing only threshold diffs."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    limit = max(1, min(int(limit or 50), 200))
    cur = app.state.db.level_migrations.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        ca = it.get("created_at")
        if isinstance(ca, datetime):
            it["created_at"] = ca.isoformat()
    return {"items": items}


# ---- End Iter-36 Level System Framework -----------------------------------


# ============================================================================
# Iter-38 — Agency + Host Earnings Financial Foundation (Phase 1)
# ----------------------------------------------------------------------------
# Three roles share eligible host earnings per the configured split:
#   HOST    = 50%
#   AGENCY  =  5%
#   ORIO    = 45%
# All percentages come from `config._id="revenue_split"` and are the single
# source of truth. Every earning event writes an IMMUTABLE row to
# `financial_ledger` keyed by a unique `reference_id` (idempotent). Refunds
# write a compensating "reversal" row with negative amounts rather than
# editing the original row.
# ============================================================================

DEFAULT_REVENUE_SPLIT = {"host_percentage": 50, "agency_percentage": 5, "orio_percentage": 45}

# Ledger entries that have been completed are IMMUTABLE except for a bounded
# status transition from "completed" → "refunded" (triggered by _refund_ledger_tx).
_LEDGER_IMMUTABLE_STATUSES = {"completed", "refunded", "reversed"}


async def _get_revenue_split(db) -> dict:
    doc = await db.config.find_one({"_id": "revenue_split"}) or {}
    r = {k: int(doc.get(k, DEFAULT_REVENUE_SPLIT[k])) for k in DEFAULT_REVENUE_SPLIT}
    if r["host_percentage"] + r["agency_percentage"] + r["orio_percentage"] != 100:
        return DEFAULT_REVENUE_SPLIT.copy()
    return r


def _split_amount(gross: int, split: dict) -> tuple[int, int, int]:
    """Deterministic integer split. The remainder from //100 goes to ORIO so
    the three parts always sum to `gross` exactly (no float, no money lost)."""
    g = max(0, int(gross))
    host = g * int(split["host_percentage"]) // 100
    agency = g * int(split["agency_percentage"]) // 100
    orio = g - host - agency
    assert host + agency + orio == g, "split integrity violated"
    return host, agency, orio


async def _audit(db, actor_user_id: Optional[str], action: str, target_type: Optional[str], target_id: Optional[str], meta: Optional[dict] = None) -> None:
    await db.financial_audit_log.insert_one({
        "actor_user_id": actor_user_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "metadata": meta or {},
        "created_at": now_utc(),
    })


async def _get_host_active_agency_id(db, user_id: str) -> Optional[str]:
    m = await db.agency_memberships.find_one(
        {"user_id": user_id, "status": "active"},
        {"agency_id": 1},
    )
    return (m or {}).get("agency_id")


async def _record_ledger_tx(
    db, *, reference_id: str, source: str, user_id: str,
    gross_amount: int, currency: str = "coins",
    metadata: Optional[dict] = None, status: str = "completed",
) -> dict:
    """Idempotent write. If `reference_id` already exists, return the existing row.
    Resolves the host's active agency server-side (not from the client)."""
    existing = await db.financial_ledger.find_one({"reference_id": reference_id})
    if existing:
        return existing
    agency_id = await _get_host_active_agency_id(db, user_id) if user_id else None
    split = await _get_revenue_split(db)
    host, agency, orio = _split_amount(gross_amount, split)
    tx = {
        "transaction_id": secrets.token_hex(12),
        "reference_id": reference_id,
        "user_id": user_id,
        "agency_id": agency_id,
        "type": "earning",
        "status": status,
        "gross_amount": int(gross_amount),
        "host_amount": host,
        "agency_amount": agency,
        "orio_amount": orio,
        "currency": currency,
        "source": source,
        "metadata": metadata or {},
        "created_at": now_utc(),
        "completed_at": now_utc() if status == "completed" else None,
        "split_snapshot": split,
    }
    try:
        await db.financial_ledger.insert_one(tx)
    except Exception:
        existing = await db.financial_ledger.find_one({"reference_id": reference_id})
        if existing:
            return existing
        raise
    # Derived balances (fast-path reads). The ledger remains the source of truth.
    if status == "completed":
        if user_id:
            try:
                await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"host_earnings": host}})
            except Exception:
                pass
        if agency_id:
            try:
                await db.agencies.update_one({"_id": ObjectId(agency_id)}, {"$inc": {"earnings": agency}})
            except Exception:
                pass
        await db.config.update_one({"_id": "orio_revenue"}, {"$inc": {"total": orio}}, upsert=True)
    await _audit(db, None, "ledger_tx_created", "ledger", tx["transaction_id"],
                 {"source": source, "reference_id": reference_id, "gross": int(gross_amount)})
    return tx


async def _refund_ledger_tx(db, original_reference_id: str, actor_user_id: Optional[str] = None) -> Optional[dict]:
    """Compensating/reversal entry — never edits the original row's amounts.
    Idempotent: if the reversal already exists (prior call), returns it."""
    # Idempotency check FIRST — look up by reversal reference_id so we return
    # the existing reversal even after the original row was marked refunded.
    rev_ref = f"REV::{original_reference_id}"
    existing_rev = await db.financial_ledger.find_one({"reference_id": rev_ref})
    if existing_rev:
        return existing_rev
    orig = await db.financial_ledger.find_one({"reference_id": original_reference_id, "type": "earning"})
    if not orig or orig.get("status") != "completed":
        return None
    reversal = {
        "transaction_id": secrets.token_hex(12),
        "reference_id": rev_ref,
        "user_id": orig["user_id"],
        "agency_id": orig.get("agency_id"),
        "type": "reversal",
        "status": "completed",
        "gross_amount": -int(orig["gross_amount"]),
        "host_amount": -int(orig["host_amount"]),
        "agency_amount": -int(orig["agency_amount"]),
        "orio_amount": -int(orig["orio_amount"]),
        "currency": orig.get("currency", "coins"),
        "source": "refund",
        "metadata": {"reverses": orig["transaction_id"]},
        "created_at": now_utc(),
        "completed_at": now_utc(),
    }
    try:
        await db.financial_ledger.insert_one(reversal)
    except Exception as e:
        # A concurrent reversal already inserted the mirror — return the
        # existing row to keep this call idempotent (never 500).
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            existing_rev = await db.financial_ledger.find_one({"reference_id": rev_ref})
            if existing_rev:
                return existing_rev
        raise
    # The status flip + balance deductions are themselves idempotent — the
    # $set targets `status: completed` only, so a second concurrent caller
    # cannot double-decrement. If this call lost the race, the previous
    # branch already returned.
    was_completed = await db.financial_ledger.find_one_and_update(
        {"_id": orig["_id"], "status": "completed"},
        {"$set": {"status": "refunded", "refunded_at": now_utc()}},
    )
    if was_completed is not None:
        try:
            if orig.get("user_id"):
                await db.users.update_one({"_id": ObjectId(orig["user_id"])}, {"$inc": {"host_earnings": -int(orig["host_amount"])}})
            if orig.get("agency_id"):
                await db.agencies.update_one({"_id": ObjectId(orig["agency_id"])}, {"$inc": {"earnings": -int(orig["agency_amount"])}})
        except Exception:
            pass
        await db.config.update_one({"_id": "orio_revenue"}, {"$inc": {"total": -int(orig["orio_amount"])}}, upsert=True)
    await _audit(db, actor_user_id, "ledger_tx_reversed", "ledger", orig["transaction_id"],
                 {"original_reference_id": original_reference_id})
    return reversal


# ---- Admin: Revenue split configuration -----------------------------------

class RevenueSplitIn(BaseModel):
    host_percentage: int
    agency_percentage: int
    orio_percentage: int
    reason: Optional[str] = None


@api.get("/admin/revenue-split")
async def _get_revenue_split_endpoint(user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    return await _get_revenue_split(app.state.db)


@api.patch("/admin/revenue-split")
async def _update_revenue_split(body: RevenueSplitIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    for v in (body.host_percentage, body.agency_percentage, body.orio_percentage):
        if v < 0 or v > 100:
            raise HTTPException(400, "Each percentage must be 0..100")
    if body.host_percentage + body.agency_percentage + body.orio_percentage != 100:
        raise HTTPException(400, "Percentages must sum to 100")
    db = app.state.db
    old = await _get_revenue_split(db)
    await db.config.update_one(
        {"_id": "revenue_split"},
        {"$set": {
            "host_percentage": int(body.host_percentage),
            "agency_percentage": int(body.agency_percentage),
            "orio_percentage": int(body.orio_percentage),
            "updated_by": str(user["_id"]),
            "updated_at": now_utc(),
        }},
        upsert=True,
    )
    new = await _get_revenue_split(db)
    await _audit(db, str(user["_id"]), "revenue_split_changed", "config", "revenue_split",
                 {"old": old, "new": new, "reason": body.reason})
    return new


# ---- Agencies CRUD + host memberships -------------------------------------

class AgencyCreateIn(BaseModel):
    name: str
    owner_user_id: str


class AgencyUpdateIn(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class _HostUserIn(BaseModel):
    user_id: str


def _public_agency(a: dict) -> dict:
    return {
        "id": str(a["_id"]),
        "name": a.get("name"),
        "owner_user_id": a.get("owner_user_id"),
        "status": a.get("status", "active"),
        "earnings": int(a.get("earnings", 0)),
        "created_at": (a.get("created_at").isoformat() if isinstance(a.get("created_at"), datetime) else a.get("created_at")),
    }


async def _get_agency_or_404(db, agency_id: str) -> dict:
    try:
        oid = ObjectId(agency_id)
    except Exception:
        raise HTTPException(404, "Agency not found")
    a = await db.agencies.find_one({"_id": oid})
    if not a:
        raise HTTPException(404, "Agency not found")
    return a


@api.post("/admin/agencies", status_code=201)
async def _create_agency(body: AgencyCreateIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    try:
        owner_oid = ObjectId(body.owner_user_id)
    except Exception:
        raise HTTPException(400, "Invalid owner_user_id")
    if not await db.users.find_one({"_id": owner_oid}):
        raise HTTPException(404, "Owner user not found")
    now_t = now_utc()
    doc = {
        "name": (body.name or "").strip()[:60],
        "owner_user_id": body.owner_user_id,
        "status": "active",
        "earnings": 0,
        "created_at": now_t,
        "updated_at": now_t,
    }
    if not doc["name"]:
        raise HTTPException(400, "Name is required")
    r = await db.agencies.insert_one(doc)
    # Create the owner's membership (role=AGENCY_OWNER).
    # Enforce the one-active-agency-per-host rule for the owner too.
    conflict = await db.agency_memberships.find_one({"user_id": body.owner_user_id, "status": "active"})
    if conflict:
        # Rollback — owner is already in another agency as an active member.
        await db.agencies.delete_one({"_id": r.inserted_id})
        raise HTTPException(409, "Owner already belongs to an active agency")
    try:
        await db.agency_memberships.insert_one({
            "agency_id": str(r.inserted_id),
            "user_id": body.owner_user_id,
            "role": "AGENCY_OWNER",
            "status": "active",
            "joined_at": now_t,
            "created_at": now_t,
            "updated_at": now_t,
        })
    except Exception as e:
        # Lost the race to a concurrent membership — rollback agency insert.
        await db.agencies.delete_one({"_id": r.inserted_id})
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "Owner already belongs to an active agency")
        raise
    await _audit(db, str(user["_id"]), "agency_created", "agency", str(r.inserted_id),
                 {"name": doc["name"], "owner_user_id": body.owner_user_id})
    return _public_agency({**doc, "_id": r.inserted_id})


@api.get("/agencies/{agency_id}")
async def _get_agency(agency_id: str, user=Depends(current_user)):
    db = app.state.db
    a = await _get_agency_or_404(db, agency_id)
    # Any authenticated user can read the public profile. Private financials
    # live on separate endpoints with their own authorization.
    return _public_agency(a)


@api.patch("/admin/agencies/{agency_id}")
async def _update_agency(agency_id: str, body: AgencyUpdateIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    a = await _get_agency_or_404(db, agency_id)
    patch: dict = {"updated_at": now_utc()}
    if body.name is not None:
        n = body.name.strip()[:60]
        if not n:
            raise HTTPException(400, "Name cannot be empty")
        patch["name"] = n
    if body.status is not None:
        if body.status not in {"active", "suspended", "disabled"}:
            raise HTTPException(400, "Invalid status")
        patch["status"] = body.status
    await db.agencies.update_one({"_id": a["_id"]}, {"$set": patch})
    await _audit(db, str(user["_id"]), "agency_updated", "agency", agency_id, {"patch": {k: v for k, v in patch.items() if k != "updated_at"}})
    return _public_agency({**a, **patch})


@api.post("/admin/agencies/{agency_id}/hosts", status_code=201)
async def _add_host(agency_id: str, body: _HostUserIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    a = await _get_agency_or_404(db, agency_id)
    if a.get("status") != "active":
        raise HTTPException(400, "Agency is not active")
    try:
        _ = ObjectId(body.user_id)
    except Exception:
        raise HTTPException(400, "Invalid user_id")
    if not await db.users.find_one({"_id": ObjectId(body.user_id)}):
        raise HTTPException(404, "User not found")
    # One-active-agency-per-host (enforced server-side AND via a partial
    # unique DB index to be race-safe under concurrent requests).
    conflict = await db.agency_memberships.find_one({"user_id": body.user_id, "status": "active"})
    if conflict:
        if conflict.get("agency_id") == agency_id:
            raise HTTPException(409, "User is already a host of this agency")
        raise HTTPException(409, "User already belongs to another active agency")
    now_t = now_utc()
    try:
        await db.agency_memberships.insert_one({
            "agency_id": agency_id,
            "user_id": body.user_id,
            "role": "HOST",
            "status": "active",
            "joined_at": now_t,
            "created_at": now_t,
            "updated_at": now_t,
        })
    except Exception as e:
        # DuplicateKeyError from the `uniq_active_user` partial index — a
        # concurrent request won the race for this user.
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "User already belongs to another active agency")
        raise
    await _audit(db, str(user["_id"]), "host_joined_agency", "membership", body.user_id, {"agency_id": agency_id})
    return {"ok": True}


@api.delete("/admin/agencies/{agency_id}/hosts/{uid}")
async def _remove_host(agency_id: str, uid: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    r = await db.agency_memberships.find_one_and_update(
        {"agency_id": agency_id, "user_id": uid, "status": {"$ne": "removed"}},
        {"$set": {"status": "removed", "left_at": now_utc(), "updated_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "Membership not found")
    await _audit(db, str(user["_id"]), "host_removed_from_agency", "membership", uid, {"agency_id": agency_id})
    return {"ok": True}


@api.post("/admin/agencies/{agency_id}/hosts/{uid}/suspend")
async def _suspend_host(agency_id: str, uid: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    r = await db.agency_memberships.find_one_and_update(
        {"agency_id": agency_id, "user_id": uid, "status": "active"},
        {"$set": {"status": "suspended", "updated_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "Active membership not found")
    await _audit(db, str(user["_id"]), "host_suspended", "membership", uid, {"agency_id": agency_id})
    return {"ok": True}


@api.post("/admin/agencies/{agency_id}/hosts/{uid}/reactivate")
async def _reactivate_host(agency_id: str, uid: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    # Can only reactivate if user has no OTHER active membership.
    other = await db.agency_memberships.find_one({"user_id": uid, "status": "active", "agency_id": {"$ne": agency_id}})
    if other:
        raise HTTPException(409, "User belongs to another active agency")
    try:
        r = await db.agency_memberships.find_one_and_update(
            {"agency_id": agency_id, "user_id": uid, "status": "suspended"},
            {"$set": {"status": "active", "updated_at": now_utc()}},
        )
    except Exception as e:
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "User belongs to another active agency")
        raise
    if not r:
        raise HTTPException(404, "Suspended membership not found")
    await _audit(db, str(user["_id"]), "host_reactivated", "membership", uid, {"agency_id": agency_id})
    return {"ok": True}


# ---- Earnings reads --------------------------------------------------------

async def _sum_ledger(db, match: dict) -> dict:
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": None,
            "gross": {"$sum": "$gross_amount"},
            "host": {"$sum": "$host_amount"},
            "agency": {"$sum": "$agency_amount"},
            "orio": {"$sum": "$orio_amount"},
            "count": {"$sum": 1},
        }},
    ]
    out = await db.financial_ledger.aggregate(pipeline).to_list(1)
    if not out:
        return {"gross": 0, "host": 0, "agency": 0, "orio": 0, "count": 0}
    r = out[0]; r.pop("_id", None)
    return r


@api.get("/hosts/me/earnings")
async def _my_host_earnings(user=Depends(current_user)):
    db = app.state.db
    # Only COMPLETED entries contribute to available earnings. Reversals are
    # separate rows with negative values so a sum naturally reflects refunds.
    completed = await _sum_ledger(db, {"user_id": str(user["_id"]), "type": {"$in": ["earning", "reversal", "withdrawal"]}, "status": {"$in": ["completed", "refunded"]}})
    # "pending" earnings — tracked separately so they're never withdrawable.
    pending = await _sum_ledger(db, {"user_id": str(user["_id"]), "type": "earning", "status": "pending"})
    agency_id = await _get_host_active_agency_id(db, str(user["_id"]))
    return {
        "user_id": str(user["_id"]),
        "agency_id": agency_id,
        "currency": "coins",
        "available": {
            "host": int(completed["host"]),
            "gross": int(completed["gross"]),
            "entries": int(completed["count"]),
        },
        "pending": {
            "host": _split_amount(int(pending["gross"]), await _get_revenue_split(db))[0] if pending["gross"] else 0,
            "gross": int(pending["gross"]),
            "entries": int(pending["count"]),
        },
    }


@api.get("/agencies/{agency_id}/earnings")
async def _agency_earnings(agency_id: str, user=Depends(current_user)):
    db = app.state.db
    a = await _get_agency_or_404(db, agency_id)
    # Permission: admin OR this agency's owner.
    if not user.get("is_admin") and a.get("owner_user_id") != str(user["_id"]):
        raise HTTPException(403, "Not authorized")
    completed = await _sum_ledger(db, {"agency_id": agency_id, "status": {"$in": ["completed", "refunded"]}})
    pending = await _sum_ledger(db, {"agency_id": agency_id, "status": "pending"})
    return {
        "agency_id": agency_id,
        "currency": "coins",
        "available": {"agency": int(completed["agency"]), "gross": int(completed["gross"]), "entries": int(completed["count"])},
        "pending": {"agency": int(pending["agency"]), "gross": int(pending["gross"]), "entries": int(pending["count"])},
    }


@api.get("/admin/ledger")
async def _admin_ledger(user=Depends(current_user), limit: int = 100, user_id: Optional[str] = None, agency_id: Optional[str] = None, status: Optional[str] = None):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    limit = max(1, min(int(limit or 100), 500))
    q: dict = {}
    if user_id:    q["user_id"] = user_id
    if agency_id:  q["agency_id"] = agency_id
    if status:     q["status"] = status
    cur = db.financial_ledger.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        ca = it.get("created_at")
        if isinstance(ca, datetime):
            it["created_at"] = ca.isoformat()
        cp = it.get("completed_at")
        if isinstance(cp, datetime):
            it["completed_at"] = cp.isoformat()
    return {"items": items}


@api.get("/admin/audit-logs")
async def _admin_audit(user=Depends(current_user), limit: int = 100):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    limit = max(1, min(int(limit or 100), 500))
    cur = db.financial_audit_log.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        ca = it.get("created_at")
        if isinstance(ca, datetime):
            it["created_at"] = ca.isoformat()
    return {"items": items}


# ---- Admin: compensating/manual reversal -----------------------------------
class _ReverseIn(BaseModel):
    reference_id: str
    reason: Optional[str] = None


@api.post("/admin/ledger/reverse")
async def _admin_reverse(body: _ReverseIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    rev = await _refund_ledger_tx(app.state.db, body.reference_id, actor_user_id=str(user["_id"]))
    if not rev:
        raise HTTPException(404, "Original transaction not found or not refundable")
    return {"ok": True, "reversal_tx_id": rev["transaction_id"], "reference_id": rev["reference_id"]}


# ---- Immutability guard (defensive): block any accidental ledger write that
# attempts to amend amounts on a completed row. Normal code paths go through
# _record_ledger_tx / _refund_ledger_tx and never mutate amounts.


async def _bootstrap_indexes_v38(db):
    try:
        await db.financial_ledger.create_index("reference_id", unique=True)
    except Exception:
        pass
    try:
        await db.financial_ledger.create_index([("user_id", 1), ("created_at", -1)])
        await db.financial_ledger.create_index([("agency_id", 1), ("created_at", -1)])
        await db.financial_audit_log.create_index("created_at")
        await db.agency_memberships.create_index([("user_id", 1), ("status", 1)])
        await db.agency_memberships.create_index([("agency_id", 1), ("status", 1)])
    except Exception:
        pass
    # Iter-38 race-safety: enforce one ACTIVE agency membership per user at
    # the DB layer (partial unique index). This closes the TOCTOU window in
    # /admin/agencies/{id}/hosts and /reactivate.
    try:
        # Drop any legacy non-unique variant with the same name, then create
        # the unique partial index. We purge pre-existing duplicates first so
        # the unique index can be built.
        await _dedupe_active_agency_memberships(db)
        await db.agency_memberships.create_index(
            [("user_id", 1)],
            unique=True,
            partialFilterExpression={"status": "active"},
            name="uniq_active_user",
        )
    except Exception:
        pass


async def _dedupe_active_agency_memberships(db):
    """Keep ONLY the earliest active membership per user; demote the rest to
    `superseded` so the unique partial index can be built safely."""
    try:
        pipeline = [
            {"$match": {"status": "active"}},
            {"$sort": {"created_at": 1}},
            {"$group": {
                "_id": "$user_id",
                "ids": {"$push": "$_id"},
                "n": {"$sum": 1},
            }},
            {"$match": {"n": {"$gt": 1}}},
        ]
        async for g in db.agency_memberships.aggregate(pipeline):
            losers = g["ids"][1:]
            if losers:
                await db.agency_memberships.update_many(
                    {"_id": {"$in": losers}},
                    {"$set": {"status": "superseded", "updated_at": now_utc()}},
                )
    except Exception:
        pass


# ---- End Iter-38 Agency + Host Earnings -----------------------------------


# ============================================================================
# Iter-39/Phase-2A — Agency Center + Host Agency Experience (BACKEND ONLY)
# All financial logic still goes through the Phase-1 ledger — these endpoints
# are READ + membership MANAGEMENT only (invitations, accept/reject, self-view,
# owner-side host administration). No new amount-mutating surface.
# ============================================================================


async def _bootstrap_indexes_v39(db):
    try:
        await db.agency_invitations.create_index(
            [("user_id", 1), ("agency_id", 1), ("status", 1)],
        )
        await db.agency_invitations.create_index([("agency_id", 1), ("created_at", -1)])
        # One pending invite per (user, agency) — the DB enforces this so a
        # concurrent double-invite can never create duplicate pendings.
        await db.agency_invitations.create_index(
            [("user_id", 1), ("agency_id", 1)],
            unique=True,
            partialFilterExpression={"status": "pending"},
            name="uniq_pending_invite",
        )
    except Exception:
        pass


async def _resolve_agency_or_403(db, user, agency_id: str, *, require_owner: bool = False) -> dict:
    """Return the agency doc if the caller is admin OR the agency owner.
    If `require_owner=False`, members (any role) can read."""
    a = await _get_agency_or_404(db, agency_id)
    uid = str(user["_id"])
    if user.get("is_admin"):
        return a
    if a.get("owner_user_id") == uid:
        return a
    if require_owner:
        raise HTTPException(403, "Only the agency owner can perform this action")
    # Member read fallback — any active membership of this agency can read.
    m = await db.agency_memberships.find_one(
        {"agency_id": agency_id, "user_id": uid, "status": "active"},
        {"_id": 1},
    )
    if m:
        return a
    raise HTTPException(403, "Not authorized for this agency")


def _public_invitation(inv: dict, extra: Optional[dict] = None) -> dict:
    out = {
        "id": str(inv["_id"]),
        "agency_id": inv["agency_id"],
        "user_id": inv["user_id"],
        "invited_by": inv.get("invited_by"),
        "status": inv.get("status", "pending"),
        "message": inv.get("message"),
        "created_at": (inv["created_at"].isoformat()
                       if isinstance(inv.get("created_at"), datetime) else inv.get("created_at")),
        "responded_at": (inv["responded_at"].isoformat()
                         if isinstance(inv.get("responded_at"), datetime) else inv.get("responded_at")),
    }
    if extra:
        out.update(extra)
    return out


async def _resolve_invitee(db, identifier: str) -> dict:
    """Accept a Mongo _id, a numeric_id, a username, or an email."""
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(400, "Missing user identifier")
    # Try ObjectId
    try:
        u = await db.users.find_one({"_id": ObjectId(ident)})
        if u:
            return u
    except Exception:
        pass
    # Try numeric_id (digits only)
    if ident.isdigit():
        u = await db.users.find_one({"numeric_id": ident})
        if u:
            return u
    low = ident.casefold()
    u = await db.users.find_one({"username": low})
    if u:
        return u
    u = await db.users.find_one({"email": low})
    if u:
        return u
    raise HTTPException(404, "User not found")


# ---- Self views -----------------------------------------------------------

@api.get("/me/agency")
async def _my_agency(user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    m = await db.agency_memberships.find_one({"user_id": uid, "status": "active"})
    if not m:
        return {"membership": None, "agency": None, "role": None}
    a = await db.agencies.find_one({"_id": ObjectId(m["agency_id"])}) if m.get("agency_id") else None
    if not a:
        return {"membership": None, "agency": None, "role": None}
    return {
        "membership": {
            "id": str(m["_id"]),
            "agency_id": m["agency_id"],
            "user_id": m["user_id"],
            "role": m.get("role", "HOST"),
            "status": m.get("status", "active"),
            "joined_at": (m["joined_at"].isoformat() if isinstance(m.get("joined_at"), datetime) else m.get("joined_at")),
        },
        "agency": _public_agency(a),
        "role": m.get("role", "HOST"),
    }


@api.get("/me/agency-invitations")
async def _my_invitations(user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    cur = db.agency_invitations.find({"user_id": uid, "status": "pending"}, {}).sort("created_at", -1)
    items = await cur.to_list(100)
    # Hydrate with agency summaries so the UI can render in a single call.
    out: list = []
    for inv in items:
        agency = None
        try:
            a = await db.agencies.find_one({"_id": ObjectId(inv["agency_id"])})
            if a:
                agency = _public_agency(a)
        except Exception:
            pass
        out.append(_public_invitation(inv, {"agency": agency}))
    return {"items": out}


@api.get("/me/transactions")
async def _my_ledger(user=Depends(current_user), limit: int = 100):
    """Current user's own financial-ledger rows (read-only)."""
    db = app.state.db
    uid = str(user["_id"])
    limit = max(1, min(int(limit or 100), 500))
    cur = db.financial_ledger.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        for key in ("created_at", "completed_at", "refunded_at"):
            v = it.get(key)
            if isinstance(v, datetime):
                it[key] = v.isoformat()
        # Strip metadata that could leak other users' identities.
        # Keep safe keys only.
        md = it.get("metadata") or {}
        safe_md = {k: md[k] for k in ("gift_id", "quantity", "unit_price", "room_id", "combo_id") if k in md}
        it["metadata"] = safe_md
    return {"items": items}


@api.post("/me/agency/leave")
async def _leave_my_agency(user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    m = await db.agency_memberships.find_one({"user_id": uid, "status": "active"})
    if not m:
        raise HTTPException(404, "No active agency membership")
    # Owners can't leave their own agency — they must transfer or disband it
    # (not supported in this phase).
    if m.get("role") == "AGENCY_OWNER":
        raise HTTPException(400, "Agency owner cannot leave their own agency")
    await db.agency_memberships.update_one(
        {"_id": m["_id"]},
        {"$set": {"status": "removed", "left_at": now_utc(), "updated_at": now_utc()}},
    )
    await _audit(db, uid, "host_left_agency", "membership", uid, {"agency_id": m["agency_id"]})
    return {"ok": True}


# ---- Owner/admin: invitations --------------------------------------------

class _InviteIn(BaseModel):
    user_identifier: str  # ObjectId / numeric_id / username / email
    message: Optional[str] = None


@api.post("/agencies/{agency_id}/invitations", status_code=201)
async def _create_invitation(agency_id: str, body: _InviteIn, user=Depends(current_user)):
    db = app.state.db
    a = await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    if a.get("status") != "active":
        raise HTTPException(400, "Agency is not active")
    invitee = await _resolve_invitee(db, body.user_identifier)
    invitee_id = str(invitee["_id"])
    uid = str(user["_id"])
    if invitee_id == uid and not user.get("is_admin"):
        raise HTTPException(400, "You cannot invite yourself")
    # Already an active member of THIS agency?
    existing_mem = await db.agency_memberships.find_one(
        {"agency_id": agency_id, "user_id": invitee_id, "status": "active"}
    )
    if existing_mem:
        raise HTTPException(409, "User is already a member of this agency")
    now_t = now_utc()
    doc = {
        "agency_id": agency_id,
        "user_id": invitee_id,
        "invited_by": uid,
        "status": "pending",
        "message": (body.message or "").strip()[:280] or None,
        "created_at": now_t,
        "updated_at": now_t,
        "responded_at": None,
    }
    try:
        r = await db.agency_invitations.insert_one(doc)
    except Exception as e:
        # Partial unique index: a pending invite for the same (user, agency)
        # already exists. Treat as idempotent.
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "An invitation is already pending for this user")
        raise
    await _audit(db, uid, "agency_invitation_created", "invitation", str(r.inserted_id),
                 {"agency_id": agency_id, "user_id": invitee_id})
    return _public_invitation({**doc, "_id": r.inserted_id},
                              {"user": {"id": invitee_id, "nickname": invitee.get("nickname"),
                                        "username": invitee.get("username"),
                                        "numeric_id": invitee.get("numeric_id")}})


@api.get("/agencies/{agency_id}/invitations")
async def _list_invitations(agency_id: str, user=Depends(current_user),
                            status: Optional[str] = "pending", limit: int = 100):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    q: dict = {"agency_id": agency_id}
    if status:
        q["status"] = status
    cur = db.agency_invitations.find(q).sort("created_at", -1).limit(max(1, min(int(limit or 100), 200)))
    rows = await cur.to_list(limit)
    out = []
    for inv in rows:
        u = None
        try:
            u = await db.users.find_one({"_id": ObjectId(inv["user_id"])},
                                        {"nickname": 1, "username": 1, "numeric_id": 1, "avatar_url": 1})
        except Exception:
            pass
        extra = {}
        if u:
            extra["user"] = {"id": str(u["_id"]), "nickname": u.get("nickname"),
                             "username": u.get("username"), "numeric_id": u.get("numeric_id"),
                             "avatar_url": u.get("avatar_url")}
        out.append(_public_invitation(inv, extra))
    return {"items": out}


@api.delete("/agencies/{agency_id}/invitations/{inv_id}")
async def _cancel_invitation(agency_id: str, inv_id: str, user=Depends(current_user)):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    try:
        oid = ObjectId(inv_id)
    except Exception:
        raise HTTPException(404, "Invitation not found")
    r = await db.agency_invitations.find_one_and_update(
        {"_id": oid, "agency_id": agency_id, "status": "pending"},
        {"$set": {"status": "cancelled", "updated_at": now_utc(),
                  "responded_at": now_utc(), "responded_by": str(user["_id"])}},
    )
    if not r:
        raise HTTPException(404, "Pending invitation not found")
    await _audit(db, str(user["_id"]), "agency_invitation_cancelled", "invitation", inv_id,
                 {"agency_id": agency_id})
    return {"ok": True}


# ---- Invitee actions ------------------------------------------------------

async def _get_invitation_for_invitee(db, inv_id: str, user) -> dict:
    try:
        oid = ObjectId(inv_id)
    except Exception:
        raise HTTPException(404, "Invitation not found")
    inv = await db.agency_invitations.find_one({"_id": oid})
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv["user_id"] != str(user["_id"]):
        raise HTTPException(403, "This invitation is not addressed to you")
    return inv


@api.post("/agency-invitations/{inv_id}/accept")
async def _accept_invitation(inv_id: str, user=Depends(current_user)):
    db = app.state.db
    inv = await _get_invitation_for_invitee(db, inv_id, user)
    if inv.get("status") != "pending":
        raise HTTPException(409, "Invitation is no longer pending")
    agency_id = inv["agency_id"]
    uid = str(user["_id"])
    # Verify the agency is still active.
    try:
        a = await db.agencies.find_one({"_id": ObjectId(agency_id)})
    except Exception:
        a = None
    if not a or a.get("status") != "active":
        raise HTTPException(400, "Agency is no longer active")
    # Enforce one-active-agency rule at DB level via the uniq_active_user
    # partial index. If the user is already active elsewhere, this will 409.
    now_t = now_utc()
    try:
        await db.agency_memberships.insert_one({
            "agency_id": agency_id,
            "user_id": uid,
            "role": "HOST",
            "status": "active",
            "joined_at": now_t,
            "created_at": now_t,
            "updated_at": now_t,
        })
    except Exception as e:
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "You already belong to another active agency")
        raise
    await db.agency_invitations.update_one(
        {"_id": inv["_id"], "status": "pending"},
        {"$set": {"status": "accepted", "updated_at": now_t, "responded_at": now_t}},
    )
    await _audit(db, uid, "agency_invitation_accepted", "invitation", inv_id,
                 {"agency_id": agency_id})
    return {"ok": True, "agency_id": agency_id}


@api.post("/agency-invitations/{inv_id}/reject")
async def _reject_invitation(inv_id: str, user=Depends(current_user)):
    db = app.state.db
    inv = await _get_invitation_for_invitee(db, inv_id, user)
    if inv.get("status") != "pending":
        raise HTTPException(409, "Invitation is no longer pending")
    await db.agency_invitations.update_one(
        {"_id": inv["_id"]},
        {"$set": {"status": "rejected", "updated_at": now_utc(), "responded_at": now_utc()}},
    )
    await _audit(db, str(user["_id"]), "agency_invitation_rejected", "invitation", inv_id,
                 {"agency_id": inv["agency_id"]})
    return {"ok": True}


# ---- Owner/admin: host roster + transactions ------------------------------

@api.get("/agencies/{agency_id}/hosts")
async def _list_agency_hosts(agency_id: str, user=Depends(current_user),
                             status: Optional[str] = None, limit: int = 200):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=False)
    q: dict = {"agency_id": agency_id}
    if status:
        q["status"] = status
    cur = db.agency_memberships.find(q).sort("joined_at", 1).limit(max(1, min(int(limit or 200), 500)))
    rows = await cur.to_list(limit)
    out = []
    for m in rows:
        u = None
        try:
            u = await db.users.find_one({"_id": ObjectId(m["user_id"])},
                                        {"nickname": 1, "username": 1, "numeric_id": 1,
                                         "avatar_url": 1, "vip_level": 1})
        except Exception:
            pass
        host_amount = 0
        # Owners/admins can see per-host totals; a member peer cannot.
        can_see_amounts = user.get("is_admin") or (
            await db.agencies.find_one({"_id": ObjectId(agency_id), "owner_user_id": str(user["_id"])}) is not None
        )
        if can_see_amounts:
            agg = await _sum_ledger(db, {
                "agency_id": agency_id, "user_id": m["user_id"],
                "status": {"$in": ["completed", "refunded"]},
            })
            host_amount = int(agg["host"])
        out.append({
            "id": str(m["_id"]),
            "user_id": m["user_id"],
            "role": m.get("role", "HOST"),
            "status": m.get("status", "active"),
            "joined_at": (m["joined_at"].isoformat() if isinstance(m.get("joined_at"), datetime) else m.get("joined_at")),
            "user": ({"id": str(u["_id"]), "nickname": u.get("nickname"),
                      "username": u.get("username"), "numeric_id": u.get("numeric_id"),
                      "avatar_url": u.get("avatar_url"), "vip_level": u.get("vip_level")} if u else None),
            "host_earnings": host_amount if can_see_amounts else None,
        })
    return {"items": out}


@api.get("/agencies/{agency_id}/transactions")
async def _list_agency_transactions(agency_id: str, user=Depends(current_user), limit: int = 100):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    limit = max(1, min(int(limit or 100), 500))
    cur = db.financial_ledger.find({"agency_id": agency_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        for key in ("created_at", "completed_at", "refunded_at"):
            v = it.get(key)
            if isinstance(v, datetime):
                it[key] = v.isoformat()
        md = it.get("metadata") or {}
        it["metadata"] = {k: md[k] for k in ("gift_id", "quantity", "unit_price", "room_id") if k in md}
    return {"items": items}


# ---- Owner/admin: host state transitions (non-admin surface) --------------

@api.post("/agencies/{agency_id}/hosts/{uid}/suspend")
async def _owner_suspend_host(agency_id: str, uid: str, user=Depends(current_user)):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    # Owners cannot suspend themselves.
    if uid == str(user["_id"]) and not user.get("is_admin"):
        raise HTTPException(400, "You cannot suspend yourself")
    r = await db.agency_memberships.find_one_and_update(
        {"agency_id": agency_id, "user_id": uid, "status": "active", "role": {"$ne": "AGENCY_OWNER"}},
        {"$set": {"status": "suspended", "updated_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "Active host not found")
    await _audit(db, str(user["_id"]), "host_suspended", "membership", uid, {"agency_id": agency_id})
    return {"ok": True}


@api.post("/agencies/{agency_id}/hosts/{uid}/reactivate")
async def _owner_reactivate_host(agency_id: str, uid: str, user=Depends(current_user)):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    other = await db.agency_memberships.find_one(
        {"user_id": uid, "status": "active", "agency_id": {"$ne": agency_id}}
    )
    if other:
        raise HTTPException(409, "User belongs to another active agency")
    try:
        r = await db.agency_memberships.find_one_and_update(
            {"agency_id": agency_id, "user_id": uid, "status": "suspended"},
            {"$set": {"status": "active", "updated_at": now_utc()}},
        )
    except Exception as e:
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "User belongs to another active agency")
        raise
    if not r:
        raise HTTPException(404, "Suspended membership not found")
    await _audit(db, str(user["_id"]), "host_reactivated", "membership", uid, {"agency_id": agency_id})
    return {"ok": True}


@api.delete("/agencies/{agency_id}/hosts/{uid}")
async def _owner_remove_host(agency_id: str, uid: str, user=Depends(current_user)):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    if uid == str(user["_id"]):
        raise HTTPException(400, "The owner cannot remove themselves")
    r = await db.agency_memberships.find_one_and_update(
        {"agency_id": agency_id, "user_id": uid, "status": {"$in": ["active", "suspended"]},
         "role": {"$ne": "AGENCY_OWNER"}},
        {"$set": {"status": "removed", "left_at": now_utc(), "updated_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "Membership not found")
    await _audit(db, str(user["_id"]), "host_removed_from_agency", "membership", uid,
                 {"agency_id": agency_id})
    return {"ok": True}


# ---- End Iter-39 Phase-2A -------------------------------------------------


# ============================================================================
# Iter-40 / Phase-2B — Withdrawal System (MANUAL PAYOUT MODEL)
#
# ORIO holds funds in DIAMONDS. Withdrawals are USD-denominated requests that
# convert through a configured rate (`diamonds_per_usd`). We DO NOT integrate
# any payment provider API. Admins process payouts externally and record the
# reference manually.
#
# Balance reservation uses COMPENSATING LEDGER ENTRIES only — the Phase-1
# invariant `h+a+o==g` and `financial_ledger.reference_id` uniqueness hold.
# Historical earning rows are NEVER edited or deleted.
# ============================================================================


# --- Supported methods & required fields -----------------------------------
# For every method we declare which fields the client MUST provide and which
# are optional. The backend validates — never trust the client.
_SUPPORTED_PAYOUT_METHODS: dict = {
    "paypal":          {"label": "PayPal",           "required": ["email", "account_holder_name"], "optional": []},
    "payoneer":        {"label": "Payoneer",         "required": ["account_identifier", "account_holder_name"], "optional": []},
    "usdt_trc20":      {"label": "USDT (TRC20)",     "required": ["wallet_address"], "optional": ["account_holder_name"], "network": "TRC20"},
    "pix":             {"label": "PIX",              "required": ["pix_key", "pix_key_type", "account_holder_name"], "optional": ["country"]},
    "dana":            {"label": "DANA",             "required": ["account_identifier", "account_holder_name"], "optional": []},
    "bank_transfer":   {"label": "Bank Transfer",    "required": ["account_holder_name", "bank_name", "account_number", "country"], "optional": ["routing_number", "iban", "swift", "currency"]},
    "gcash":           {"label": "GCash",            "required": ["account_identifier", "account_holder_name"], "optional": []},
    "vodafone_cash":   {"label": "Vodafone Cash",    "required": ["wallet_number", "account_holder_name", "country"], "optional": []},
    "chime":           {"label": "Chime",            "required": ["account_holder_name", "routing_number", "account_number"], "optional": []},
    "cashapp":         {"label": "Cash App",         "required": ["cashapp_identifier", "account_holder_name"], "optional": []},
    "venmo":           {"label": "Venmo",            "required": ["venmo_identifier", "account_holder_name"], "optional": []},
    "al_kuraimi":      {"label": "Al-Kuraimi Bank",  "required": ["account_identifier", "account_holder_name"], "optional": ["branch", "country"]},
    "al_najm":         {"label": "Al-Najm",          "required": ["account_identifier", "account_holder_name"], "optional": []},
    "moneygram":       {"label": "MoneyGram",        "required": ["recipient_legal_name", "country"], "optional": ["city", "id_number"]},
    "western_union":   {"label": "Western Union",    "required": ["recipient_legal_name", "country"], "optional": ["city", "id_number"]},
    "ria":             {"label": "Ria",              "required": ["recipient_legal_name", "country"], "optional": ["city", "id_number"]},
    "jeeb_wallet":     {"label": "Jeeb Wallet",      "required": ["wallet_identifier", "account_holder_name"], "optional": []},
    "epay_wallet":     {"label": "Epay Wallet",      "required": ["wallet_identifier", "account_holder_name"], "optional": []},
}


# Which detail field to use as the public "display hint" (masked when sensitive)
_PAYOUT_DISPLAY_FIELD: dict = {
    "paypal": "email", "payoneer": "account_identifier",
    "usdt_trc20": "wallet_address", "pix": "pix_key", "dana": "account_identifier",
    "bank_transfer": "account_number", "gcash": "account_identifier",
    "vodafone_cash": "wallet_number", "chime": "account_number",
    "cashapp": "cashapp_identifier", "venmo": "venmo_identifier",
    "al_kuraimi": "account_identifier", "al_najm": "account_identifier",
    "moneygram": "recipient_legal_name", "western_union": "recipient_legal_name",
    "ria": "recipient_legal_name", "jeeb_wallet": "wallet_identifier",
    "epay_wallet": "wallet_identifier",
}


# Fields considered sensitive-numeric → masked as "****1234"
_PAYOUT_NUMBER_FIELDS = {
    "account_number", "wallet_number", "wallet_address",
    "routing_number", "iban", "cashapp_identifier",
}


_WITHDRAWAL_STATUSES = {
    "REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION",
    "APPROVED", "PROCESSING", "PAID",
    "REJECTED", "CANCELLED", "FAILED", "RETURNED",
}
_WITHDRAWAL_CANCELABLE = {"REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION"}
_WITHDRAWAL_REFUNDABLE_STATUSES = {"REJECTED", "CANCELLED", "RETURNED"}


def _mask_value(method: str, field: str, value: str) -> str:
    if not value:
        return ""
    v = str(value)
    if field == "email" or ("@" in v and len(v) > 3):
        local, _, dom = v.partition("@")
        if dom:
            return (local[:2] + "***") + "@" + dom
    if field in _PAYOUT_NUMBER_FIELDS or (v.replace("-", "").isdigit() and len(v) >= 4):
        return "****" + v[-4:] if len(v) >= 4 else "****"
    # names / short identifiers: keep first + last letters
    if len(v) <= 4:
        return v[0] + "***"
    return v[:2] + "***" + v[-2:]


def _display_hint(method: str, details: dict) -> str:
    f = _PAYOUT_DISPLAY_FIELD.get(method)
    if not f or not details.get(f):
        return _SUPPORTED_PAYOUT_METHODS.get(method, {}).get("label", method)
    return _mask_value(method, f, details[f])


_PLACEHOLDER_VALUES = {
    "test", "demo", "example", "placeholder", "null", "none", "n/a", "na",
    "x", "xx", "xxx", "xxxx", "...", ".", "-", "--", "---", "1", "0",
    "123", "1234", "12345", "123456", "123456789", "1234567890",
    "aaa", "bbb", "abc", "qwe", "qwerty", "asdf", "fake", "sample",
    "yourname", "your name", "firstname lastname",
}
_EMAIL_RE = __import__("re").compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_TRC20_RE = __import__("re").compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")  # TRON base58 address


def _is_placeholder(v: str) -> bool:
    if not v:
        return True
    s = str(v).strip()
    if not s:
        return True
    low = s.casefold()
    if low in _PLACEHOLDER_VALUES:
        return True
    # Strings that are only punctuation/dots/stars.
    if all(ch in ".*- _/\\|~" for ch in s):
        return True
    # Repeated character (e.g. "aaaaaa", "0000")
    if len(set(s)) == 1 and len(s) >= 3:
        return True
    # Trivial very-short values that are clearly not real payout info.
    if len(s) < 2:
        return True
    return False


def _validate_payout_fields(method: str, details: dict) -> dict:
    """Raise 400 unless `details` matches the schema for `method`.
    Rejects obvious placeholder values and enforces per-field format."""
    schema = _SUPPORTED_PAYOUT_METHODS.get(method)
    if not schema:
        raise HTTPException(400, f"Unsupported payout method: {method}")
    if not isinstance(details, dict):
        raise HTTPException(400, "details must be an object")
    allowed = set(schema["required"]) | set(schema["optional"])
    out: dict = {}
    for k in allowed:
        v = details.get(k)
        if isinstance(v, str):
            v = v.strip()
            if v == "":
                v = None
        if v is not None:
            out[k] = v
    missing = [k for k in schema["required"] if not out.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required field(s) for {method}: {', '.join(missing)}")

    # Placeholder rejection on EVERY provided field.
    for k, v in list(out.items()):
        if _is_placeholder(str(v)):
            raise HTTPException(400, f"'{k}' looks like a placeholder — enter your real {k.replace('_', ' ')}")

    # Format validation per method.
    def _bad(msg: str):
        raise HTTPException(400, msg)

    # Email fields must look like real emails.
    for email_field in ("email",):
        v = out.get(email_field)
        if v is not None and not _EMAIL_RE.match(v):
            _bad(f"'{email_field}' is not a valid email address")
    # PayPal must have a real email + real holder name
    if method == "paypal":
        if not out.get("email") or not _EMAIL_RE.match(out["email"]):
            _bad("PayPal requires a valid email address")
    # USDT TRC20 wallet format
    if method == "usdt_trc20":
        wa = out.get("wallet_address") or ""
        if not _TRC20_RE.match(wa):
            _bad("USDT TRC20 wallet address is not a valid TRON address (must start with 'T' and be 34 chars base58)")
    # Country-coded methods — require 2 to 3 char country code
    if "country" in out:
        c = (out.get("country") or "").upper().strip()
        if c and (len(c) < 2 or len(c) > 56):
            _bad("country must be a valid name or ISO code")
        out["country"] = c
    # PIX key type restricted set
    if method == "pix":
        kt = (out.get("pix_key_type") or "").lower().strip()
        if kt and kt not in {"cpf", "cnpj", "email", "phone", "random", "evp"}:
            _bad("pix_key_type must be one of cpf | cnpj | email | phone | random | evp")
        out["pix_key_type"] = kt or "random"
    # Account / routing numbers: at least 4 digits
    for k in ("account_number", "routing_number", "wallet_number", "iban"):
        if out.get(k):
            digits = "".join(ch for ch in out[k] if ch.isdigit())
            if len(digits) < 4:
                _bad(f"'{k}' must contain at least 4 digits")
    # Holder / recipient names must contain at least a first + last token.
    for k in ("account_holder_name", "recipient_legal_name"):
        if out.get(k):
            parts = [p for p in out[k].split() if len(p) >= 2]
            if len(parts) < 2:
                _bad(f"'{k}' must be a full legal name (first + last)")
    return out


def _public_payout_method(doc: dict, *, unmask: bool = False) -> dict:
    details = doc.get("details") or {}
    if not unmask:
        masked = {}
        for k, v in details.items():
            # Keep non-sensitive country/currency/network fields as-is
            if k in ("country", "currency", "pix_key_type", "bank_name", "branch"):
                masked[k] = v
            else:
                masked[k] = _mask_value(doc.get("method", ""), k, v) if v else v
        details = masked
    return {
        "id": str(doc["_id"]),
        "method": doc.get("method"),
        "label": _SUPPORTED_PAYOUT_METHODS.get(doc.get("method", ""), {}).get("label", doc.get("method")),
        "details": details,
        "display_hint": doc.get("display_hint"),
        "is_default": bool(doc.get("is_default")),
        "verification_status": doc.get("verification_status", "unverified"),
        "created_at": (doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at")),
    }


# --- Config -----------------------------------------------------------------

async def _get_withdrawal_config(db) -> dict:
    """Authoritative conversion/limits. OFFICIAL ORIO RATE: 9999 Diamonds = $1.
    All values are integers (no float math). Centralized here so every
    feature reads the SAME source of truth."""
    doc = await db.config.find_one({"_id": "withdrawal_config"}) or {}
    return {
        "minimum_withdrawal_usd": int(doc.get("minimum_withdrawal_usd", 10)),
        "maximum_withdrawal_usd": int(doc.get("maximum_withdrawal_usd", 1000)),
        "review_period_days": int(doc.get("review_period_days", 7)),
        "diamonds_per_usd": int(doc.get("diamonds_per_usd", 9999)),
    }


async def _migrate_withdrawal_config_v41(db):
    """One-shot migration: force the authoritative rate 9999/USD and add
    the $1000 ceiling. Idempotent — only overwrites values that disagree."""
    doc = await db.config.find_one({"_id": "withdrawal_config"}) or {}
    patch = {}
    if int(doc.get("diamonds_per_usd", 0)) != 9999:
        patch["diamonds_per_usd"] = 9999
    if int(doc.get("maximum_withdrawal_usd", 0)) != 1000:
        patch["maximum_withdrawal_usd"] = 1000
    if int(doc.get("minimum_withdrawal_usd", 0)) < 1:
        patch["minimum_withdrawal_usd"] = 10
    if int(doc.get("review_period_days", -1)) < 0:
        patch["review_period_days"] = 7
    if patch:
        patch["updated_at"] = now_utc()
        patch["migrated_at"] = now_utc()
        patch["migration_source"] = "iter-41"
        await db.config.update_one({"_id": "withdrawal_config"}, {"$set": patch}, upsert=True)


# --- Bootstrap indexes ------------------------------------------------------

async def _bootstrap_indexes_v40(db):
    try:
        await db.payout_methods.create_index([("user_id", 1), ("created_at", -1)])
        # Only one default per user:
        await db.payout_methods.create_index(
            [("user_id", 1)], unique=True,
            partialFilterExpression={"is_default": True},
            name="uniq_default_payout",
        )
    except Exception:
        pass
    try:
        await db.withdrawals.create_index([("user_id", 1), ("created_at", -1)])
        await db.withdrawals.create_index([("agency_id", 1), ("created_at", -1)])
        await db.withdrawals.create_index([("status", 1), ("review_ends_at", 1)])
        # Per-user idempotency: same key cannot create two withdrawals.
        await db.withdrawals.create_index(
            [("user_id", 1), ("idempotency_key", 1)],
            unique=True,
            partialFilterExpression={"idempotency_key": {"$type": "string"}},
            name="uniq_idempotency_per_user",
        )
    except Exception:
        pass


# --- Compensating-ledger writer (reservation / cancellation / return) -------

async def _record_withdrawal_ledger_tx(
    db, *, reference_id: str, source: str, user_id: Optional[str],
    agency_id: Optional[str], host_delta: int, agency_delta: int,
    withdrawal_id: str, metadata: Optional[dict] = None,
) -> dict:
    """Write a raw ledger row for a withdrawal lifecycle event.
    Keeps the Phase-1 invariant `h+a+o==g` by construction (orio=0).
    Idempotent via unique `reference_id`."""
    existing = await db.financial_ledger.find_one({"reference_id": reference_id})
    if existing:
        return existing
    gross = host_delta + agency_delta
    tx = {
        "transaction_id": secrets.token_hex(12),
        "reference_id": reference_id,
        "user_id": user_id,
        "agency_id": agency_id,
        "type": "withdrawal",
        "status": "completed",
        "gross_amount": int(gross),
        "host_amount": int(host_delta),
        "agency_amount": int(agency_delta),
        "orio_amount": 0,
        "currency": "diamonds",
        "source": source,
        "metadata": {**(metadata or {}), "withdrawal_id": withdrawal_id},
        "created_at": now_utc(),
        "completed_at": now_utc(),
    }
    try:
        await db.financial_ledger.insert_one(tx)
    except Exception:
        existing = await db.financial_ledger.find_one({"reference_id": reference_id})
        if existing:
            return existing
        raise
    # Denormalized balances
    if user_id and host_delta:
        try:
            await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"host_earnings": int(host_delta)}})
        except Exception:
            pass
    if agency_id and agency_delta:
        try:
            await db.agencies.update_one({"_id": ObjectId(agency_id)}, {"$inc": {"earnings": int(agency_delta)}})
        except Exception:
            pass
    return tx


def _public_withdrawal(doc: dict, *, admin: bool = False) -> dict:
    out = {
        "id": doc.get("withdrawal_id") or str(doc["_id"]),
        "withdrawal_id": doc.get("withdrawal_id"),
        "user_id": doc.get("user_id"),
        "agency_id": doc.get("agency_id"),
        "owner_type": doc.get("owner_type"),
        "amount_usd": int(doc.get("amount_usd", 0)),
        "amount_diamonds": int(doc.get("amount_diamonds", 0)),
        "exchange_rate": int(doc.get("exchange_rate", 1000)),
        "currency": doc.get("currency", "USD"),
        "status": doc.get("status"),
        "method": doc.get("method"),
        "method_label": _SUPPORTED_PAYOUT_METHODS.get(doc.get("method", ""), {}).get("label", doc.get("method")),
        "destination_hint": doc.get("destination_hint"),
        "external_reference": doc.get("external_reference"),
        "rejection_reason": doc.get("rejection_reason"),
        "failure_reason": doc.get("failure_reason"),
        "info_request": doc.get("info_request"),
        "requested_at": (doc["requested_at"].isoformat() if isinstance(doc.get("requested_at"), datetime) else doc.get("requested_at")),
        "review_start_at": (doc["review_start_at"].isoformat() if isinstance(doc.get("review_start_at"), datetime) else doc.get("review_start_at")),
        "review_ends_at": (doc["review_ends_at"].isoformat() if isinstance(doc.get("review_ends_at"), datetime) else doc.get("review_ends_at")),
        "processed_at": (doc["processed_at"].isoformat() if isinstance(doc.get("processed_at"), datetime) else doc.get("processed_at")),
        "paid_at": (doc["paid_at"].isoformat() if isinstance(doc.get("paid_at"), datetime) else doc.get("paid_at")),
        "returned_at": (doc["returned_at"].isoformat() if isinstance(doc.get("returned_at"), datetime) else doc.get("returned_at")),
    }
    if admin:
        snap = (doc.get("payout_method_snapshot") or {}).copy()
        # Full unmasked details for admin (needed to actually process the payout)
        out["payout_method_snapshot"] = snap
        out["admin_notes"] = doc.get("admin_notes") or []
    return out


# --- Public: supported methods ---------------------------------------------

@api.get("/payout/methods")
async def _supported_methods(user=Depends(current_user)):
    out = []
    for key, s in _SUPPORTED_PAYOUT_METHODS.items():
        out.append({
            "key": key,
            "label": s["label"],
            "required_fields": list(s["required"]),
            "optional_fields": list(s["optional"]),
            "network": s.get("network"),
        })
    return {"items": out}


@api.get("/withdrawal/config")
async def _get_withdrawal_config_public(user=Depends(current_user)):
    db = app.state.db
    return await _get_withdrawal_config(db)


# --- CRUD: payout methods --------------------------------------------------

class _PayoutMethodIn(BaseModel):
    method: str
    details: dict
    is_default: Optional[bool] = False


@api.get("/me/payout-methods")
async def _list_my_payout_methods(user=Depends(current_user)):
    db = app.state.db
    cur = db.payout_methods.find({"user_id": str(user["_id"])}).sort("created_at", -1)
    docs = await cur.to_list(100)
    return {"items": [_public_payout_method(d) for d in docs]}


@api.post("/me/payout-methods", status_code=201)
async def _add_my_payout_method(body: _PayoutMethodIn, user=Depends(current_user)):
    db = app.state.db
    details = _validate_payout_fields(body.method, body.details or {})
    now_t = now_utc()
    doc = {
        "user_id": str(user["_id"]),
        "method": body.method,
        "details": details,
        "display_hint": _display_hint(body.method, details),
        "is_default": False,  # set via explicit endpoint
        "verification_status": "unverified",
        "created_at": now_t, "updated_at": now_t,
    }
    # If the user has no methods yet, auto-mark as default.
    existing_count = await db.payout_methods.count_documents({"user_id": str(user["_id"])})
    if existing_count == 0 or body.is_default:
        doc["is_default"] = True
        # Need to demote any prior default FIRST to satisfy the unique index.
        await db.payout_methods.update_many(
            {"user_id": str(user["_id"]), "is_default": True}, {"$set": {"is_default": False}}
        )
    r = await db.payout_methods.insert_one(doc)
    await _audit(db, str(user["_id"]), "payout_method_added", "payout_method", str(r.inserted_id),
                 {"method": body.method})
    return _public_payout_method({**doc, "_id": r.inserted_id})


class _PayoutMethodPatch(BaseModel):
    details: Optional[dict] = None


@api.patch("/me/payout-methods/{pm_id}")
async def _patch_my_payout_method(pm_id: str, body: _PayoutMethodPatch, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(pm_id)
    except Exception:
        raise HTTPException(404, "Payout method not found")
    doc = await db.payout_methods.find_one({"_id": oid, "user_id": str(user["_id"])})
    if not doc:
        raise HTTPException(404, "Payout method not found")
    patch: dict = {"updated_at": now_utc()}
    if body.details is not None:
        details = _validate_payout_fields(doc["method"], body.details)
        patch["details"] = details
        patch["display_hint"] = _display_hint(doc["method"], details)
    await db.payout_methods.update_one({"_id": oid}, {"$set": patch})
    await _audit(db, str(user["_id"]), "payout_method_updated", "payout_method", pm_id, {})
    final = await db.payout_methods.find_one({"_id": oid})
    return _public_payout_method(final)


@api.delete("/me/payout-methods/{pm_id}")
async def _delete_my_payout_method(pm_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(pm_id)
    except Exception:
        raise HTTPException(404, "Payout method not found")
    # Block deletion if there are active withdrawals referencing this method.
    active_w = await db.withdrawals.count_documents({
        "user_id": str(user["_id"]), "payout_method_id": pm_id,
        "status": {"$in": list(_WITHDRAWAL_CANCELABLE | {"APPROVED", "PROCESSING"})},
    })
    if active_w:
        raise HTTPException(409, "Payout method is in use by an active withdrawal")
    r = await db.payout_methods.delete_one({"_id": oid, "user_id": str(user["_id"])})
    if r.deleted_count == 0:
        raise HTTPException(404, "Payout method not found")
    await _audit(db, str(user["_id"]), "payout_method_deleted", "payout_method", pm_id, {})
    return {"ok": True}


@api.post("/me/payout-methods/{pm_id}/default")
async def _set_default_payout_method(pm_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        oid = ObjectId(pm_id)
    except Exception:
        raise HTTPException(404, "Payout method not found")
    doc = await db.payout_methods.find_one({"_id": oid, "user_id": str(user["_id"])})
    if not doc:
        raise HTTPException(404, "Payout method not found")
    await db.payout_methods.update_many(
        {"user_id": str(user["_id"]), "is_default": True, "_id": {"$ne": oid}},
        {"$set": {"is_default": False, "updated_at": now_utc()}},
    )
    try:
        await db.payout_methods.update_one({"_id": oid}, {"$set": {"is_default": True, "updated_at": now_utc()}})
    except Exception as e:
        if "duplicate key" in str(e).lower():
            raise HTTPException(409, "Default conflict — retry")
        raise
    await _audit(db, str(user["_id"]), "payout_method_set_default", "payout_method", pm_id, {})
    return {"ok": True}


# --- Withdrawal creation ---------------------------------------------------

class _WithdrawIn(BaseModel):
    amount_usd: int
    payout_method_id: str
    idempotency_key: Optional[str] = None


async def _available_host_diamonds(db, user_id: str) -> int:
    agg = await _sum_ledger(db, {"user_id": user_id, "status": {"$in": ["completed", "refunded"]}})
    return int(agg["host"])


async def _available_agency_diamonds(db, agency_id: str) -> int:
    agg = await _sum_ledger(db, {"agency_id": agency_id, "status": {"$in": ["completed", "refunded"]}})
    return int(agg["agency"])


async def _create_withdrawal(
    db, *, user, body: _WithdrawIn, owner_type: str, agency_id: Optional[str] = None,
) -> dict:
    cfg = await _get_withdrawal_config(db)
    min_usd = cfg["minimum_withdrawal_usd"]
    max_usd = cfg["maximum_withdrawal_usd"]
    review_days = cfg["review_period_days"]
    rate = cfg["diamonds_per_usd"]
    if not isinstance(body.amount_usd, int) or body.amount_usd <= 0:
        raise HTTPException(400, "amount_usd must be a positive integer")
    if body.amount_usd < min_usd:
        raise HTTPException(400, f"Minimum withdrawal is ${min_usd} USD")
    if body.amount_usd > max_usd:
        raise HTTPException(400, f"Maximum withdrawal is ${max_usd} USD")
    # Exact-representability guard: with integer USD + integer rate the
    # product is always exact. This is a defensive explicit check — if a
    # future rate becomes non-integer, we refuse rather than silently round.
    diamonds_needed = int(body.amount_usd) * int(rate)
    if diamonds_needed // int(rate) != int(body.amount_usd) or diamonds_needed <= 0:
        raise HTTPException(400, "Amount cannot be represented exactly in diamonds")
    # Resolve payout method and ownership.
    try:
        pm_oid = ObjectId(body.payout_method_id)
    except Exception:
        raise HTTPException(404, "Payout method not found")
    pm = await db.payout_methods.find_one({"_id": pm_oid, "user_id": str(user["_id"])})
    if not pm:
        raise HTTPException(404, "Payout method not found")
    # Snapshot the method so later edits can't alter payout destination.
    snapshot = {
        "method": pm["method"],
        "details": pm.get("details") or {},
        "display_hint": pm.get("display_hint"),
    }
    # Balance check + reservation (compensating entry). We rely on the unique
    # reference_id to serialize concurrent reservations.
    now_t = now_utc()
    withdrawal_id = secrets.token_hex(12)
    reservation_ref = f"WDR::RSV::{withdrawal_id}"
    doc = {
        "withdrawal_id": withdrawal_id,
        "user_id": str(user["_id"]),
        "agency_id": agency_id,
        "owner_type": owner_type,
        "amount_usd": int(body.amount_usd),
        "amount_diamonds": int(diamonds_needed),
        "exchange_rate": int(rate),
        "currency": "USD",
        "status": "REQUESTED",
        "method": pm["method"],
        "payout_method_id": str(pm["_id"]),
        "payout_method_snapshot": snapshot,
        "destination_hint": pm.get("display_hint") or _display_hint(pm["method"], pm.get("details") or {}),
        "idempotency_key": (body.idempotency_key or None),
        "reservation_ledger_ref": reservation_ref,
        "compensating_ledger_ref": None,
        "external_reference": None,
        "rejection_reason": None, "failure_reason": None, "info_request": None,
        "admin_notes": [],
        "requested_at": now_t,
        "review_start_at": now_t,
        "review_ends_at": now_t + timedelta(days=review_days),
        "processed_at": None, "paid_at": None, "returned_at": None, "cancelled_at": None,
        "created_at": now_t, "updated_at": now_t,
    }
    # First, insert the withdrawal (idempotency unique index enforces no dupes).
    try:
        r = await db.withdrawals.insert_one(doc)
    except Exception as e:
        if "duplicate key" in str(e).lower():
            # Return the existing withdrawal with that idempotency key.
            prior = await db.withdrawals.find_one(
                {"user_id": str(user["_id"]), "idempotency_key": body.idempotency_key}
            )
            if prior:
                return _public_withdrawal(prior)
        raise
    # Reserve the diamonds — a NEGATIVE compensating ledger entry.
    try:
        if owner_type == "host":
            available = await _available_host_diamonds(db, str(user["_id"]))
            if available < diamonds_needed:
                # Not enough — roll back the withdrawal row.
                await db.withdrawals.delete_one({"_id": r.inserted_id})
                raise HTTPException(400, "Insufficient available earnings")
            await _record_withdrawal_ledger_tx(
                db, reference_id=reservation_ref,
                source="withdrawal_reserved",
                user_id=str(user["_id"]), agency_id=None,
                host_delta=-int(diamonds_needed), agency_delta=0,
                withdrawal_id=withdrawal_id, metadata={"amount_usd": body.amount_usd},
            )
            # Recheck available post-reservation; if negative, roll back.
            after = await _available_host_diamonds(db, str(user["_id"]))
            if after < 0:
                # Concurrent withdrawal reserved funds between our check and insert — compensate.
                comp_ref = f"WDR::CMP::ROLLBACK::{withdrawal_id}"
                await _record_withdrawal_ledger_tx(
                    db, reference_id=comp_ref, source="withdrawal_rollback",
                    user_id=str(user["_id"]), agency_id=None,
                    host_delta=int(diamonds_needed), agency_delta=0,
                    withdrawal_id=withdrawal_id, metadata={"reason": "race"},
                )
                await db.withdrawals.delete_one({"_id": r.inserted_id})
                raise HTTPException(409, "Insufficient available earnings (concurrent reservation)")
        else:
            if not agency_id:
                raise HTTPException(400, "agency_id required for agency withdrawal")
            available = await _available_agency_diamonds(db, agency_id)
            if available < diamonds_needed:
                await db.withdrawals.delete_one({"_id": r.inserted_id})
                raise HTTPException(400, "Insufficient available agency earnings")
            await _record_withdrawal_ledger_tx(
                db, reference_id=reservation_ref, source="withdrawal_reserved",
                user_id=str(user["_id"]), agency_id=agency_id,
                host_delta=0, agency_delta=-int(diamonds_needed),
                withdrawal_id=withdrawal_id, metadata={"amount_usd": body.amount_usd},
            )
            after = await _available_agency_diamonds(db, agency_id)
            if after < 0:
                comp_ref = f"WDR::CMP::ROLLBACK::{withdrawal_id}"
                await _record_withdrawal_ledger_tx(
                    db, reference_id=comp_ref, source="withdrawal_rollback",
                    user_id=str(user["_id"]), agency_id=agency_id,
                    host_delta=0, agency_delta=int(diamonds_needed),
                    withdrawal_id=withdrawal_id, metadata={"reason": "race"},
                )
                await db.withdrawals.delete_one({"_id": r.inserted_id})
                raise HTTPException(409, "Insufficient available agency earnings (concurrent reservation)")
    except HTTPException:
        raise
    except Exception as e:
        await db.withdrawals.delete_one({"_id": r.inserted_id})
        raise
    await _audit(db, str(user["_id"]), "withdrawal_requested", "withdrawal", withdrawal_id,
                 {"amount_usd": body.amount_usd, "owner_type": owner_type, "agency_id": agency_id})
    final = await db.withdrawals.find_one({"_id": r.inserted_id})
    return _public_withdrawal(final)


@api.post("/me/withdrawals", status_code=201)
async def _create_host_withdrawal(body: _WithdrawIn, user=Depends(current_user)):
    db = app.state.db
    return await _create_withdrawal(db, user=user, body=body, owner_type="host")


class _AgencyWithdrawIn(BaseModel):
    amount_usd: int
    payout_method_id: str
    idempotency_key: Optional[str] = None


@api.post("/agencies/{agency_id}/withdrawals", status_code=201)
async def _create_agency_withdrawal(agency_id: str, body: _AgencyWithdrawIn, user=Depends(current_user)):
    db = app.state.db
    # Only the agency OWNER (or admin) can request withdrawals from the agency balance.
    a = await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    return await _create_withdrawal(
        db, user=user, body=_WithdrawIn(**body.model_dump()),
        owner_type="agency", agency_id=str(a["_id"]),
    )


# --- Withdrawal read -------------------------------------------------------

@api.get("/me/withdrawals")
async def _list_my_withdrawals(user=Depends(current_user), limit: int = 100):
    db = app.state.db
    limit = max(1, min(int(limit or 100), 200))
    cur = db.withdrawals.find({"user_id": str(user["_id"])}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    return {"items": [_public_withdrawal(it) for it in items]}


@api.get("/me/withdrawals/{wid}")
async def _get_my_withdrawal(wid: str, user=Depends(current_user)):
    db = app.state.db
    doc = await db.withdrawals.find_one({"withdrawal_id": wid, "user_id": str(user["_id"])})
    if not doc:
        raise HTTPException(404, "Withdrawal not found")
    return _public_withdrawal(doc)


@api.post("/me/withdrawals/{wid}/cancel")
async def _cancel_my_withdrawal(wid: str, user=Depends(current_user)):
    db = app.state.db
    doc = await db.withdrawals.find_one({"withdrawal_id": wid, "user_id": str(user["_id"])})
    if not doc:
        raise HTTPException(404, "Withdrawal not found")
    if doc["status"] not in _WITHDRAWAL_CANCELABLE:
        raise HTTPException(409, f"Cannot cancel while status is {doc['status']}")
    # Atomic status flip, then compensating ledger entry.
    r = await db.withdrawals.find_one_and_update(
        {"_id": doc["_id"], "status": {"$in": list(_WITHDRAWAL_CANCELABLE)}},
        {"$set": {"status": "CANCELLED", "cancelled_at": now_utc(), "updated_at": now_utc()}},
    )
    if not r:
        raise HTTPException(409, "Status changed, retry")
    comp_ref = f"WDR::CMP::CANCEL::{wid}"
    await _record_withdrawal_ledger_tx(
        db, reference_id=comp_ref, source="withdrawal_cancelled",
        user_id=doc.get("user_id") if doc.get("owner_type") == "host" else doc.get("user_id"),
        agency_id=doc.get("agency_id") if doc.get("owner_type") == "agency" else None,
        host_delta=int(doc["amount_diamonds"]) if doc.get("owner_type") == "host" else 0,
        agency_delta=int(doc["amount_diamonds"]) if doc.get("owner_type") == "agency" else 0,
        withdrawal_id=wid, metadata={"reason": "user_cancelled"},
    )
    await db.withdrawals.update_one(
        {"_id": doc["_id"]},
        {"$set": {"compensating_ledger_ref": comp_ref}},
    )
    await _audit(db, str(user["_id"]), "withdrawal_cancelled", "withdrawal", wid, {})
    return {"ok": True}


# --- Agency owner views ----------------------------------------------------

@api.get("/agencies/{agency_id}/withdrawals")
async def _list_agency_withdrawals(agency_id: str, user=Depends(current_user), limit: int = 100):
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    limit = max(1, min(int(limit or 100), 200))
    cur = db.withdrawals.find({"agency_id": agency_id, "owner_type": "agency"}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    return {"items": [_public_withdrawal(it) for it in items]}


# --- Admin: Withdrawal Center ---------------------------------------------

async def _get_withdrawal_or_404(db, wid: str) -> dict:
    doc = await db.withdrawals.find_one({"withdrawal_id": wid})
    if not doc:
        raise HTTPException(404, "Withdrawal not found")
    return doc


async def _admin_transition(db, user, wid: str, from_statuses: set, to_status: str,
                            patch: dict, audit_action: str, meta: Optional[dict] = None):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    full_patch = {**patch, "status": to_status, "updated_at": now_utc()}
    r = await db.withdrawals.find_one_and_update(
        {"withdrawal_id": wid, "status": {"$in": list(from_statuses)}},
        {"$set": full_patch},
        return_document=False,
    )
    if not r:
        current = await db.withdrawals.find_one({"withdrawal_id": wid}, {"status": 1})
        if not current:
            raise HTTPException(404, "Withdrawal not found")
        raise HTTPException(409, f"Cannot transition from {current['status']} to {to_status}")
    await _audit(db, str(user["_id"]), audit_action, "withdrawal", wid, meta or {})
    final = await db.withdrawals.find_one({"withdrawal_id": wid})
    return final


@api.get("/admin/withdrawals")
async def _admin_list_withdrawals(user=Depends(current_user), status: Optional[str] = None,
                                  owner_type: Optional[str] = None, limit: int = 100):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = app.state.db
    q: dict = {}
    if status: q["status"] = status
    if owner_type: q["owner_type"] = owner_type
    limit = max(1, min(int(limit or 100), 500))
    cur = db.withdrawals.find(q).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    return {"items": [_public_withdrawal(it, admin=True) for it in items]}


@api.get("/admin/withdrawals/{wid}")
async def _admin_get_withdrawal(wid: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = app.state.db
    doc = await _get_withdrawal_or_404(db, wid)
    return _public_withdrawal(doc, admin=True)


class _AdminActionIn(BaseModel):
    reason: Optional[str] = None
    note: Optional[str] = None


@api.post("/admin/withdrawals/{wid}/review")
async def _admin_review(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    db = app.state.db
    doc = await _admin_transition(
        db, user, wid, {"REQUESTED"}, "UNDER_REVIEW",
        {}, "withdrawal_under_review",
    )
    return _public_withdrawal(doc, admin=True)


@api.post("/admin/withdrawals/{wid}/hold")
async def _admin_hold(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    db = app.state.db
    doc = await _admin_transition(
        db, user, wid, {"REQUESTED", "UNDER_REVIEW", "NEEDS_INFORMATION"}, "HOLD",
        {}, "withdrawal_hold", {"reason": body.reason},
    )
    return _public_withdrawal(doc, admin=True)


@api.post("/admin/withdrawals/{wid}/request-info")
async def _admin_request_info(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    db = app.state.db
    doc = await _admin_transition(
        db, user, wid, {"REQUESTED", "UNDER_REVIEW", "HOLD"}, "NEEDS_INFORMATION",
        {"info_request": body.reason or body.note or "Additional information required"},
        "withdrawal_request_info",
    )
    return _public_withdrawal(doc, admin=True)


@api.post("/admin/withdrawals/{wid}/approve")
async def _admin_approve(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = app.state.db
    # Must honour review period
    cur = await _get_withdrawal_or_404(db, wid)
    review_ends = cur.get("review_ends_at")
    if review_ends:
        # Mongo may return naive datetimes; normalize to tz-aware UTC.
        if isinstance(review_ends, datetime) and review_ends.tzinfo is None:
            review_ends = review_ends.replace(tzinfo=timezone.utc)
        if now_utc() < review_ends:
            raise HTTPException(400, "Review period has not elapsed yet")
    doc = await _admin_transition(
        db, user, wid, {"REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION"},
        "APPROVED",
        {}, "withdrawal_approved",
    )
    return _public_withdrawal(doc, admin=True)


class _RejectIn(BaseModel):
    reason: str


@api.post("/admin/withdrawals/{wid}/reject")
async def _admin_reject(wid: str, body: _RejectIn, user=Depends(current_user)):
    db = app.state.db
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(400, "reason is required")
    doc = await _admin_transition(
        db, user, wid, {"REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION", "APPROVED"},
        "REJECTED", {"rejection_reason": reason},
        "withdrawal_rejected", {"reason": reason},
    )
    # Compensate — restore the reserved diamonds to the user.
    comp_ref = f"WDR::CMP::REJECT::{wid}"
    await _record_withdrawal_ledger_tx(
        db, reference_id=comp_ref, source="withdrawal_rejected",
        user_id=doc["user_id"] if doc["owner_type"] == "host" else doc["user_id"],
        agency_id=doc["agency_id"] if doc["owner_type"] == "agency" else None,
        host_delta=int(doc["amount_diamonds"]) if doc["owner_type"] == "host" else 0,
        agency_delta=int(doc["amount_diamonds"]) if doc["owner_type"] == "agency" else 0,
        withdrawal_id=wid, metadata={"reason": reason},
    )
    await db.withdrawals.update_one({"withdrawal_id": wid}, {"$set": {"compensating_ledger_ref": comp_ref}})
    return _public_withdrawal(await db.withdrawals.find_one({"withdrawal_id": wid}), admin=True)


@api.post("/admin/withdrawals/{wid}/start-processing")
async def _admin_start_processing(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    db = app.state.db
    doc = await _admin_transition(
        db, user, wid, {"APPROVED"}, "PROCESSING",
        {"processed_at": now_utc()}, "withdrawal_processing",
    )
    return _public_withdrawal(doc, admin=True)


class _MarkPaidIn(BaseModel):
    external_reference: str
    note: Optional[str] = None


@api.post("/admin/withdrawals/{wid}/mark-paid")
async def _admin_mark_paid(wid: str, body: _MarkPaidIn, user=Depends(current_user)):
    db = app.state.db
    ext = (body.external_reference or "").strip()
    if not ext:
        raise HTTPException(400, "external_reference is required to mark PAID")
    doc = await _admin_transition(
        db, user, wid, {"PROCESSING"}, "PAID",
        {"paid_at": now_utc(), "external_reference": ext},
        "withdrawal_paid", {"external_reference": ext},
    )
    # No ledger movement — the reservation already debited the balance. We
    # add an audit-only ledger row with amount 0 for transparency.
    audit_ref = f"WDR::PAID::{wid}"
    try:
        existing = await db.financial_ledger.find_one({"reference_id": audit_ref})
        if not existing:
            await db.financial_ledger.insert_one({
                "transaction_id": secrets.token_hex(12), "reference_id": audit_ref,
                "user_id": doc["user_id"], "agency_id": doc.get("agency_id"),
                "type": "withdrawal", "status": "completed",
                "gross_amount": 0, "host_amount": 0, "agency_amount": 0, "orio_amount": 0,
                "currency": "diamonds", "source": "withdrawal_paid",
                "metadata": {"withdrawal_id": wid, "external_reference": ext},
                "created_at": now_utc(), "completed_at": now_utc(),
            })
    except Exception:
        pass
    return _public_withdrawal(doc, admin=True)


class _FailIn(BaseModel):
    reason: str


@api.post("/admin/withdrawals/{wid}/mark-failed")
async def _admin_mark_failed(wid: str, body: _FailIn, user=Depends(current_user)):
    db = app.state.db
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(400, "reason is required")
    doc = await _admin_transition(
        db, user, wid, {"PROCESSING"}, "FAILED",
        {"failure_reason": reason}, "withdrawal_failed", {"reason": reason},
    )
    # FAILED does NOT auto-return funds; admin must explicitly mark RETURNED
    # if the external money actually came back.
    return _public_withdrawal(doc, admin=True)


@api.post("/admin/withdrawals/{wid}/mark-returned")
async def _admin_mark_returned(wid: str, body: _AdminActionIn, user=Depends(current_user)):
    db = app.state.db
    doc = await _admin_transition(
        db, user, wid, {"FAILED", "PAID"}, "RETURNED",
        {"returned_at": now_utc()}, "withdrawal_returned",
    )
    comp_ref = f"WDR::CMP::RETURN::{wid}"
    await _record_withdrawal_ledger_tx(
        db, reference_id=comp_ref, source="withdrawal_returned",
        user_id=doc["user_id"] if doc["owner_type"] == "host" else doc["user_id"],
        agency_id=doc["agency_id"] if doc["owner_type"] == "agency" else None,
        host_delta=int(doc["amount_diamonds"]) if doc["owner_type"] == "host" else 0,
        agency_delta=int(doc["amount_diamonds"]) if doc["owner_type"] == "agency" else 0,
        withdrawal_id=wid, metadata={"reason": body.reason or "returned"},
    )
    await db.withdrawals.update_one({"withdrawal_id": wid}, {"$set": {"compensating_ledger_ref": comp_ref}})
    return _public_withdrawal(await db.withdrawals.find_one({"withdrawal_id": wid}), admin=True)


# --- Admin config ----------------------------------------------------------

class _WithdrawalCfgIn(BaseModel):
    minimum_withdrawal_usd: Optional[int] = None
    maximum_withdrawal_usd: Optional[int] = None
    review_period_days: Optional[int] = None
    diamonds_per_usd: Optional[int] = None
    reason: Optional[str] = None


@api.get("/admin/withdrawal-config")
async def _admin_get_withdrawal_config(user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = app.state.db
    return await _get_withdrawal_config(db)


@api.patch("/admin/withdrawal-config")
async def _admin_patch_withdrawal_config(body: _WithdrawalCfgIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = app.state.db
    patch: dict = {}
    if body.minimum_withdrawal_usd is not None:
        if body.minimum_withdrawal_usd < 1 or body.minimum_withdrawal_usd > 100_000:
            raise HTTPException(400, "minimum_withdrawal_usd out of range")
        patch["minimum_withdrawal_usd"] = int(body.minimum_withdrawal_usd)
    if body.maximum_withdrawal_usd is not None:
        if body.maximum_withdrawal_usd < 1 or body.maximum_withdrawal_usd > 1_000_000:
            raise HTTPException(400, "maximum_withdrawal_usd out of range")
        patch["maximum_withdrawal_usd"] = int(body.maximum_withdrawal_usd)
    if body.review_period_days is not None:
        if body.review_period_days < 0 or body.review_period_days > 90:
            raise HTTPException(400, "review_period_days out of range")
        patch["review_period_days"] = int(body.review_period_days)
    if body.diamonds_per_usd is not None:
        if body.diamonds_per_usd < 1 or body.diamonds_per_usd > 1_000_000:
            raise HTTPException(400, "diamonds_per_usd out of range")
        patch["diamonds_per_usd"] = int(body.diamonds_per_usd)
    if not patch:
        raise HTTPException(400, "No changes")
    patch["updated_at"] = now_utc()
    await db.config.update_one({"_id": "withdrawal_config"}, {"$set": patch}, upsert=True)
    await _audit(db, str(user["_id"]), "withdrawal_config_updated", "config", "withdrawal_config",
                 {"patch": patch, "reason": body.reason})
    return await _get_withdrawal_config(db)


# ---- End Iter-40 Phase-2B -------------------------------------------------


# ============================================================================
# Iter-41 / Agency Join Requests (user-initiated) + Agency ID lookup
# ============================================================================


@api.get("/agency-search")
async def _agency_lookup(id: str, user=Depends(current_user)):
    """Lookup an agency by its exact string ID. Returns the public summary
    plus whether the caller already has a pending join request for it.
    Returns 404 when no such active agency exists — never a fabricated
    result."""
    db = app.state.db
    ident = (id or "").strip()
    if not ident:
        raise HTTPException(400, "Missing agency id")
    try:
        a = await db.agencies.find_one({"_id": ObjectId(ident)})
    except Exception:
        a = None
    if not a:
        raise HTTPException(404, "No agency found with this ID")
    if a.get("status") != "active":
        raise HTTPException(404, "No agency found with this ID")
    uid = str(user["_id"])
    # Already an active member? Pending request? Expose this so the UI
    # renders the right action label.
    membership = await db.agency_memberships.find_one(
        {"agency_id": str(a["_id"]), "user_id": uid, "status": "active"}
    )
    pending = await db.agency_invitations.find_one(
        {"agency_id": str(a["_id"]), "user_id": uid, "status": "pending"}
    )
    return {
        "agency": _public_agency(a),
        "my_membership_status": "active" if membership else None,
        "pending_request_id": str(pending["_id"]) if pending else None,
    }


class _JoinRequestIn(BaseModel):
    message: Optional[str] = None


@api.post("/agencies/{agency_id}/join-request", status_code=201)
async def _create_join_request(agency_id: str, body: Optional[_JoinRequestIn] = None, user=Depends(current_user)):
    """User-initiated application to join an agency. Creates a PENDING
    `agency_invitations` row where `invited_by == user_id` and
    `request_type == "user_request"`. The agency owner must then approve
    or reject; the user is NOT a member until approval."""
    db = app.state.db
    uid = str(user["_id"])
    try:
        a = await db.agencies.find_one({"_id": ObjectId(agency_id)})
    except Exception:
        a = None
    if not a or a.get("status") != "active":
        raise HTTPException(404, "No agency found with this ID")
    # Already an active member of ANY agency?
    existing = await db.agency_memberships.find_one({"user_id": uid, "status": "active"})
    if existing:
        if existing.get("agency_id") == agency_id:
            raise HTTPException(409, "You are already a member of this agency")
        raise HTTPException(409, "You already belong to another active agency")
    now_t = now_utc()
    doc = {
        "agency_id": agency_id,
        "user_id": uid,
        "invited_by": uid,
        "request_type": "user_request",
        "status": "pending",
        "message": ((body.message if body else None) or "").strip()[:280] or None,
        "created_at": now_t, "updated_at": now_t, "responded_at": None,
    }
    try:
        r = await db.agency_invitations.insert_one(doc)
    except Exception as e:
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "A join request is already pending for this agency")
        raise
    await _audit(db, uid, "agency_join_request_created", "invitation", str(r.inserted_id),
                 {"agency_id": agency_id})
    return _public_invitation({**doc, "_id": r.inserted_id})


@api.get("/me/join-requests")
async def _my_join_requests(user=Depends(current_user)):
    """List the caller's own pending join requests across all agencies."""
    db = app.state.db
    uid = str(user["_id"])
    cur = db.agency_invitations.find({
        "user_id": uid, "invited_by": uid,
        "request_type": "user_request", "status": "pending",
    }).sort("created_at", -1)
    rows = await cur.to_list(100)
    out = []
    for inv in rows:
        agency = None
        try:
            a = await db.agencies.find_one({"_id": ObjectId(inv["agency_id"])})
            if a:
                agency = _public_agency(a)
        except Exception:
            pass
        out.append(_public_invitation(inv, {"agency": agency}))
    return {"items": out}


@api.delete("/me/join-requests/{inv_id}")
async def _cancel_my_join_request(inv_id: str, user=Depends(current_user)):
    """User cancels their own PENDING join request."""
    db = app.state.db
    try:
        oid = ObjectId(inv_id)
    except Exception:
        raise HTTPException(404, "Request not found")
    r = await db.agency_invitations.find_one_and_update(
        {"_id": oid, "user_id": str(user["_id"]), "invited_by": str(user["_id"]),
         "request_type": "user_request", "status": "pending"},
        {"$set": {"status": "cancelled", "updated_at": now_utc(), "responded_at": now_utc()}},
    )
    if not r:
        raise HTTPException(404, "Pending request not found")
    await _audit(db, str(user["_id"]), "agency_join_request_cancelled", "invitation", inv_id, {})
    return {"ok": True}


@api.post("/agencies/{agency_id}/join-requests/{inv_id}/approve")
async def _owner_approve_join_request(agency_id: str, inv_id: str, user=Depends(current_user)):
    """Owner (or admin) approves a user-initiated join request. Creates
    the active membership via the SAME race-safe path as `_add_host`."""
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    try:
        oid = ObjectId(inv_id)
    except Exception:
        raise HTTPException(404, "Request not found")
    inv = await db.agency_invitations.find_one({
        "_id": oid, "agency_id": agency_id,
        "request_type": "user_request", "status": "pending",
    })
    if not inv:
        raise HTTPException(404, "Pending request not found")
    uid = inv["user_id"]
    # DB-level enforcement of one-active-agency rule via uniq_active_user.
    now_t = now_utc()
    try:
        await db.agency_memberships.insert_one({
            "agency_id": agency_id, "user_id": uid, "role": "HOST",
            "status": "active", "joined_at": now_t,
            "created_at": now_t, "updated_at": now_t,
        })
    except Exception as e:
        if "duplicate key" in str(e).lower() or e.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(409, "User already belongs to another active agency")
        raise
    await db.agency_invitations.update_one(
        {"_id": oid, "status": "pending"},
        {"$set": {"status": "accepted", "updated_at": now_t, "responded_at": now_t,
                  "responded_by": str(user["_id"])}},
    )
    await _audit(db, str(user["_id"]), "agency_join_request_approved", "invitation", inv_id,
                 {"agency_id": agency_id, "user_id": uid})
    return {"ok": True}


@api.post("/agencies/{agency_id}/join-requests/{inv_id}/reject")
async def _owner_reject_join_request(agency_id: str, inv_id: str, user=Depends(current_user)):
    """Owner (or admin) rejects a user-initiated join request."""
    db = app.state.db
    await _resolve_agency_or_403(db, user, agency_id, require_owner=True)
    try:
        oid = ObjectId(inv_id)
    except Exception:
        raise HTTPException(404, "Request not found")
    r = await db.agency_invitations.find_one_and_update(
        {"_id": oid, "agency_id": agency_id,
         "request_type": "user_request", "status": "pending"},
        {"$set": {"status": "rejected", "updated_at": now_utc(),
                  "responded_at": now_utc(), "responded_by": str(user["_id"])}},
    )
    if not r:
        raise HTTPException(404, "Pending request not found")
    await _audit(db, str(user["_id"]), "agency_join_request_rejected", "invitation", inv_id,
                 {"agency_id": agency_id})
    return {"ok": True}


# ---- End Iter-41 ---------------------------------------------------------




async def _load_vip_thresholds() -> list[dict]:
    """Server-authoritative VIP thresholds. Admin-editable via /admin/vip/thresholds."""
    doc = await app.state.db.config.find_one({"_id": "vip_thresholds"})
    if doc and isinstance(doc.get("thresholds"), list):
        # Sanity check
        valid = [t for t in doc["thresholds"] if isinstance(t, dict) and "level" in t and "threshold" in t]
        if len(valid) == VIP_MAX_LEVEL:
            return sorted(valid, key=lambda x: x["level"])
    return VIP_PROGRESSION_THRESHOLDS


class _ThresholdsIn(BaseModel):
    thresholds: list[dict]


@api.get("/vip/thresholds")
async def _vip_thresholds():
    return {"thresholds": await _load_vip_thresholds()}


@api.patch("/admin/vip/thresholds")
async def _admin_set_thresholds(body: _ThresholdsIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    # validate: exactly 10 levels, strictly increasing, positive ints
    rows = sorted([{"level": int(t["level"]), "threshold": int(t["threshold"])} for t in body.thresholds], key=lambda x: x["level"])
    if [r["level"] for r in rows] != list(range(1, VIP_MAX_LEVEL + 1)):
        raise HTTPException(400, "Provide thresholds for exactly VIP 1..10")
    prev = 0
    for r in rows:
        if r["threshold"] <= prev:
            raise HTTPException(400, "Thresholds must be strictly increasing and positive")
        prev = r["threshold"]
    await app.state.db.config.update_one(
        {"_id": "vip_thresholds"},
        {"$set": {"thresholds": rows, "updated_by": str(user["_id"]), "updated_at": now_utc()}},
        upsert=True,
    )
    return {"ok": True, "thresholds": rows}


@api.get("/vip/progress")
async def _vip_progress(user=Depends(current_user)):
    """VIP progression via server-tracked Growth Points (1 Diamond = 1 GP).
    Also lazily runs the 30-day maintenance cycle (iter-55) so stale sessions
    see the server-authoritative current level + remaining days + maintenance
    delta without needing a cron."""
    # Run maintenance first so downstream calculations use the fresh level.
    maint = await _vip_maintenance_cycle(user["_id"])
    growth = int(maint.get("growth_points", user.get("growth_points", 0)) or 0)
    thresholds = await _load_vip_thresholds()
    # Iter-133 — VIP progress = lifetime successfully-RECHARGED Diamonds only.
    fresh = await app.state.db.users.find_one({"_id": user["_id"]}, {"recharged_diamonds": 1, "vip_level": 1})
    recharged = int((fresh or {}).get("recharged_diamonds", 0) or 0)
    # Unlock any tier reached by recharges (never downgrades).
    await _maybe_activate_vip(user["_id"], recharged, int(maint.get("level", 0) or 0))
    maint_level = int(maint.get("level", 0) or 0)
    fresh2 = await app.state.db.users.find_one({"_id": user["_id"]}, {"vip_level": 1})
    level = max(maint_level, int((fresh2 or {}).get("vip_level", 0) or 0))

    qualified = 0
    for t in thresholds:
        if recharged >= t["threshold"]:
            qualified = t["level"]
    # Next level to unlock = first tier above BOTH the current and qualified level.
    top = max(level, qualified)
    next_t = next((t for t in thresholds if t["level"] > top), None)
    current_floor = thresholds[qualified - 1]["threshold"] if qualified >= 1 else 0
    if next_t:
        span = max(1, next_t["threshold"] - current_floor)
        progress = max(0.0, min(1.0, (recharged - current_floor) / span))
        remaining = max(0, next_t["threshold"] - recharged)
    else:
        progress = 1.0
        remaining = 0

    return {
        "level": level,
        "qualified_level": qualified,
        "growth_points": growth,
        "recharged_diamonds": recharged,
        # Per-level remaining (threshold − lifetime recharged), 0 once unlocked.
        "levels": [
            {"level": t["level"], "threshold": t["threshold"],
             "remaining": 0 if (level >= t["level"] or recharged >= t["threshold"]) else t["threshold"] - recharged,
             "unlocked": level >= t["level"] or recharged >= t["threshold"]}
            for t in thresholds
        ],
        "spent": recharged,
        "current_floor": current_floor,
        "next_level": next_t["level"] if next_t else None,
        "next_threshold": next_t["threshold"] if next_t else None,
        "remaining": remaining,
        "progress": progress,
        "thresholds": thresholds,
        # Iter-55 maintenance snapshot
        "vip_expires_at": maint.get("vip_expires_at"),
        "remaining_days": maint.get("remaining_days", 0),
        "maintenance_threshold": maint.get("maintenance_threshold", 0),
        "maintenance_remaining": maint.get("maintenance_remaining", 0),
        "maintenance_requirements": [
            {"level": lvl, "threshold": thr}
            for lvl, thr in sorted(VIP_MAINTENANCE_REQUIREMENTS.items())
        ],
    }


# ---------- Diamond → Growth Point conversion (server-authoritative) ----------
class _ConvertIn(BaseModel):
    amount: int = Field(ge=1, le=10_000_000_000)


@api.post("/vip/convert")
async def _vip_convert(body: _ConvertIn, user=Depends(current_user)):
    """Atomic 1:1 Diamond → Growth Point conversion. Also writes an immutable
    growth_ledger record and auto-activates any newly-crossed VIP tier.

    IMPORTANT: the user's Diamond wallet is stored on the `coins` field (that's
    the same field `/wallet/recharge` credits and the field the wallet screen
    displays). We deduct from `coins` so the wallet balance shown to the user
    is the single source of truth.
    """
    db = app.state.db
    amount = int(body.amount)
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    updated = await db.users.find_one_and_update(
        {"_id": user["_id"], "coins": {"$gte": amount}},
        {"$inc": {"coins": -amount, "growth_points": amount * 2}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(402, "Insufficient diamonds")

    tx_id = secrets.token_hex(10)
    now_t = now_utc()
    new_bal = int(updated.get("coins", 0))
    new_gp = int(updated.get("growth_points", 0))
    growth_awarded = amount * 2  # Iter-64: exchange rate is 1 Diamond = 2 GP.
    await db.wallet_transactions.insert_one({
        "user_id": str(user["_id"]),
        "type": "growth_point_conversion",
        "currency": "diamonds",
        "amount": -amount,
        "reference_id": tx_id,
        "tx_id": tx_id,
        "description": f"Exchanged {amount:,} diamonds for {growth_awarded:,} growth points",
        "status": "completed",
        "growth_points_awarded": growth_awarded,
        "balance_after": new_bal,
        "created_at": now_t,
    })
    await db.growth_ledger.insert_one({
        "user_id": str(user["_id"]),
        "tx_id": tx_id,
        "source": "conversion",
        "amount": growth_awarded,
        "diamonds_spent": amount,
        "diamonds_after": new_bal,
        "growth_after": new_gp,
        "created_at": now_t,
    })
    # Iter-133: Growth Points no longer count toward VIP (recharges only).
    new_level = int(updated.get("vip_level", 0) or 0)
    return {
        "ok": True,
        "tx_id": tx_id,
        "converted": amount,
        "diamonds": new_bal,
        "coins": new_bal,
        "growth_points": new_gp,
        "growth_points_awarded": growth_awarded,
        "vip_level": new_level,
    }


async def _maybe_activate_vip(user_oid, growth_points: int, current_level: int) -> int:
    """Server-authoritative: if the user's lifetime RECHARGED Diamonds
    (Iter-133; arg kept positional) cross a tier threshold, bump vip_level to
    the highest qualifying tier and log to growth_ledger. Never downgrades."""
    thresholds = await _load_vip_thresholds()
    eligible = max((t["level"] for t in thresholds if int(growth_points) >= int(t["threshold"])), default=0)
    if eligible > int(current_level or 0):
        res = await app.state.db.users.update_one(
            {"_id": user_oid, "$or": [{"vip_level": {"$lt": eligible}}, {"vip_level": {"$exists": False}}]},
            {"$set": {"vip_level": eligible, "vip_activated_at": now_utc()}},
        )
        if res.modified_count == 0:
            return eligible
        await _grant_vip_entrances(app.state.db, {"_id": user_oid, "vip_level": eligible})
        try:
            await _sys_notify(app.state.db, str(user_oid), "vip_up", {"level": eligible}, {"type": "vip"},
                              f"Congratulations on reaching VIP{eligible}",
                              dedup_key=f"vip:{user_oid}:{eligible}:{now_utc().strftime('%Y%m%d')}")
        except Exception:
            pass
        await app.state.db.growth_ledger.insert_one({
            "user_id": str(user_oid),
            "tx_id": secrets.token_hex(10),
            "source": "vip_activation",
            "amount": 0,
            "growth_after": int(growth_points),
            "from_level": int(current_level or 0),
            "to_level": eligible,
            "created_at": now_utc(),
        })
        return eligible
    return int(current_level or 0)


@api.get("/vip/growth-history")
async def _vip_growth_history(user=Depends(current_user), limit: int = 100):
    """Real Growth Point history — recharges, conversions, VIP activations."""
    db = app.state.db
    limit = max(1, min(int(limit or 100), 200))
    cur = db.growth_ledger.find({"user_id": str(user["_id"])}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cur.to_list(limit)
    for it in items:
        ca = it.get("created_at")
        if isinstance(ca, datetime):
            it["created_at"] = ca.isoformat()
    return {"items": items}


# ============================================================================
# ITER-55 — VIP Maintenance (30-day cycle + single-level downgrade)
# ----------------------------------------------------------------------------
# Business rules (user-authoritative, iter-55):
#   * VIP duration is exactly 30 days.
#   * At end of a 30-day cycle:
#       - VIP 1 and VIP 2 have NO maintenance requirement — they auto-renew.
#       - VIP 3..7 require >= MAINT[level] growth_points to renew.
#       - If the user does not meet the requirement, downgrade by EXACTLY one
#         level and start a fresh 30-day cycle at the new (lower) level.
#   * Checking is lazy — performed every time the user hits /vip/progress or
#     /auth/me, so no cron is required. All timestamps are UTC.
# ============================================================================
VIP_MAINTENANCE_REQUIREMENTS = {
    1: 0,
    2: 0,
    3: 500_000,
    4: 1_500_000,
    5: 3_500_000,
    6: 7_500_000,
    7: 15_000_000,
    # Iter-133: VIP8–10 use the same rule as VIP7.
    8: 15_000_000,
    9: 15_000_000,
    10: 15_000_000,
}

# Iter-64: hidden per-cycle Diamond-recharge requirements for VIP 1 and 2.
# These are NOT exposed via the public /vip/maintenance endpoint response and
# NOT prominently shown in the VIP Guide — see spec. VIP 3..7 continue to use
# Growth Points from VIP_MAINTENANCE_REQUIREMENTS above.
VIP_RECHARGE_MAINTENANCE = {
    1: 50_000,
    2: 250_000,
}


async def _diamonds_recharged_in_cycle(user_oid, cycle_start: datetime) -> int:
    """Sum of real Diamond recharges credited to this user since `cycle_start`.
    Reads from the immutable growth_ledger (source='recharge') which is written
    atomically on /wallet/recharge and admin recharge-agent verification.
    """
    db = app.state.db
    pipeline = [
        {"$match": {
            "user_id": str(user_oid),
            "source": "recharge",
            "created_at": {"$gte": cycle_start},
        }},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]
    cur = db.growth_ledger.aggregate(pipeline)
    rows = await cur.to_list(1)
    if not rows:
        return 0
    return int(rows[0].get("total", 0) or 0)



async def _vip_maintenance_cycle(user_oid, now: Optional[datetime] = None) -> dict:
    """Lazy maintenance evaluator. Downgrades VIP by one level if the 30-day
    cycle has expired AND the user has not met the maintenance threshold.

    Returns a fresh snapshot: {level, vip_expires_at, growth_points,
                               maintenance_threshold, maintenance_remaining,
                               remaining_days}
    """
    db = app.state.db
    now = now or now_utc()
    u = await db.users.find_one(
        {"_id": user_oid},
        {"vip_level": 1, "vip_expires_at": 1, "growth_points": 1},
    )
    if not u:
        return {"level": 0, "vip_expires_at": None, "growth_points": 0,
                "maintenance_threshold": 0, "maintenance_remaining": 0,
                "remaining_days": 0}

    level = int(u.get("vip_level", 0) or 0)
    expires = u.get("vip_expires_at")
    gp = int(u.get("growth_points", 0) or 0)

    # If the user has no active VIP, nothing to maintain.
    if level <= 0:
        return {"level": 0, "vip_expires_at": None, "growth_points": gp,
                "maintenance_threshold": 0, "maintenance_remaining": 0,
                "remaining_days": 0}

    # Normalize timezone.
    if isinstance(expires, datetime) and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    # Only cycle when the 30-day window has elapsed.
    while isinstance(expires, datetime) and expires <= now and level >= 1:
        # Iter-64: VIP1 and VIP2 are maintained by Diamond RECHARGE in the
        # just-ended 30-day cycle (hidden from public UI). VIP3..7 use growth
        # points as before.
        cycle_start = expires - timedelta(days=30)
        if level in VIP_RECHARGE_MAINTENANCE:
            required = VIP_RECHARGE_MAINTENANCE[level]
            diamonds_in_cycle = await _diamonds_recharged_in_cycle(user_oid, cycle_start)
            meets = diamonds_in_cycle >= required
            maint_source = "diamonds"
            maint_actual = diamonds_in_cycle
        else:
            required = VIP_MAINTENANCE_REQUIREMENTS.get(level, 0)
            meets = gp >= required
            maint_source = "growth_points"
            maint_actual = gp

        if meets:
            # Auto-renew at the current level — fresh 30-day cycle.
            new_expires = now + timedelta(days=30)
            await db.users.update_one(
                {"_id": user_oid},
                {"$set": {"vip_expires_at": new_expires}},
            )
            await db.growth_ledger.insert_one({
                "user_id": str(user_oid),
                "tx_id": secrets.token_hex(10),
                "source": "vip_maintain",
                "amount": 0,
                "growth_after": gp,
                "from_level": level,
                "to_level": level,
                "maintenance_source": maint_source,
                "maintenance_actual": maint_actual,
                "maintenance_required": required,
                "created_at": now,
            })
            expires = new_expires
            break
        # Downgrade exactly one level, fresh 30-day cycle at the new tier.
        # When VIP1 fails maintenance, VIP status expires (level→0).
        new_level = level - 1
        new_expires = now + timedelta(days=30) if new_level >= 1 else None
        await db.users.update_one(
            {"_id": user_oid},
            {"$set": {"vip_level": new_level, "vip_expires_at": new_expires}},
        )
        await db.growth_ledger.insert_one({
            "user_id": str(user_oid),
            "tx_id": secrets.token_hex(10),
            "source": "vip_downgrade",
            "amount": 0,
            "growth_after": gp,
            "from_level": level,
            "to_level": new_level,
            "maintenance_source": maint_source,
            "maintenance_actual": maint_actual,
            "maintenance_required": required,
            "created_at": now,
        })
        level = new_level
        expires = new_expires

    required = VIP_MAINTENANCE_REQUIREMENTS.get(level, 0) if level >= 1 else 0
    remaining = max(0, required - gp)
    days_left = 0
    if isinstance(expires, datetime):
        secs = (expires - now).total_seconds()
        if secs > 0:
            days_left = max(0, int((secs + 86399) // 86400))  # ceil-to-day
    return {
        "level": level,
        "vip_expires_at": expires.isoformat() if isinstance(expires, datetime) else None,
        "growth_points": gp,
        "maintenance_threshold": required,
        "maintenance_remaining": remaining,
        "remaining_days": days_left,
    }


@api.get("/vip/maintenance")
async def _vip_maintenance_endpoint(user=Depends(current_user)):
    """Full maintenance snapshot + reference requirements map."""
    snap = await _vip_maintenance_cycle(user["_id"])
    return {
        **snap,
        "requirements": [
            {"level": lvl, "threshold": thr}
            for lvl, thr in sorted(VIP_MAINTENANCE_REQUIREMENTS.items())
        ],
    }


# ---------- Global Supporter Ranking (iter-55) ----------
@api.get("/rankings/global")
async def _global_ranking(
    metric: str = "contribution",
    period: str = "all",
    user=Depends(current_user),
):
    """Top-50 global supporter ranking across ALL rooms.
    metric=contribution → senders of gifts system-wide
    metric=charm        → recipients of gifts system-wide
    Reuses the same UTC windowing + gift_transactions source of truth as
    /rooms/{id}/ranking so numbers are consistent.
    """
    db = app.state.db
    metric = (metric or "contribution").lower()
    if metric not in ("contribution", "charm"):
        raise HTTPException(400, "metric must be 'contribution' or 'charm'")

    cutoff = _ranking_window_start(period)
    match: dict = {}
    if cutoff is not None:
        match["created_at"] = {"$gte": cutoff}

    group_field = "$sender_id" if metric == "contribution" else "$recipient_id"
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": group_field,
            "amount": {"$sum": "$total_cost"},
            "gift_count": {"$sum": "$quantity"},
        }},
        {"$sort": {"amount": -1}},
        {"$limit": 50},
    ]
    rows = []
    async for r in db.gift_transactions.aggregate(pipeline):
        rows.append(r)
    if not rows:
        return {"metric": metric, "period": period, "items": [], "me": await _room_rank_me(db, match, group_field, user, [])}

    ids = []
    for r in rows:
        try:
            if r["_id"]:
                ids.append(ObjectId(r["_id"]))
        except Exception:
            pass
    users_by_id: dict = {}
    if ids:
        async for u in db.users.find(
            {"_id": {"$in": ids}},
            {"nickname": 1, "avatar_url": 1, "vip_level": 1,
             "numeric_id": 1, "country_flag": 1, "created_at": 1},
        ):
            users_by_id[str(u["_id"])] = u

    items = []
    for rank, r in enumerate(rows, start=1):
        uid = str(r["_id"] or "")
        if not uid or uid not in users_by_id:
            continue
        u = users_by_id[uid]
        items.append({
            "rank": rank,
            "user": {
                "id": uid,
                "nickname": u.get("nickname") or "User",
                "avatar_url": u.get("avatar_url"),
                "vip_level": u.get("vip_level", 0),
                "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0)),
                "numeric_id": u.get("numeric_id"),
                "country_flag": u.get("country_flag"),
                "is_new": _is_new_user(u.get("created_at")),
            },
            "amount": int(r.get("amount", 0)),
            "gift_count": int(r.get("gift_count", 0)),
        })
    # Re-number after dropping any orphans so ranks stay 1..N contiguous.
    for i, it in enumerate(items, start=1):
        it["rank"] = i
    return {"metric": metric, "period": period, "items": items}


# ============================================================================
# ITER-42 — ORIO GAMES (LUDO) + FINANCIAL INTERMEDIARY / RECHARGE AGENT
# ----------------------------------------------------------------------------
# Added surgically — does NOT modify any existing route, ledger, economy,
# or UI. Casual-only games: NO stakes, NO prize pool, NO withdrawals coupling.
# Recharge Agent: a separate first-class recharge method, NOT a payout method.
# Both features preserve 9999 Diamonds = $1, Host/Agency/ORIO split, and the
# existing wallet / financial ledger.
# ============================================================================

async def _bootstrap_indexes_v42(db):
    # ----- Games -----
    await db.games.create_index("game_id", unique=True)
    await db.games.create_index([("room_id", 1), ("status", 1)])
    await db.games.create_index([("status", 1), ("updated_at", -1)])
    await db.game_moves.create_index([("game_id", 1), ("seq", 1)])
    await db.game_moves.create_index([("game_id", 1), ("created_at", 1)])
    # ----- Recharge Agent -----
    await db.recharge_agents.create_index("agent_code", unique=True)
    await db.recharge_agents.create_index([("is_active", 1), ("created_at", -1)])
    # Per-agent uniqueness on the provider transaction id so a user cannot
    # submit the same proof twice and admin cannot credit the same tx twice.
    await db.recharge_agent_transactions.create_index(
        [("agent_id", 1), ("agent_tx_id", 1)], unique=True
    )
    await db.recharge_agent_transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.recharge_agent_transactions.create_index([("status", 1), ("created_at", -1)])
    # ----- Room Games Catalog (iter-43) -----
    await db.room_games_catalog.create_index([("category", 1), ("order", 1)])
    await db.room_games_catalog.create_index([("game_type", 1)], unique=True, sparse=True)
    # Seed default entertainment catalog (idempotent).
    for seed in [
        {"category": "entertainment", "game_type": "ludo", "title_en": "Ludo", "title_ar": "لودو",
         "icon": "dice", "enabled": True, "order": 10, "min_players": 2, "max_players": 4},
        {"category": "entertainment", "game_type": "billiards", "title_en": "Billiards", "title_ar": "بلياردو",
         "icon": "ellipse", "enabled": True, "order": 20, "min_players": 2, "max_players": 2},
    ]:
        existing = await db.room_games_catalog.find_one({"game_type": seed["game_type"]})
        if not existing:
            seed["created_at"] = now_utc()
            await db.room_games_catalog.insert_one(seed)


# ================= LUDO — Server-authoritative state machine ================
# No client ever computes a result. Every roll + move is validated here.
# Reusable primitives (hub, create/start/leave/forfeit, state replay, WS) will
# support Dominoes/UNO/Carrom/Team Battle/Dice without rewriting the plumbing.

# Standard Ludo coordinates (52-cell shared loop + 4x6 home columns):
# seat 0 (red):   starts at loop cell 0,  home-entry runs after passing cell 51
# seat 1 (green): starts at loop cell 13, home-entry after cell 12
# seat 2 (yellow):starts at loop cell 26, home-entry after cell 25
# seat 3 (blue):  starts at loop cell 39, home-entry after cell 38
_LUDO_START = {0: 0, 1: 13, 2: 26, 3: 39}
# Safe cells (never captured on): start cells + star cells.
_LUDO_SAFE_CELLS = {0, 8, 13, 21, 26, 34, 39, 47}
_LUDO_COLORS = {0: "red", 1: "green", 2: "yellow", 3: "blue"}
_GAME_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no ambiguous chars


def _new_game_id() -> str:
    return "".join(secrets.choice(_GAME_ID_ALPHABET) for _ in range(8))


def _ludo_initial_tokens() -> dict:
    """4 seats × 4 tokens, all in base."""
    out = {}
    for seat in range(4):
        out[str(seat)] = [{"in_base": True, "steps": 0} for _ in range(4)]
    return out


def _ludo_token_render(tok: dict, seat: int) -> dict:
    if tok["in_base"]:
        return {"zone": "base", "pos": 0}
    s = tok["steps"]
    if s >= 57:
        return {"zone": "finish", "pos": 0}
    if s >= 52:
        return {"zone": "home", "pos": s - 52}
    return {"zone": "track", "pos": (_LUDO_START[seat] + s) % 52}


def _ludo_global_track_pos(tok: dict, seat: int) -> Optional[int]:
    """Return the global loop cell (0..51) if token is on the main track, else None."""
    if tok["in_base"] or tok["steps"] >= 52:
        return None
    return (_LUDO_START[seat] + tok["steps"]) % 52


def _ludo_player_has_any_move(game: dict, seat: int, roll: int) -> bool:
    tokens = game["state"]["tokens"][str(seat)]
    for i in range(4):
        if _ludo_is_valid_move(game, seat, i, roll):
            return True
    return False


def _ludo_is_valid_move(game: dict, seat: int, token_idx: int, roll: int) -> bool:
    tok = game["state"]["tokens"][str(seat)][token_idx]
    # Finished tokens never move.
    if (not tok["in_base"]) and tok["steps"] >= 57:
        return False
    if tok["in_base"]:
        return roll == 6  # only a 6 releases from base
    new_steps = tok["steps"] + roll
    if new_steps > 57:
        return False  # cannot overshoot home
    return True


def _ludo_apply_move(game: dict, seat: int, token_idx: int, roll: int) -> dict:
    """Mutate game['state'] in-place and return a result descriptor
    (captures, finish, extra_turn). Caller is responsible for persistence."""
    st = game["state"]
    tok = st["tokens"][str(seat)][token_idx]
    captured: list[dict] = []
    reached_finish = False

    if tok["in_base"]:
        # Release to start cell (steps=0, meaning at _LUDO_START[seat])
        tok["in_base"] = False
        tok["steps"] = 0
    else:
        tok["steps"] += roll
        if tok["steps"] == 57:
            reached_finish = True

    # Captures only when landing on the main track.
    gpos = _ludo_global_track_pos(tok, seat)
    if gpos is not None and gpos not in _LUDO_SAFE_CELLS:
        for other_seat in range(4):
            if other_seat == seat:
                continue
            for j, otok in enumerate(st["tokens"][str(other_seat)]):
                opos = _ludo_global_track_pos(otok, other_seat)
                if opos == gpos:
                    otok["in_base"] = True
                    otok["steps"] = 0
                    captured.append({"seat": other_seat, "token": j})

    # Extra turn rules: rolling a 6 OR capturing OR finishing a token.
    extra_turn = (roll == 6) or (len(captured) > 0) or reached_finish

    # Three-sixes rule — if three consecutive sixes, forfeit the turn
    # (the token already moved — common house rule treats third 6 as void.
    # We instead let the move stand but revoke the extra turn.)
    if roll == 6:
        st["consecutive_sixes"] = int(st.get("consecutive_sixes", 0)) + 1
        if st["consecutive_sixes"] >= 3:
            extra_turn = False
    else:
        st["consecutive_sixes"] = 0

    st["dice"] = None
    st["moves_count"] = int(st.get("moves_count", 0)) + 1

    # Win check: all 4 tokens finished.
    all_finished = all(
        (not t["in_base"]) and t["steps"] >= 57 for t in st["tokens"][str(seat)]
    )
    if all_finished:
        game["status"] = "finished"
        game["winner_seat"] = seat
        extra_turn = False  # game over

    return {
        "captured": captured,
        "reached_finish": reached_finish,
        "extra_turn": extra_turn,
        "all_finished": all_finished,
    }


def _ludo_next_turn(game: dict) -> None:
    """Advance current_turn to the next occupied seat."""
    seats_occupied = sorted({p["seat"] for p in game["players"]})
    if not seats_occupied:
        return
    cur = game["state"]["current_turn"]
    try:
        idx = seats_occupied.index(cur)
    except ValueError:
        idx = -1
    nxt = seats_occupied[(idx + 1) % len(seats_occupied)]
    game["state"]["current_turn"] = nxt
    game["state"]["consecutive_sixes"] = 0
    game["state"]["dice"] = None


def _public_game(game: dict) -> dict:
    g = {
        "id": str(game.get("_id")) if game.get("_id") else None,
        "game_id": game["game_id"],
        "game_type": game["game_type"],
        "room_id": game.get("room_id"),
        "owner_id": game.get("owner_id"),
        "mode": game.get("mode", "casual"),
        "status": game["status"],
        "players": [
            {
                "user_id": p["user_id"],
                "nickname": p.get("nickname"),
                "avatar_url": p.get("avatar_url"),
                "vip_level": p.get("vip_level", 0),
                "seat": p["seat"],
                "color": _LUDO_COLORS[p["seat"]],
                "is_connected": bool(p.get("is_connected", True)),
                "forfeited": bool(p.get("forfeited", False)),
            }
            for p in sorted(game.get("players", []), key=lambda x: x["seat"])
        ],
        "state": game.get("state", {}),
        "winner_seat": game.get("winner_seat"),
        "winner_user_id": game.get("winner_user_id"),
        "xp_awards": game.get("xp_awards", {}),
        "created_at": game["created_at"].isoformat() if isinstance(game.get("created_at"), datetime) else game.get("created_at"),
        "started_at": game["started_at"].isoformat() if isinstance(game.get("started_at"), datetime) else game.get("started_at"),
        "finished_at": game["finished_at"].isoformat() if isinstance(game.get("finished_at"), datetime) else game.get("finished_at"),
    }
    return g


# ----- Games Hub (WS) -----
class _GameHub:
    def __init__(self) -> None:
        self.games: dict[str, set[WebSocket]] = {}
        self.presence: dict[str, dict[str, dict]] = {}

    async def connect(self, game_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.games.setdefault(game_id, set()).add(ws)

    def disconnect(self, game_id: str, ws: WebSocket) -> None:
        s = self.games.get(game_id)
        if s:
            s.discard(ws)
            if not s:
                self.games.pop(game_id, None)

    async def broadcast(self, game_id: str, message: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.games.get(game_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(game_id, ws)


_game_hub = _GameHub()


async def _broadcast_game(game_id: str, db) -> None:
    try:
        g = await db.games.find_one({"game_id": game_id})
        if g:
            await _game_hub.broadcast(game_id, {"type": "game_state", "game": _public_game(g)})
    except Exception:
        pass


async def _find_game_or_404(db, game_id: str) -> dict:
    g = await db.games.find_one({"game_id": game_id})
    if not g:
        raise HTTPException(404, "Game not found")
    return g


# ----- Game REST endpoints -----

class _CreateLudoIn(BaseModel):
    room_id: str = Field(..., min_length=1)


@api.post("/games/ludo/create", status_code=201)
async def _create_ludo(body: _CreateLudoIn, user=Depends(current_user)):
    """Create a new Ludo session anchored to a room. Any room member may create.
    One active (waiting/active) game per room at a time."""
    db = app.state.db
    try:
        room = await db.rooms.find_one({"_id": ObjectId(body.room_id)})
    except Exception:
        raise HTTPException(400, "Invalid room_id")
    if not room:
        raise HTTPException(404, "Room not found")
    # Ensure no active game for this room already.
    existing = await db.games.find_one({"room_id": body.room_id, "status": {"$in": ["waiting", "active"]}})
    if existing:
        return _public_game(existing)
    now_t = now_utc()
    # Owner occupies seat 0 by default.
    uid = str(user["_id"])
    nickname = user.get("nickname") or "Player"
    doc = {
        "game_id": _new_game_id(),
        "game_type": "ludo",
        "room_id": body.room_id,
        "owner_id": uid,
        "mode": "casual",  # NO stakes, NO prize pool, EVER.
        "status": "waiting",
        "players": [{
            "user_id": uid,
            "nickname": nickname,
            "avatar_url": user.get("avatar_url"),
            "vip_level": user.get("vip_level", 0),
            "seat": 0,
            "joined_at": now_t,
            "is_connected": True,
            "forfeited": False,
        }],
        "state": {
            "current_turn": 0,
            "dice": None,
            "consecutive_sixes": 0,
            "moves_count": 0,
            "tokens": _ludo_initial_tokens(),
            "last_action_at": now_t,
        },
        "winner_seat": None,
        "winner_user_id": None,
        "xp_awards": {},
        "created_at": now_t,
        "updated_at": now_t,
        "started_at": None,
        "finished_at": None,
    }
    # Collision-safe insert — retry on dup game_id (astronomically rare).
    for _ in range(5):
        try:
            r = await db.games.insert_one(doc)
            doc["_id"] = r.inserted_id
            break
        except Exception:
            doc["game_id"] = _new_game_id()
    else:
        raise HTTPException(500, "Could not allocate game_id")
    return _public_game(doc)


@api.get("/games/{game_id}")
async def _get_game(game_id: str, user=Depends(current_user)):
    db = app.state.db
    g = await _find_game_or_404(db, game_id)
    return _public_game(g)


@api.get("/rooms/{room_id}/games/active")
async def _get_active_game_for_room(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        g = await db.games.find_one({"room_id": room_id, "status": {"$in": ["waiting", "active"]}})
    except Exception:
        g = None
    return {"game": _public_game(g) if g else None}


@api.post("/games/{game_id}/join")
async def _join_game(game_id: str, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g["status"] != "waiting":
        raise HTTPException(409, "Game already started")
    if any(p["user_id"] == uid for p in g["players"]):
        return _public_game(g)
    taken = {p["seat"] for p in g["players"]}
    free = [s for s in range(4) if s not in taken]
    if not free:
        raise HTTPException(409, "Game is full")
    nickname = user.get("nickname") or "Player"
    new_player = {
        "user_id": uid,
        "nickname": nickname,
        "avatar_url": user.get("avatar_url"),
        "vip_level": user.get("vip_level", 0),
        "seat": free[0],
        "joined_at": now_utc(),
        "is_connected": True,
        "forfeited": False,
    }
    res = await db.games.update_one(
        {"game_id": game_id, "status": "waiting", "players.user_id": {"$ne": uid}},
        {"$push": {"players": new_player}, "$set": {"updated_at": now_utc()}},
    )
    if res.modified_count == 0:
        # Race — refetch and return current state (idempotent).
        g = await _find_game_or_404(db, game_id)
        return _public_game(g)
    g = await _find_game_or_404(db, game_id)
    await _broadcast_game(game_id, db)
    return _public_game(g)


@api.post("/games/{game_id}/leave")
async def _leave_game(game_id: str, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g["status"] not in ("waiting", "active"):
        return _public_game(g)
    if g["status"] == "waiting":
        # Remove from players list.
        await db.games.update_one(
            {"game_id": game_id},
            {"$pull": {"players": {"user_id": uid}}, "$set": {"updated_at": now_utc()}},
        )
        g = await db.games.find_one({"game_id": game_id})
        if g and not g["players"]:
            await db.games.update_one({"game_id": game_id}, {"$set": {"status": "abandoned", "finished_at": now_utc()}})
            g = await _find_game_or_404(db, game_id)
    else:
        # Active: mark forfeited.
        await db.games.update_one(
            {"game_id": game_id, "players.user_id": uid},
            {"$set": {"players.$.forfeited": True, "updated_at": now_utc()}},
        )
        g = await _find_game_or_404(db, game_id)
        # If 0 or 1 non-forfeited players remain, finish.
        active_players = [p for p in g["players"] if not p.get("forfeited")]
        if len(active_players) <= 1:
            g["status"] = "finished"
            g["finished_at"] = now_utc()
            if active_players:
                g["winner_seat"] = active_players[0]["seat"]
                g["winner_user_id"] = active_players[0]["user_id"]
            await db.games.update_one(
                {"game_id": game_id},
                {"$set": {
                    "status": g["status"],
                    "finished_at": g["finished_at"],
                    "winner_seat": g.get("winner_seat"),
                    "winner_user_id": g.get("winner_user_id"),
                }},
            )
            await _award_ludo_xp(db, g)
            g = await _find_game_or_404(db, game_id)
        elif g["state"]["current_turn"] == next((p["seat"] for p in g["players"] if p["user_id"] == uid), None):
            _ludo_next_turn(g)
            await db.games.update_one({"game_id": game_id}, {"$set": {"state": g["state"]}})
    await _broadcast_game(game_id, db)
    return _public_game(g)


@api.post("/games/{game_id}/start")
async def _start_game(game_id: str, user=Depends(current_user)):
    """Owner starts the game once ≥2 players are seated."""
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g["owner_id"] != uid:
        raise HTTPException(403, "Only the game host can start the game")
    if g["status"] != "waiting":
        raise HTTPException(409, "Game already started or finished")
    if len(g["players"]) < 2:
        raise HTTPException(400, "At least 2 players are required to start Ludo")
    seats_occupied = sorted({p["seat"] for p in g["players"]})
    first_turn = seats_occupied[0]
    now_t = now_utc()
    r = await db.games.update_one(
        {"game_id": game_id, "status": "waiting"},
        {"$set": {
            "status": "active",
            "started_at": now_t,
            "updated_at": now_t,
            "state.current_turn": first_turn,
            "state.dice": None,
            "state.consecutive_sixes": 0,
            "state.last_action_at": now_t,
        }},
    )
    if r.modified_count == 0:
        raise HTTPException(409, "Game already started")
    g = await _find_game_or_404(db, game_id)
    await _broadcast_game(game_id, db)
    return _public_game(g)


@api.post("/games/{game_id}/roll")
async def _roll_dice(game_id: str, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g["status"] != "active":
        raise HTTPException(409, "Game is not active")
    me_seat = next((p["seat"] for p in g["players"] if p["user_id"] == uid and not p.get("forfeited")), None)
    if me_seat is None:
        raise HTTPException(403, "You are not a player in this game")
    if g["state"]["current_turn"] != me_seat:
        raise HTTPException(403, "Not your turn")
    if g["state"].get("dice") is not None:
        raise HTTPException(409, "You already rolled — please move")
    # SERVER-AUTHORITATIVE RNG. secrets module = cryptographically strong.
    roll = secrets.randbelow(6) + 1
    now_t = now_utc()
    g["state"]["dice"] = roll
    g["state"]["last_action_at"] = now_t
    await db.games.update_one(
        {"game_id": game_id, "status": "active", "state.current_turn": me_seat, "state.dice": None},
        {"$set": {"state.dice": roll, "state.last_action_at": now_t, "updated_at": now_t}},
    )
    # seq = moves_count + 1 for the roll; moves_count isn't incremented
    # until the token is actually moved. We disambiguate rolls vs moves by
    # the "kind" field.
    seq_r = int(g["state"].get("moves_count", 0)) + 1
    await db.game_moves.insert_one({
        "game_id": game_id, "seq": seq_r, "kind": "roll",
        "user_id": uid, "seat": me_seat, "roll": roll, "created_at": now_t,
    })
    # If no legal moves, auto-pass turn immediately.
    if not _ludo_player_has_any_move(g, me_seat, roll):
        _ludo_next_turn(g)
        await db.games.update_one({"game_id": game_id}, {"$set": {"state": g["state"], "updated_at": now_utc()}})
    g = await _find_game_or_404(db, game_id)
    await _broadcast_game(game_id, db)
    return _public_game(g)


class _MoveIn(BaseModel):
    token_index: int = Field(..., ge=0, le=3)


@api.post("/games/{game_id}/move")
async def _move_token(game_id: str, body: _MoveIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g["status"] != "active":
        raise HTTPException(409, "Game is not active")
    me_seat = next((p["seat"] for p in g["players"] if p["user_id"] == uid and not p.get("forfeited")), None)
    if me_seat is None:
        raise HTTPException(403, "You are not a player in this game")
    if g["state"]["current_turn"] != me_seat:
        raise HTTPException(403, "Not your turn")
    roll = g["state"].get("dice")
    if roll is None:
        raise HTTPException(409, "You must roll the dice first")
    if not _ludo_is_valid_move(g, me_seat, body.token_index, roll):
        raise HTTPException(400, "That move is not valid for this dice roll")
    result = _ludo_apply_move(g, me_seat, body.token_index, roll)
    now_t = now_utc()
    seq = int(g["state"].get("moves_count", 0))
    if g["status"] == "finished":
        g["winner_user_id"] = next((p["user_id"] for p in g["players"] if p["seat"] == me_seat), uid)
        g["finished_at"] = now_t
        await db.games.update_one({"game_id": game_id}, {"$set": {
            "state": g["state"], "status": "finished",
            "winner_seat": me_seat, "winner_user_id": g["winner_user_id"],
            "finished_at": now_t, "updated_at": now_t,
        }})
        await _award_ludo_xp(db, g)
    else:
        if not result["extra_turn"]:
            _ludo_next_turn(g)
        await db.games.update_one({"game_id": game_id}, {"$set": {"state": g["state"], "updated_at": now_t}})
    await db.game_moves.insert_one({
        "game_id": game_id, "seq": seq, "kind": "move",
        "user_id": uid, "seat": me_seat, "roll": roll,
        "token_index": body.token_index,
        "captured": result["captured"],
        "reached_finish": result["reached_finish"],
        "extra_turn": result["extra_turn"],
        "created_at": now_t,
    })
    g = await _find_game_or_404(db, game_id)
    await _broadcast_game(game_id, db)
    return _public_game(g)


@api.post("/games/{game_id}/forfeit")
async def _forfeit_game(game_id: str, user=Depends(current_user)):
    # Alias to leave; present for client clarity.
    return await _leave_game(game_id, user)  # type: ignore


async def _award_ludo_xp(db, g: dict) -> None:
    """Casual XP ONLY — never touches diamonds/coins or the financial ledger.
    Writes to a dedicated games_xp_ledger and increments user.games_xp."""
    if g.get("xp_awarded"):
        return
    now_t = now_utc()
    awards = {}
    winner_id = g.get("winner_user_id")
    for p in g.get("players", []):
        pid = p["user_id"]
        if pid == winner_id:
            amt = 50
        elif p.get("forfeited"):
            amt = 2
        else:
            amt = 10
        awards[pid] = amt
    # Idempotent set via a compare-and-swap on `xp_awarded`.
    r = await db.games.update_one(
        {"game_id": g["game_id"], "xp_awarded": {"$ne": True}},
        {"$set": {"xp_awarded": True, "xp_awards": awards, "updated_at": now_t}},
    )
    if r.modified_count == 0:
        return
    for pid, amt in awards.items():
        try:
            await db.users.update_one({"_id": ObjectId(pid)}, {"$inc": {"games_xp": int(amt)}})
            await db.games_xp_ledger.insert_one({
                "user_id": pid, "game_id": g["game_id"], "game_type": g["game_type"],
                "xp": int(amt), "reason": "winner" if pid == winner_id else ("forfeit" if any(p["user_id"] == pid and p.get("forfeited") for p in g["players"]) else "finished"),
                "created_at": now_t,
            })
        except Exception:
            continue


@api.get("/me/games-xp")
async def _get_my_games_xp(user=Depends(current_user)):
    db = app.state.db
    fresh = await db.users.find_one({"_id": user["_id"]}, {"games_xp": 1}) or {}
    cur = db.games_xp_ledger.find({"user_id": str(user["_id"])}, {"_id": 0}).sort("created_at", -1).limit(50)
    items = await cur.to_list(50)
    for it in items:
        ca = it.get("created_at")
        if isinstance(ca, datetime):
            it["created_at"] = ca.isoformat()
    return {"games_xp": int(fresh.get("games_xp", 0)), "ledger": items}


# ----- Game WebSocket -----
@app.websocket("/api/ws/games/{game_id}")
async def _ws_game(ws: WebSocket, game_id: str, token: str = Query(...)):
    user = await _user_from_token(token)
    if not user:
        await ws.close(code=4401)
        return
    db = app.state.db
    g = await db.games.find_one({"game_id": game_id})
    if not g:
        await ws.close(code=4404)
        return
    await _game_hub.connect(game_id, ws)
    uid = str(user["_id"])
    try:
        # Immediate state replay for the newly-connected socket.
        await ws.send_json({"type": "game_state", "game": _public_game(g)})
        # Mark player as connected (if they are a player).
        if any(p["user_id"] == uid for p in g.get("players", [])):
            await db.games.update_one(
                {"game_id": game_id, "players.user_id": uid},
                {"$set": {"players.$.is_connected": True, "updated_at": now_utc()}},
            )
            await _broadcast_game(game_id, db)
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "ping":
                await ws.send_json({"type": "pong", "at": now_utc().isoformat()})
            # All game actions go through REST — WS is replay/broadcast only.
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _game_hub.disconnect(game_id, ws)
        # Mark player as disconnected (best-effort).
        try:
            await db.games.update_one(
                {"game_id": game_id, "players.user_id": uid},
                {"$set": {"players.$.is_connected": False, "updated_at": now_utc()}},
            )
            await _broadcast_game(game_id, db)
        except Exception:
            pass


# ============== FINANCIAL INTERMEDIARY / RECHARGE AGENT ==================
# Separate from payout methods. A user who recharged via a human agent
# submits proof here; admin verifies and credits diamonds via the existing
# wallet ledger using the authoritative 9999/USD rate. Historical rows are
# immutable once verified. Deleting a saved recharge-agent "preference"
# never deletes any transaction row.
# ========================================================================


class _CreateRechargeAgentIn(BaseModel):
    agent_code: str = Field(..., min_length=3, max_length=32)
    name: str = Field(..., min_length=2, max_length=80)
    country: Optional[str] = Field(None, max_length=56)
    contact: Optional[str] = Field(None, max_length=200)
    note: Optional[str] = Field(None, max_length=500)


class _PatchRechargeAgentIn(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=80)
    country: Optional[str] = Field(None, max_length=56)
    contact: Optional[str] = Field(None, max_length=200)
    note: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None


def _public_recharge_agent(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "agent_code": doc["agent_code"],
        "name": doc.get("name"),
        "country": doc.get("country"),
        "contact": doc.get("contact"),
        "note": doc.get("note"),
        "is_active": bool(doc.get("is_active", True)),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


class _SubmitRechargeAgentTxIn(BaseModel):
    agent_id: str = Field(..., min_length=1)
    agent_tx_id: str = Field(..., min_length=4, max_length=120)
    amount_usd: int = Field(..., gt=0, le=10_000)  # integer USD; rate converts to diamonds
    paid_at: str = Field(..., min_length=4, max_length=40)  # ISO-8601
    note: Optional[str] = Field(None, max_length=400)


def _public_recharge_agent_tx(doc: dict, *, agent: Optional[dict] = None) -> dict:
    out = {
        "id": str(doc["_id"]),
        "user_id": doc["user_id"],
        "agent_id": doc["agent_id"],
        "agent_tx_id": doc["agent_tx_id"],
        "amount_usd": int(doc["amount_usd"]),
        "diamonds_credited": int(doc.get("diamonds_credited", 0)),
        "status": doc["status"],
        "paid_at": doc.get("paid_at"),
        "note": doc.get("note"),
        "wallet_tx_id": doc.get("wallet_tx_id"),
        "verified_by": doc.get("verified_by"),
        "verified_at": doc["verified_at"].isoformat() if isinstance(doc.get("verified_at"), datetime) else doc.get("verified_at"),
        "rejection_reason": doc.get("rejection_reason"),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }
    if agent is not None:
        out["agent"] = {
            "id": str(agent["_id"]),
            "agent_code": agent.get("agent_code"),
            "name": agent.get("name"),
        }
    return out


@api.get("/recharge-agents")
async def _list_recharge_agents(user=Depends(current_user)):
    """Public listing of active recharge agents available for recharging."""
    db = app.state.db
    cur = db.recharge_agents.find({"is_active": True}).sort("created_at", -1)
    items = [_public_recharge_agent(d) for d in await cur.to_list(200)]
    return {"items": items}


@api.get("/recharge-agents/{agent_id}")
async def _get_recharge_agent(agent_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        doc = await db.recharge_agents.find_one({"_id": ObjectId(agent_id)})
    except Exception:
        raise HTTPException(400, "Invalid agent_id")
    if not doc or not doc.get("is_active", True):
        raise HTTPException(404, "Agent not found")
    return _public_recharge_agent(doc)


@api.post("/recharge-agent-transactions", status_code=201)
async def _submit_recharge_agent_tx(body: _SubmitRechargeAgentTxIn, user=Depends(current_user)):
    """User submits proof of a REAL off-platform recharge made via an agent.
    STATUS = pending. Admin must verify before diamonds are credited. All
    typed fields are stored as-is; placeholder-sounding values are rejected."""
    db = app.state.db
    uid = str(user["_id"])
    # Validate: agent must exist and be active.
    try:
        agent = await db.recharge_agents.find_one({"_id": ObjectId(body.agent_id)})
    except Exception:
        raise HTTPException(400, "Invalid agent_id")
    if not agent or not agent.get("is_active", True):
        raise HTTPException(404, "Agent not found")
    # Validate: transaction id must not look like a placeholder.
    atx = body.agent_tx_id.strip()
    if _is_placeholder(atx):
        raise HTTPException(400, "agent_tx_id looks like a placeholder — enter the REAL transaction ID")
    # Validate: paid_at must parse as a real ISO datetime.
    try:
        paid_dt = datetime.fromisoformat(body.paid_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "paid_at must be a valid ISO-8601 timestamp")
    if paid_dt > now_utc() + timedelta(minutes=5):
        raise HTTPException(400, "paid_at cannot be in the future")
    if paid_dt < now_utc() - timedelta(days=90):
        raise HTTPException(400, "paid_at is older than 90 days — ask the agent for a recent transaction")
    # Iter-133: recharges use the official RECHARGE rate ($1 = 499 Diamonds).
    rate = RECHARGE_DIAMONDS_PER_USD
    diamonds_target = int(body.amount_usd) * rate
    now_t = now_utc()
    doc = {
        "user_id": uid,
        "agent_id": str(agent["_id"]),
        "agent_tx_id": atx,
        "amount_usd": int(body.amount_usd),
        "diamonds_target": diamonds_target,
        "rate_diamonds_per_usd": rate,
        "diamonds_credited": 0,
        "status": "pending",
        "paid_at": paid_dt.isoformat(),
        "note": (body.note or None),
        "wallet_tx_id": None,
        "verified_by": None,
        "verified_at": None,
        "rejection_reason": None,
        "created_at": now_t,
    }
    try:
        r = await db.recharge_agent_transactions.insert_one(doc)
        doc["_id"] = r.inserted_id
    except Exception as e:
        # DuplicateKey = agent_id + agent_tx_id unique constraint
        from pymongo.errors import DuplicateKeyError
        if isinstance(e, DuplicateKeyError):
            raise HTTPException(409, "This transaction ID has already been submitted for this agent")
        raise HTTPException(500, "Could not record submission")
    return _public_recharge_agent_tx(doc, agent=agent)


@api.get("/recharge-agent-transactions")
async def _list_my_recharge_agent_txs(limit: int = 100, user=Depends(current_user)):
    db = app.state.db
    limit = max(1, min(int(limit or 100), 200))
    cur = db.recharge_agent_transactions.find({"user_id": str(user["_id"])}).sort("created_at", -1).limit(limit)
    items = []
    for d in await cur.to_list(limit):
        agent = None
        try:
            agent = await db.recharge_agents.find_one({"_id": ObjectId(d["agent_id"])})
        except Exception:
            pass
        items.append(_public_recharge_agent_tx(d, agent=agent))
    return {"items": items}


@api.get("/recharge-agent-transactions/{tx_id}")
async def _get_my_recharge_agent_tx(tx_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        d = await db.recharge_agent_transactions.find_one({"_id": ObjectId(tx_id), "user_id": str(user["_id"])})
    except Exception:
        raise HTTPException(400, "Invalid tx_id")
    if not d:
        raise HTTPException(404, "Transaction not found")
    agent = None
    try:
        agent = await db.recharge_agents.find_one({"_id": ObjectId(d["agent_id"])})
    except Exception:
        pass
    return _public_recharge_agent_tx(d, agent=agent)


# ----- Admin: Recharge agent management -----

@api.get("/admin/recharge-agents")
async def _admin_list_recharge_agents(user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    items = [_public_recharge_agent(d) for d in await db.recharge_agents.find({}).sort("created_at", -1).to_list(500)]
    return {"items": items}


@api.post("/admin/recharge-agents", status_code=201)
async def _admin_create_recharge_agent(body: _CreateRechargeAgentIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    code = body.agent_code.strip()
    if _is_placeholder(code):
        raise HTTPException(400, "agent_code looks like a placeholder")
    doc = {
        "agent_code": code,
        "name": body.name.strip(),
        "country": (body.country or None),
        "contact": (body.contact or None),
        "note": (body.note or None),
        "is_active": True,
        "created_at": now_utc(),
        "created_by": str(user["_id"]),
    }
    try:
        r = await db.recharge_agents.insert_one(doc)
        doc["_id"] = r.inserted_id
    except Exception:
        raise HTTPException(409, "An agent with that code already exists")
    return _public_recharge_agent(doc)


@api.patch("/admin/recharge-agents/{agent_id}")
async def _admin_patch_recharge_agent(agent_id: str, body: _PatchRechargeAgentIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    try:
        doc = await db.recharge_agents.find_one({"_id": ObjectId(agent_id)})
    except Exception:
        raise HTTPException(400, "Invalid agent_id")
    if not doc:
        raise HTTPException(404, "Agent not found")
    upd = {}
    for k in ("name", "country", "contact", "note", "is_active"):
        v = getattr(body, k, None)
        if v is not None:
            upd[k] = v if isinstance(v, bool) else str(v).strip()
    if upd:
        upd["updated_at"] = now_utc()
        await db.recharge_agents.update_one({"_id": ObjectId(agent_id)}, {"$set": upd})
    doc = await db.recharge_agents.find_one({"_id": ObjectId(agent_id)})
    return _public_recharge_agent(doc)


@api.get("/admin/recharge-agent-transactions")
async def _admin_list_recharge_agent_txs(status: Optional[str] = None, limit: int = 200, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    q: dict = {}
    if status:
        q["status"] = status
    limit = max(1, min(int(limit or 200), 500))
    cur = db.recharge_agent_transactions.find(q).sort("created_at", -1).limit(limit)
    items = []
    for d in await cur.to_list(limit):
        agent = None
        try:
            agent = await db.recharge_agents.find_one({"_id": ObjectId(d["agent_id"])})
        except Exception:
            pass
        items.append(_public_recharge_agent_tx(d, agent=agent))
    return {"items": items}


class _VerifyRechargeAgentTxIn(BaseModel):
    pass  # No body needed — amount is fixed from submission.


@api.post("/admin/recharge-agent-transactions/{tx_id}/verify")
async def _admin_verify_recharge_agent_tx(tx_id: str, user=Depends(current_user)):
    """Admin verifies a submitted recharge agent transaction. Credits
    diamonds_target to the user via wallet_transactions. Idempotent."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    try:
        d = await db.recharge_agent_transactions.find_one({"_id": ObjectId(tx_id)})
    except Exception:
        raise HTTPException(400, "Invalid tx_id")
    if not d:
        raise HTTPException(404, "Transaction not found")
    if d["status"] == "verified":
        return _public_recharge_agent_tx(d)
    if d["status"] != "pending":
        raise HTTPException(409, f"Cannot verify a {d['status']} transaction")
    # Atomic compare-and-swap on status.
    now_t = now_utc()
    diamonds = int(d.get("diamonds_target") or 0)
    if diamonds <= 0:
        raise HTTPException(400, "Transaction has no diamonds to credit")
    user_oid = ObjectId(d["user_id"])
    # 1) credit user's coins AND growth_points atomically (same pattern as /wallet/recharge).
    from pymongo import ReturnDocument as _RD
    inc_res = await db.users.find_one_and_update(
        {"_id": user_oid},
        {"$inc": {"coins": diamonds, "growth_points": diamonds, "recharged_diamonds": diamonds}},
        return_document=_RD.AFTER,
    )
    if not inc_res:
        raise HTTPException(404, "Recharging user no longer exists")
    balance_after = int(inc_res.get("coins", 0))
    new_gp = int(inc_res.get("growth_points", 0))
    wallet_tx_id = secrets.token_hex(12)
    # 2) log wallet transaction.
    tx_rec = {
        "user_id": d["user_id"],
        "type": "recharge_agent",
        "currency": "coins",
        "amount": diamonds,
        "balance_after": balance_after,
        "created_at": now_t,
        "status": "completed",
        "description": "Recharge via Financial Intermediary",
        "agent_id": d["agent_id"],
        "agent_tx_id": d["agent_tx_id"],
        "amount_usd": int(d["amount_usd"]),
        "rate_diamonds_per_usd": int(d.get("rate_diamonds_per_usd") or RECHARGE_DIAMONDS_PER_USD),
        "recharge_agent_tx_id": str(d["_id"]),
        "tx_id": wallet_tx_id,
        "growth_points_awarded": diamonds,
    }
    wr = await db.wallet_transactions.insert_one(tx_rec)
    # 3) Immutable growth ledger (matches /wallet/recharge).
    await db.growth_ledger.insert_one({
        "user_id": d["user_id"],
        "tx_id": wallet_tx_id,
        "source": "recharge_agent",
        "amount": diamonds,
        "diamonds_after": balance_after,
        "growth_after": new_gp,
        "agent_id": d["agent_id"],
        "agent_tx_id": d["agent_tx_id"],
        "created_at": now_t,
    })
    # 4) seal the recharge-agent tx: set status/verified/credits/wallet_tx_id.
    r = await db.recharge_agent_transactions.update_one(
        {"_id": d["_id"], "status": "pending"},
        {"$set": {
            "status": "verified",
            "diamonds_credited": diamonds,
            "verified_by": str(user["_id"]),
            "verified_at": now_t,
            "wallet_tx_id": str(wr.inserted_id),
        }},
    )
    if r.modified_count == 0:
        # Race — another admin verified between the status check and now.
        # Reverse the credit + growth to maintain invariant.
        await db.users.update_one({"_id": user_oid}, {"$inc": {"coins": -diamonds, "growth_points": -diamonds, "recharged_diamonds": -diamonds}})
        await db.wallet_transactions.delete_one({"_id": wr.inserted_id})
        await db.growth_ledger.delete_one({"tx_id": wallet_tx_id})
        d = await db.recharge_agent_transactions.find_one({"_id": d["_id"]})
        return _public_recharge_agent_tx(d or {})
    # 5) Growth points: delegate to the existing recharge hook so VIP activation
    # & growth ledger stay a single source of truth.
    try:
        await _maybe_activate_vip(user_oid, int(inc_res.get("recharged_diamonds", 0)), int(inc_res.get("vip_level", 0)))
    except Exception:
        # Growth is non-blocking; the credit itself has already landed.
        pass
    d = await db.recharge_agent_transactions.find_one({"_id": d["_id"]})
    agent = None
    try:
        agent = await db.recharge_agents.find_one({"_id": ObjectId(d["agent_id"])})
    except Exception:
        pass
    return _public_recharge_agent_tx(d, agent=agent)


class _RejectRechargeAgentTxIn(BaseModel):
    reason: str = Field(..., min_length=2, max_length=500)


@api.post("/admin/recharge-agent-transactions/{tx_id}/reject")
async def _admin_reject_recharge_agent_tx(tx_id: str, body: _RejectRechargeAgentTxIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    try:
        d = await db.recharge_agent_transactions.find_one({"_id": ObjectId(tx_id)})
    except Exception:
        raise HTTPException(400, "Invalid tx_id")
    if not d:
        raise HTTPException(404, "Transaction not found")
    if d["status"] != "pending":
        raise HTTPException(409, f"Cannot reject a {d['status']} transaction")
    now_t = now_utc()
    await db.recharge_agent_transactions.update_one(
        {"_id": d["_id"], "status": "pending"},
        {"$set": {
            "status": "rejected",
            "verified_by": str(user["_id"]),
            "verified_at": now_t,
            "rejection_reason": body.reason.strip(),
        }},
    )
    d = await db.recharge_agent_transactions.find_one({"_id": d["_id"]})
    agent = None
    try:
        agent = await db.recharge_agents.find_one({"_id": ObjectId(d["agent_id"])})
    except Exception:
        pass
    return _public_recharge_agent_tx(d, agent=agent)


# ============================================================================
# ITER-43 — ROOM GAMES CATALOG + BILLIARDS (half-screen in-room play)
# ----------------------------------------------------------------------------
# Two new feature areas layered on top of iter-42 games:
#   1. Room-games catalog: entertainment + betting (admin-controlled).
#   2. Billiards: a real multiplayer game (NO wagering).
# Nothing modifies the financial ledger. Betting-games remain disabled
# until an authorized admin configures a real licensed provider — the
# API never returns fake providers or fake results.
# ============================================================================


# ----- Room Games Catalog -----

def _public_catalog_entry(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "category": doc["category"],
        "game_type": doc.get("game_type"),
        "title_en": doc.get("title_en"),
        "title_ar": doc.get("title_ar"),
        "icon": doc.get("icon"),
        "enabled": bool(doc.get("enabled", False)),
        "order": int(doc.get("order", 0)),
        "min_players": doc.get("min_players"),
        "max_players": doc.get("max_players"),
        # Betting-only fields (null for entertainment).
        "provider_id": doc.get("provider_id"),
        "provider_game_id": doc.get("provider_game_id"),
        "jurisdictions": doc.get("jurisdictions"),
        "wager_limits": doc.get("wager_limits"),
        "legal_status": doc.get("legal_status"),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


@api.get("/room-games/catalog")
async def _get_room_games_catalog(user=Depends(current_user)):
    """Public endpoint used by the Room Tools scrollable panel.

    Returns two lists:
      - entertainment: real non-wagering games (Ludo, Billiards, …).
      - betting: ONLY entries explicitly configured by an admin with a
        licensed provider. Empty by default. Entries with legal_status != "licensed"
        are returned as `enabled=false` so the client can render an
        "Unavailable" state — the spec FORBIDS fake providers.
    """
    db = app.state.db
    entries = await db.room_games_catalog.find({}).sort("order", 1).to_list(500)
    entertainment = [_public_catalog_entry(e) for e in entries if e.get("category") == "entertainment" and e.get("enabled", False)]
    betting = []
    for e in entries:
        if e.get("category") != "betting":
            continue
        pub = _public_catalog_entry(e)
        if (e.get("legal_status") != "licensed") or (not e.get("provider_id")) or (not e.get("provider_game_id")):
            pub["enabled"] = False
            pub["unavailable_reason"] = "Not configured by a licensed provider"
        betting.append(pub)
    return {"entertainment": entertainment, "betting": betting}


class _UpsertCatalogIn(BaseModel):
    category: str = Field(..., pattern=r"^(entertainment|betting)$")
    game_type: str = Field(..., min_length=2, max_length=48)
    title_en: str = Field(..., min_length=1, max_length=80)
    title_ar: str = Field(..., min_length=1, max_length=80)
    icon: Optional[str] = Field(None, max_length=48)
    enabled: bool = False
    order: int = 100
    min_players: Optional[int] = Field(None, ge=1, le=16)
    max_players: Optional[int] = Field(None, ge=1, le=16)
    # Betting-only fields; must all be present to be usable.
    provider_id: Optional[str] = Field(None, max_length=120)
    provider_game_id: Optional[str] = Field(None, max_length=120)
    jurisdictions: Optional[list[str]] = None
    wager_limits: Optional[list[int]] = None  # authoritative diamond amounts
    legal_status: Optional[str] = Field(None, max_length=24)  # "licensed", "pending", "disabled"


@api.get("/admin/room-games/catalog")
async def _admin_list_room_games_catalog(user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    items = [_public_catalog_entry(e) for e in await db.room_games_catalog.find({}).sort("order", 1).to_list(500)]
    return {"items": items}


@api.post("/admin/room-games/catalog", status_code=201)
async def _admin_upsert_room_games_catalog(body: _UpsertCatalogIn, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    doc = body.dict()
    doc["created_at"] = now_utc()
    try:
        existing = await db.room_games_catalog.find_one({"game_type": doc["game_type"]})
        if existing:
            await db.room_games_catalog.update_one(
                {"_id": existing["_id"]},
                {"$set": {**doc, "created_at": existing.get("created_at", now_utc())}},
            )
            fresh = await db.room_games_catalog.find_one({"_id": existing["_id"]})
            return _public_catalog_entry(fresh)
        r = await db.room_games_catalog.insert_one(doc)
        doc["_id"] = r.inserted_id
        return _public_catalog_entry(doc)
    except Exception:
        raise HTTPException(409, "Could not save catalog entry")


@api.delete("/admin/room-games/catalog/{entry_id}", status_code=204)
async def _admin_delete_room_games_catalog(entry_id: str, user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admins only")
    db = app.state.db
    try:
        await db.room_games_catalog.delete_one({"_id": ObjectId(entry_id)})
    except Exception:
        raise HTTPException(400, "Invalid entry_id")


# ----- Billiards — real server-authoritative 2-player game -----
# NOT a mockup. Server simulates deterministic physics on every shot and
# broadcasts a trajectory. No wagering, no financial coupling.

# Table coordinate system (abstract units; client scales).
_BIL_TABLE_W = 100.0
_BIL_TABLE_H = 50.0
_BIL_BALL_R = 2.0
_BIL_POCKET_R = 3.5
_BIL_POCKETS = [
    (0.0, 0.0), (_BIL_TABLE_W / 2.0, 0.0), (_BIL_TABLE_W, 0.0),
    (0.0, _BIL_TABLE_H), (_BIL_TABLE_W / 2.0, _BIL_TABLE_H), (_BIL_TABLE_W, _BIL_TABLE_H),
]
_BIL_CUE_START = (20.0, _BIL_TABLE_H / 2.0)
_BIL_FRICTION = 0.985  # per step
_BIL_MIN_SPEED = 0.08
_BIL_MAX_STEPS = 1200
_BIL_FRAME_EVERY = 2  # emit every 2nd physics step
_BIL_WIN_SCORE = 4


def _bil_initial_balls() -> list[dict]:
    """White cue + 6 object balls in a triangular rack (3-2-1)."""
    balls = [{"id": 0, "x": _BIL_CUE_START[0], "y": _BIL_CUE_START[1], "vx": 0.0, "vy": 0.0, "color": "white", "pocketed": False, "is_cue": True}]
    # Triangle apex at (70, 25).
    rack_x = 70.0
    rack_cy = _BIL_TABLE_H / 2.0
    sp = _BIL_BALL_R * 2.0 + 0.25
    layout = [
        (0, 0),             # row 0: 1 ball
        (sp * 0.866, -1.0), # row 1: 2 balls (offset diagonally)
        (sp * 0.866,  1.0),
        (sp * 1.732, -2.0), # row 2: 3 balls
        (sp * 1.732,  0.0),
        (sp * 1.732,  2.0),
    ]
    colors = ["red", "yellow", "blue", "green", "purple", "orange"]
    for i, (dx, dy) in enumerate(layout):
        balls.append({
            "id": i + 1,
            "x": rack_x + dx,
            "y": rack_cy + dy * sp,
            "vx": 0.0, "vy": 0.0,
            "color": colors[i],
            "pocketed": False,
            "is_cue": False,
        })
    return balls


def _bil_simulate_shot(balls: list[dict], angle_deg: float, power: float) -> dict:
    """Deterministic physics simulation. Returns {frames, events, final}.
    frames = list of lightweight snapshots for client animation."""
    import math as _m
    cue = next((b for b in balls if b["is_cue"]), None)
    if cue is None or cue["pocketed"]:
        # Respawn the cue if needed.
        for b in balls:
            if b["is_cue"]:
                b["x"] = _BIL_CUE_START[0]
                b["y"] = _BIL_CUE_START[1]
                b["pocketed"] = False
                b["vx"] = 0.0; b["vy"] = 0.0
                cue = b
                break
    assert cue is not None
    power = max(10.0, min(100.0, float(power)))
    speed = power * 0.9  # convert to units/step
    rad = _m.radians(float(angle_deg))
    cue["vx"] = _m.cos(rad) * speed
    cue["vy"] = _m.sin(rad) * speed

    frames: list[list[dict]] = []
    events: list[dict] = []
    pocketed_this_shot: list[dict] = []

    def snap() -> list[dict]:
        return [{"id": b["id"], "x": round(b["x"], 3), "y": round(b["y"], 3), "pocketed": b["pocketed"]} for b in balls]

    for step in range(_BIL_MAX_STEPS):
        # Move + friction.
        any_moving = False
        for b in balls:
            if b["pocketed"]:
                continue
            if abs(b["vx"]) < _BIL_MIN_SPEED and abs(b["vy"]) < _BIL_MIN_SPEED:
                b["vx"] = 0.0; b["vy"] = 0.0
                continue
            any_moving = True
            b["x"] += b["vx"] * 0.1
            b["y"] += b["vy"] * 0.1
            b["vx"] *= _BIL_FRICTION
            b["vy"] *= _BIL_FRICTION
            # Wall reflection.
            if b["x"] < _BIL_BALL_R:
                b["x"] = _BIL_BALL_R; b["vx"] = -b["vx"]
            elif b["x"] > _BIL_TABLE_W - _BIL_BALL_R:
                b["x"] = _BIL_TABLE_W - _BIL_BALL_R; b["vx"] = -b["vx"]
            if b["y"] < _BIL_BALL_R:
                b["y"] = _BIL_BALL_R; b["vy"] = -b["vy"]
            elif b["y"] > _BIL_TABLE_H - _BIL_BALL_R:
                b["y"] = _BIL_TABLE_H - _BIL_BALL_R; b["vy"] = -b["vy"]
        # Ball-ball collisions.
        for i in range(len(balls)):
            for j in range(i + 1, len(balls)):
                A = balls[i]; B = balls[j]
                if A["pocketed"] or B["pocketed"]:
                    continue
                dx = B["x"] - A["x"]; dy = B["y"] - A["y"]
                dist2 = dx * dx + dy * dy
                if dist2 < (2 * _BIL_BALL_R) ** 2 and dist2 > 1e-9:
                    dist = dist2 ** 0.5
                    nx = dx / dist; ny = dy / dist
                    # Separate overlap.
                    overlap = 2 * _BIL_BALL_R - dist
                    A["x"] -= nx * overlap / 2.0
                    A["y"] -= ny * overlap / 2.0
                    B["x"] += nx * overlap / 2.0
                    B["y"] += ny * overlap / 2.0
                    # Relative velocity along normal.
                    rvx = B["vx"] - A["vx"]
                    rvy = B["vy"] - A["vy"]
                    vel_along = rvx * nx + rvy * ny
                    if vel_along < 0:
                        # Elastic equal-mass: swap along normal.
                        A["vx"] += vel_along * nx
                        A["vy"] += vel_along * ny
                        B["vx"] -= vel_along * nx
                        B["vy"] -= vel_along * ny
                        events.append({"type": "collide", "a": A["id"], "b": B["id"], "step": step})
        # Pocket check.
        for b in balls:
            if b["pocketed"]:
                continue
            for px, py in _BIL_POCKETS:
                if (b["x"] - px) ** 2 + (b["y"] - py) ** 2 <= _BIL_POCKET_R ** 2:
                    b["pocketed"] = True
                    b["vx"] = 0.0; b["vy"] = 0.0
                    pocketed_this_shot.append({"id": b["id"], "is_cue": b["is_cue"]})
                    events.append({"type": "pocket", "ball": b["id"], "is_cue": b["is_cue"], "step": step})
                    break
        if step % _BIL_FRAME_EVERY == 0:
            frames.append(snap())
        if not any_moving:
            break

    frames.append(snap())
    return {"frames": frames, "events": events, "pocketed": pocketed_this_shot, "final": [dict(b) for b in balls]}


class _CreateBilliardsIn(BaseModel):
    room_id: str = Field(..., min_length=1)


@api.post("/games/billiards/create", status_code=201)
async def _create_billiards(body: _CreateBilliardsIn, user=Depends(current_user)):
    """Create a new 2-player Billiards session anchored to a room."""
    db = app.state.db
    try:
        room = await db.rooms.find_one({"_id": ObjectId(body.room_id)})
    except Exception:
        raise HTTPException(400, "Invalid room_id")
    if not room:
        raise HTTPException(404, "Room not found")
    existing = await db.games.find_one({"room_id": body.room_id, "game_type": "billiards", "status": {"$in": ["waiting", "active"]}})
    if existing:
        return _public_billiards(existing)
    now_t = now_utc()
    uid = str(user["_id"])
    doc = {
        "game_id": _new_game_id(),
        "game_type": "billiards",
        "room_id": body.room_id,
        "owner_id": uid,
        "mode": "casual",  # NO wagering, EVER.
        "status": "waiting",
        "players": [{
            "user_id": uid,
            "nickname": user.get("nickname") or "Player",
            "avatar_url": user.get("avatar_url"),
            "seat": 0,
            "score": 0,
            "legal_pots": 0,
            "joined_at": now_t,
            "is_connected": True,
            "forfeited": False,
        }],
        "state": {
            "balls": _bil_initial_balls(),
            "current_turn": 0,
            "shots_count": 0,
            "last_shot": None,
            "last_action_at": now_t,
        },
        "winner_seat": None,
        "winner_user_id": None,
        "created_at": now_t,
        "updated_at": now_t,
        "started_at": None,
        "finished_at": None,
    }
    for _ in range(5):
        try:
            r = await db.games.insert_one(doc)
            doc["_id"] = r.inserted_id
            break
        except Exception:
            doc["game_id"] = _new_game_id()
    else:
        raise HTTPException(500, "Could not allocate game_id")
    return _public_billiards(doc)


def _public_billiards(game: dict) -> dict:
    return {
        "id": str(game.get("_id")) if game.get("_id") else None,
        "game_id": game["game_id"],
        "game_type": "billiards",
        "room_id": game.get("room_id"),
        "owner_id": game.get("owner_id"),
        "mode": "casual",
        "status": game["status"],
        "players": sorted([
            {
                "user_id": p["user_id"],
                "nickname": p.get("nickname"),
                "avatar_url": p.get("avatar_url"),
                "seat": p["seat"],
                "score": int(p.get("score", 0)),
                "legal_pots": int(p.get("legal_pots", 0)),
                "is_connected": bool(p.get("is_connected", True)),
                "forfeited": bool(p.get("forfeited", False)),
            } for p in game.get("players", [])
        ], key=lambda x: x["seat"]),
        "state": game.get("state", {}),
        "winner_seat": game.get("winner_seat"),
        "winner_user_id": game.get("winner_user_id"),
        "created_at": game["created_at"].isoformat() if isinstance(game.get("created_at"), datetime) else game.get("created_at"),
        "started_at": game["started_at"].isoformat() if isinstance(game.get("started_at"), datetime) else game.get("started_at"),
        "finished_at": game["finished_at"].isoformat() if isinstance(game.get("finished_at"), datetime) else game.get("finished_at"),
        "table": {"w": _BIL_TABLE_W, "h": _BIL_TABLE_H, "ball_r": _BIL_BALL_R, "pocket_r": _BIL_POCKET_R, "pockets": _BIL_POCKETS},
    }


@api.post("/games/billiards/{game_id}/join")
async def _join_billiards(game_id: str, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g.get("game_type") != "billiards":
        raise HTTPException(400, "Not a billiards game")
    if g["status"] != "waiting":
        raise HTTPException(409, "Game already started")
    if any(p["user_id"] == uid for p in g["players"]):
        return _public_billiards(g)
    if len(g["players"]) >= 2:
        raise HTTPException(409, "Game is full")
    new_player = {
        "user_id": uid,
        "nickname": user.get("nickname") or "Player",
        "avatar_url": user.get("avatar_url"),
        "seat": 1,
        "score": 0,
        "legal_pots": 0,
        "joined_at": now_utc(),
        "is_connected": True,
        "forfeited": False,
    }
    await db.games.update_one(
        {"game_id": game_id, "status": "waiting", "players.user_id": {"$ne": uid}},
        {"$push": {"players": new_player}, "$set": {"updated_at": now_utc()}},
    )
    g = await _find_game_or_404(db, game_id)
    # Auto-start when 2 players are seated.
    if len(g["players"]) == 2:
        await db.games.update_one(
            {"game_id": game_id, "status": "waiting"},
            {"$set": {"status": "active", "started_at": now_utc(),
                      "state.current_turn": 0, "state.last_action_at": now_utc()}},
        )
        g = await _find_game_or_404(db, game_id)
    await _broadcast_game(game_id, db)
    return _public_billiards(g)


@api.post("/games/billiards/{game_id}/leave")
async def _leave_billiards(game_id: str, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g.get("game_type") != "billiards":
        raise HTTPException(400, "Not a billiards game")
    if g["status"] == "waiting":
        await db.games.update_one(
            {"game_id": game_id},
            {"$pull": {"players": {"user_id": uid}}, "$set": {"updated_at": now_utc()}},
        )
        g = await db.games.find_one({"game_id": game_id})
        if g and not g["players"]:
            await db.games.update_one({"game_id": game_id}, {"$set": {"status": "abandoned", "finished_at": now_utc()}})
            g = await _find_game_or_404(db, game_id)
    elif g["status"] == "active":
        await db.games.update_one(
            {"game_id": game_id, "players.user_id": uid},
            {"$set": {"players.$.forfeited": True, "updated_at": now_utc()}},
        )
        g = await _find_game_or_404(db, game_id)
        remaining = [p for p in g["players"] if not p.get("forfeited")]
        if len(remaining) <= 1:
            winner = remaining[0] if remaining else None
            upd = {"status": "finished", "finished_at": now_utc()}
            if winner:
                upd["winner_seat"] = winner["seat"]
                upd["winner_user_id"] = winner["user_id"]
            await db.games.update_one({"game_id": game_id}, {"$set": upd})
            g = await _find_game_or_404(db, game_id)
            await _award_billiards_xp(db, g)
    await _broadcast_game(game_id, db)
    return _public_billiards(g)


class _BilliardsShotIn(BaseModel):
    angle_deg: float = Field(..., ge=-360.0, le=720.0)
    power: float = Field(..., ge=10.0, le=100.0)
    client_tag: Optional[str] = Field(None, max_length=48)  # for idempotency hints only


@api.post("/games/billiards/{game_id}/shot")
async def _billiards_shot(game_id: str, body: _BilliardsShotIn, user=Depends(current_user)):
    """Server-authoritative billiards shot. Simulates physics deterministically
    and broadcasts the trajectory. NO wagering, NO ledger changes."""
    db = app.state.db
    uid = str(user["_id"])
    g = await _find_game_or_404(db, game_id)
    if g.get("game_type") != "billiards":
        raise HTTPException(400, "Not a billiards game")
    if g["status"] != "active":
        raise HTTPException(409, "Game is not active")
    me_player = next((p for p in g["players"] if p["user_id"] == uid and not p.get("forfeited")), None)
    if not me_player:
        raise HTTPException(403, "You are not an active player")
    if g["state"]["current_turn"] != me_player["seat"]:
        raise HTTPException(403, "Not your turn")

    balls = [dict(b) for b in g["state"]["balls"]]
    sim = _bil_simulate_shot(balls, body.angle_deg, body.power)

    # Scoring based on this shot's pockets.
    delta_score = 0
    delta_legal_pots = 0
    cue_scratched = any(p["is_cue"] for p in sim["pocketed"])
    for p in sim["pocketed"]:
        if p["is_cue"]:
            delta_score -= 1
        else:
            delta_score += 1
            delta_legal_pots += 1
    extra_turn = (delta_legal_pots > 0) and (not cue_scratched)

    # If cue scratched, respawn cue at start cell.
    if cue_scratched:
        for b in sim["final"]:
            if b["is_cue"]:
                b["x"] = _BIL_CUE_START[0]
                b["y"] = _BIL_CUE_START[1]
                b["pocketed"] = False
                b["vx"] = 0.0; b["vy"] = 0.0
                break

    # Advance turn.
    new_turn = me_player["seat"] if extra_turn else (1 - me_player["seat"])
    now_t = now_utc()
    seq = int(g["state"].get("shots_count", 0)) + 1
    last_shot = {
        "seat": me_player["seat"],
        "angle_deg": body.angle_deg,
        "power": body.power,
        "events": sim["events"],
        "pocketed": sim["pocketed"],
        "frames": sim["frames"],  # client animation payload (compact).
        "seq": seq,
        "at": now_t.isoformat(),
    }
    # Persist updated state.
    await db.games.update_one(
        {"game_id": game_id, "status": "active", "state.current_turn": me_player["seat"]},
        {
            "$set": {
                "state.balls": sim["final"],
                "state.current_turn": new_turn,
                "state.last_action_at": now_t,
                "state.last_shot": last_shot,
                "updated_at": now_t,
            },
            "$inc": {"state.shots_count": 1},
        },
    )
    # Update player scores.
    if delta_score != 0 or delta_legal_pots != 0:
        await db.games.update_one(
            {"game_id": game_id, "players.user_id": uid},
            {"$inc": {"players.$.score": delta_score, "players.$.legal_pots": delta_legal_pots}},
        )
    await db.game_moves.insert_one({
        "game_id": game_id, "seq": seq, "kind": "shot",
        "user_id": uid, "seat": me_player["seat"],
        "angle_deg": body.angle_deg, "power": body.power,
        "events": sim["events"], "pocketed": sim["pocketed"],
        "created_at": now_t,
    })

    # Win check: all 6 object balls pocketed OR a player reaches _BIL_WIN_SCORE.
    g = await _find_game_or_404(db, game_id)
    object_balls_remaining = sum(1 for b in g["state"]["balls"] if not b["is_cue"] and not b["pocketed"])
    top = max(g["players"], key=lambda p: int(p.get("score", 0)))
    if object_balls_remaining == 0 or int(top.get("score", 0)) >= _BIL_WIN_SCORE:
        winner = top
        await db.games.update_one(
            {"game_id": game_id, "status": "active"},
            {"$set": {
                "status": "finished",
                "winner_seat": winner["seat"],
                "winner_user_id": winner["user_id"],
                "finished_at": now_t,
            }},
        )
        g = await _find_game_or_404(db, game_id)
        await _award_billiards_xp(db, g)
    await _broadcast_game(game_id, db)
    return _public_billiards(g)


async def _award_billiards_xp(db, g: dict) -> None:
    """Casual XP ONLY. Never touches diamonds or financial ledger."""
    if g.get("xp_awarded"):
        return
    now_t = now_utc()
    awards = {}
    winner_id = g.get("winner_user_id")
    for p in g.get("players", []):
        pid = p["user_id"]
        if pid == winner_id:
            awards[pid] = 40
        elif p.get("forfeited"):
            awards[pid] = 2
        else:
            awards[pid] = 10
    r = await db.games.update_one(
        {"game_id": g["game_id"], "xp_awarded": {"$ne": True}},
        {"$set": {"xp_awarded": True, "xp_awards": awards, "updated_at": now_t}},
    )
    if r.modified_count == 0:
        return
    for pid, amt in awards.items():
        try:
            await db.users.update_one({"_id": ObjectId(pid)}, {"$inc": {"games_xp": int(amt)}})
            await db.games_xp_ledger.insert_one({
                "user_id": pid, "game_id": g["game_id"], "game_type": g["game_type"],
                "xp": int(amt),
                "reason": "winner" if pid == winner_id else ("forfeit" if any(p["user_id"] == pid and p.get("forfeited") for p in g["players"]) else "finished"),
                "created_at": now_t,
            })
        except Exception:
            continue


@api.get("/rooms/{room_id}/games/billiards/active")
async def _get_active_billiards_for_room(room_id: str, user=Depends(current_user)):
    db = app.state.db
    try:
        g = await db.games.find_one({"room_id": room_id, "game_type": "billiards", "status": {"$in": ["waiting", "active"]}})
    except Exception:
        g = None
    return {"game": _public_billiards(g) if g else None}


# ============================================================================
# Iter-47 Phase 6 — Phone OTP (Twilio Verify) + Facebook Login
# ============================================================================
# All provider credentials are env-only. If the credentials are not present
# the corresponding endpoints return a clear 503 — NO MOCKS, no fake OTP,
# no fake Facebook token acceptance.

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_VERIFY_SERVICE_SID = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()

FACEBOOK_APP_ID = os.environ.get("FACEBOOK_APP_ID", "").strip()
FACEBOOK_APP_SECRET = os.environ.get("FACEBOOK_APP_SECRET", "").strip()


def _twilio_enabled() -> bool:
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID)


def _facebook_enabled() -> bool:
    return bool(FACEBOOK_APP_ID and FACEBOOK_APP_SECRET)


_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _norm_phone(p: str) -> str:
    """Return a strict E.164 phone number (`+<country><number>`), stripped of spaces/dashes."""
    if not isinstance(p, str):
        raise HTTPException(400, "Invalid phone number")
    cleaned = re.sub(r"[\s\-\(\)]", "", p.strip())
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not _E164_RE.match(cleaned):
        raise HTTPException(400, "Phone must be in E.164 format (e.g. +14155550123)")
    return cleaned


# ---- Rate limiter (collection-based, TTL-indexed) ----
async def _ensure_otp_indexes():
    try:
        db = app.state.db
        await db.otp_attempts.create_index("expires_at", expireAfterSeconds=0)
        await db.otp_attempts.create_index([("phone", 1), ("kind", 1)])
    except Exception:
        pass


async def _otp_rate_check(phone: str, kind: str, limit: int, window_seconds: int) -> None:
    """Insert an attempt record, then count how many fall inside the window.
    Raises HTTPException(429) if over limit. kind: 'send' | 'verify'."""
    db = app.state.db
    now = now_utc()
    expires = now + timedelta(seconds=window_seconds)
    await db.otp_attempts.insert_one({
        "phone": phone, "kind": kind, "created_at": now, "expires_at": expires,
    })
    count = await db.otp_attempts.count_documents({
        "phone": phone, "kind": kind,
        "created_at": {"$gte": now - timedelta(seconds=window_seconds)},
    })
    if count > limit:
        raise HTTPException(429, "Too many attempts. Please wait before trying again.")


# ---- Models ----
class _PhoneSendIn(BaseModel):
    phone: str = Field(min_length=5, max_length=24)


class _PhoneVerifyIn(BaseModel):
    phone: str = Field(min_length=5, max_length=24)
    code: str = Field(min_length=4, max_length=10)
    nickname: Optional[str] = Field(default=None, max_length=30)


class _FacebookExchangeIn(BaseModel):
    access_token: str = Field(min_length=10, max_length=4096)


# ---- Providers config (frontend reads this to know what to enable) ----
@api.get("/auth/providers")
async def _auth_providers():
    return {
        "google": True,
        "email": True,
        "phone": _twilio_enabled(),
        "facebook": _facebook_enabled(),
        "apple": bool(APPLE_AUDIENCES),
    }


# Public, non-secret FB config so the frontend doesn't hardcode the app_id.
# The App ID is PUBLIC by design (it ships in the OAuth URL). The App Secret
# never leaves the backend.
@api.get("/auth/facebook/public-config")
async def _auth_facebook_public_config():
    if not _facebook_enabled():
        raise HTTPException(503, "Facebook sign-in is not configured.")
    return {"app_id": FACEBOOK_APP_ID}


# ---- Phone OTP via Twilio Verify ----
@api.post("/auth/phone/send-otp")
async def _auth_phone_send_otp(body: _PhoneSendIn):
    if not _twilio_enabled():
        raise HTTPException(
            503,
            "Phone sign-in is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in the backend .env.",
        )
    phone = _norm_phone(body.phone)
    await _ensure_otp_indexes()
    # 5 OTP sends per phone per 10 minutes.
    await _otp_rate_check(phone, "send", limit=5, window_seconds=600)

    url = f"https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/Verifications"
    try:
        async with _httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                url,
                data={"To": phone, "Channel": "sms"},
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
            )
    except Exception:
        raise HTTPException(503, "SMS provider unavailable. Please try again.")
    if r.status_code >= 400:
        # Do not leak Twilio internals; log server-side.
        try:
            logger.warning("twilio send-otp %s: %s", r.status_code, r.text[:400])
        except Exception:
            pass
        raise HTTPException(400, "Could not send OTP. Please check the phone number.")
    try:
        js = r.json()
    except Exception:
        js = {}
    return {
        "ok": True,
        "status": js.get("status", "pending"),
        "resend_cooldown_seconds": 30,
    }


@api.post("/auth/phone/verify-otp", response_model=Tokens)
async def _auth_phone_verify_otp(body: _PhoneVerifyIn):
    if not _twilio_enabled():
        raise HTTPException(
            503,
            "Phone sign-in is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in the backend .env.",
        )
    phone = _norm_phone(body.phone)
    code = body.code.strip()
    if not re.match(r"^\d{4,10}$", code):
        raise HTTPException(400, "Invalid OTP code")

    await _ensure_otp_indexes()
    # 10 verify attempts per phone per 10 minutes.
    await _otp_rate_check(phone, "verify", limit=10, window_seconds=600)

    url = f"https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/VerificationCheck"
    try:
        async with _httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                url,
                data={"To": phone, "Code": code},
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
            )
    except Exception:
        raise HTTPException(503, "SMS provider unavailable. Please try again.")

    approved = False
    status_str = "unknown"
    if r.status_code < 400:
        try:
            js = r.json()
            status_str = js.get("status", "unknown")
            approved = status_str == "approved"
        except Exception:
            pass
    else:
        try:
            logger.warning("twilio verify-otp %s: %s", r.status_code, r.text[:400])
        except Exception:
            pass

    if not approved:
        raise HTTPException(401, "Invalid or expired OTP")

    db = app.state.db
    user = await db.users.find_one({"phone": phone})
    if not user:
        # Create a brand-new ORIO account linked to this phone number.
        from account_deletion import assert_credential_reusable as _reuse_ok
        await _reuse_ok(db, phone=phone)
        base = "orio" + re.sub(r"\D", "", phone)[-6:]
        candidate = base[:14]
        i = 0
        while await db.users.find_one({"username": candidate}):
            i += 1
            candidate = f"{base[:12]}{i}"[:14]
        nickname = (body.nickname or f"Yazeen {phone[-4:]}")[:30]
        doc = {
            "phone": phone,
            "username": candidate,
            "nickname": nickname,
            "auth_provider": "phone",
            "password_hash": pw_hash(secrets.token_hex(24)),
            "avatar_url": f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
            "bio": "",
            "level": 1,
            "wealth_level": 0,
            "charm_level": 0,
            "vip_level": 0,
            "wealth_points": 0,
            "charm_points": 0,
            "growth_points": 0,
            "coins": 500,
            "diamonds": 10,
            "experience": 0,
            "followers_count": 0,
            "following_count": 0,
            "numeric_id": await _generate_unique_numeric_id(db),
            "created_at": now_utc(),
            "language": "en",
        }
        ins = await db.users.insert_one(doc)
        uid = str(ins.inserted_id)
        await db.wallet_transactions.insert_one({
            "user_id": uid, "type": "welcome_bonus", "currency": "coins",
            "amount": 500, "balance_after": 500, "created_at": now_utc(),
            "status": "completed", "description": "Welcome to Yazeen!",
        })
    else:
        uid = str(user["_id"])
        # If this user existed without a phone/provider, backfill both so the
        # account stays unified.
        patch = {}
        if not user.get("auth_provider"):
            patch["auth_provider"] = user.get("auth_provider") or "phone"
        if patch:
            await db.users.update_one({"_id": user["_id"]}, {"$set": patch})
    # Clear verify attempts for this phone.
    try:
        await db.otp_attempts.delete_many({"phone": phone})
    except Exception:
        pass
    return await issue_pair(db, uid)


# ---- Facebook Login ----
@api.post("/auth/facebook/exchange", response_model=Tokens)
async def _auth_facebook_exchange(body: _FacebookExchangeIn):
    if not _facebook_enabled():
        raise HTTPException(
            503,
            "Facebook sign-in is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in the backend .env.",
        )
    user_at = body.access_token.strip()
    app_token = f"{FACEBOOK_APP_ID}|{FACEBOOK_APP_SECRET}"
    try:
        async with _httpx.AsyncClient(timeout=12.0) as client:
            # 1. Validate the user token belongs to our app.
            d = await client.get(
                "https://graph.facebook.com/debug_token",
                params={"input_token": user_at, "access_token": app_token},
            )
            if d.status_code >= 400:
                raise HTTPException(401, "Facebook token could not be validated")
            dj = d.json().get("data") or {}
            if not dj.get("is_valid"):
                raise HTTPException(401, "Facebook token is invalid or expired")
            if str(dj.get("app_id")) != str(FACEBOOK_APP_ID):
                raise HTTPException(401, "Facebook token was issued for another app")
            # 2. Fetch the user profile.
            m = await client.get(
                "https://graph.facebook.com/me",
                params={
                    "fields": "id,email,name,picture.width(256).height(256)",
                    "access_token": user_at,
                },
            )
            if m.status_code >= 400:
                raise HTTPException(401, "Facebook profile could not be fetched")
            prof = m.json() or {}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Facebook service unavailable")

    fb_id = str(prof.get("id") or "").strip()
    if not fb_id:
        raise HTTPException(401, "Facebook did not return a valid user id")
    email = norm_email(prof.get("email") or "") or None
    name = (prof.get("name") or "Yazeen User")[:30]
    pic = None
    try:
        pic = prof.get("picture", {}).get("data", {}).get("url")
    except Exception:
        pic = None

    db = app.state.db
    # Unified-account strategy: try FB id first, then email.
    user = await db.users.find_one({"facebook_id": fb_id})
    if not user and email:
        user = await db.users.find_one({"email": email})
    if user:
        uid = str(user["_id"])
        patch = {}
        if not user.get("facebook_id"):
            patch["facebook_id"] = fb_id
        if not user.get("auth_provider"):
            patch["auth_provider"] = "facebook"
        if email and not user.get("email"):
            patch["email"] = email
        if patch:
            try:
                await db.users.update_one({"_id": user["_id"]}, {"$set": patch})
            except Exception:
                # Email collision is possible if someone registered with the
                # same email later; we silently skip rather than fail login.
                patch.pop("email", None)
                if patch:
                    await db.users.update_one({"_id": user["_id"]}, {"$set": patch})
    else:
        from account_deletion import assert_credential_reusable as _reuse_ok
        await _reuse_ok(db, facebook_id=fb_id, email=email)
        base = "fb" + fb_id[-8:]
        candidate = base[:14]
        i = 0
        while await db.users.find_one({"username": candidate}):
            i += 1
            candidate = f"{base[:12]}{i}"[:14]
        doc = {
            "facebook_id": fb_id,
            "username": candidate,
            "nickname": name,
            "auth_provider": "facebook",
            "password_hash": pw_hash(secrets.token_hex(24)),
            "avatar_url": pic or f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
            "bio": "",
            "level": 1,
            "wealth_level": 0,
            "charm_level": 0,
            "vip_level": 0,
            "wealth_points": 0,
            "charm_points": 0,
            "growth_points": 0,
            "coins": 500,
            "diamonds": 10,
            "experience": 0,
            "followers_count": 0,
            "following_count": 0,
            "numeric_id": await _generate_unique_numeric_id(db),
            "created_at": now_utc(),
            "language": "en",
        }
        if email:
            doc["email"] = email
        try:
            ins = await db.users.insert_one(doc)
        except Exception:
            # Rare race on unique email index — if a parallel register happened
            # between our lookup and insert, re-read and treat as existing.
            if email:
                user = await db.users.find_one({"email": email})
                if user:
                    uid = str(user["_id"])
                    await db.users.update_one({"_id": user["_id"]}, {"$set": {"facebook_id": fb_id}})
                    return await issue_pair(db, uid)
            raise HTTPException(500, "Could not create Facebook account")
        uid = str(ins.inserted_id)
        await db.wallet_transactions.insert_one({
            "user_id": uid, "type": "welcome_bonus", "currency": "coins",
            "amount": 500, "balance_after": 500, "created_at": now_utc(),
            "status": "completed", "description": "Welcome to Yazeen!",
        })
    return await issue_pair(db, uid)


# ============================================================================
# Iter-52 — Room deletion + Supporter ranking
# ============================================================================
# Reuses: gift_transactions (room_id, sender_id, recipient_id, total_cost,
# created_at), users (public_user shape), rooms (ownership + is_live flag).

@api.delete("/rooms/{room_id}", status_code=200)
async def _delete_room(room_id: str, user=Depends(current_user)):
    """Soft-delete a live room. Only the owner may delete.
    Sets is_live:false + is_deleted:true. Frees up the owner's one-room-per-user
    slot (partial unique index). Participants navigate away on their next poll.
    """
    db = app.state.db
    try:
        room = await db.rooms.find_one({"_id": ObjectId(room_id)})
    except Exception:
        raise HTTPException(404, "Room not found")
    if not room:
        raise HTTPException(404, "Room not found")
    if str(room.get("owner_id")) != str(user["_id"]):
        raise HTTPException(403, "Only the room owner can delete this room")
    if room.get("is_deleted"):
        return {"ok": True, "already_deleted": True}
    await db.rooms.update_one(
        {"_id": room["_id"]},
        {"$set": {
            "is_live": False,
            "is_deleted": True,
            "deleted_at": now_utc(),
        }},
    )
    return {"ok": True}


# ---- Supporter ranking (contribution + charm, 4 UTC time windows) ----

def _ranking_window_start(period: str):
    """Server-authoritative UTC cutoff for ranking windows (iter-57).
      daily   → rolling last 24h
      weekly  → rolling last 168h
      monthly → first day of the current UTC calendar month
      all     → None (lifetime)
    """
    now = datetime.now(timezone.utc)
    p = (period or "all").lower()
    if p in ("daily", "day"):
        return now - timedelta(hours=24)
    if p in ("weekly", "week"):
        return now - timedelta(hours=168)
    if p in ("monthly", "month"):
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return None


@api.get("/rooms/{room_id}/ranking")
async def _room_ranking(
    room_id: str,
    metric: str = "contribution",
    period: str = "all",
    user=Depends(current_user),
):
    """Top-50 supporter ranking for a specific room.
    metric=contribution → senders of gifts in this room
    metric=charm        → recipients of gifts in this room
    All amounts come from gift_transactions — no second source of truth.
    """
    db = app.state.db
    try:
        room = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"_id": 1})
    except Exception:
        raise HTTPException(404, "Room not found")
    if not room:
        raise HTTPException(404, "Room not found")

    metric = (metric or "contribution").lower()
    if metric not in ("contribution", "charm"):
        raise HTTPException(400, "metric must be 'contribution' or 'charm'")

    cutoff = _ranking_window_start(period)
    match: dict = {"room_id": room_id}
    if cutoff is not None:
        match["created_at"] = {"$gte": cutoff}

    group_field = "$sender_id" if metric == "contribution" else "$recipient_id"
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": group_field,
            "amount": {"$sum": "$total_cost"},
            "gift_count": {"$sum": "$quantity"},
        }},
        {"$sort": {"amount": -1}},
        {"$limit": 50},
    ]
    rows: list = []
    async for r in db.gift_transactions.aggregate(pipeline):
        rows.append(r)
    if not rows:
        return {"metric": metric, "period": period, "items": [], "me": await _room_rank_me(db, match, group_field, user, [])}

    ids = []
    for r in rows:
        try:
            ids.append(ObjectId(r["_id"]))
        except Exception:
            pass
    users_by_id: dict = {}
    if ids:
        async for u in db.users.find(
            {"_id": {"$in": ids}},
            {"nickname": 1, "avatar_url": 1, "vip_level": 1,
             "numeric_id": 1, "country_flag": 1, "created_at": 1},
        ):
            users_by_id[str(u["_id"])] = u

    items = []
    for rank, r in enumerate(rows, start=1):
        uid = str(r["_id"] or "")
        u = users_by_id.get(uid, {})
        items.append({
            "rank": rank,
            "user": {
                "id": uid,
                "nickname": u.get("nickname") or "User",
                "avatar_url": u.get("avatar_url"),
                "vip_level": u.get("vip_level", 0),
                "name_color": _vip_name_color(int(u.get("vip_level", 0) or 0)),
                "numeric_id": u.get("numeric_id"),
                "country_flag": u.get("country_flag"),
                "is_new": _is_new_user(u.get("created_at")),
            },
            "amount": int(r.get("amount", 0)) * RANK_POINTS_PER_DIAMOND,
            "gift_count": int(r.get("gift_count", 0)),
        })
    return {"metric": metric, "period": period, "items": items, "me": await _room_rank_me(db, match, group_field, user, items)}


async def _room_rank_me(db, match: dict, group_field: str, user: dict, items: list) -> dict:
    uid = str(user["_id"])
    hit = next((it for it in items if it["user"]["id"] == uid), None)
    if hit:
        return hit
    agg = [x async for x in db.gift_transactions.aggregate([{"$match": {**match, group_field[1:]: uid}},
                                                           {"$group": {"_id": None, "amount": {"$sum": "$total_cost"}, "n": {"$sum": "$quantity"}}}])]
    amt = agg[0]["amount"] if agg else 0
    rank = 0
    if amt > 0:
        ahead = [x async for x in db.gift_transactions.aggregate([{"$match": match}, {"$group": {"_id": group_field, "a": {"$sum": "$total_cost"}}},
                                                                 {"$match": {"a": {"$gt": amt}}}, {"$count": "n"}])]
        rank = (ahead[0]["n"] if ahead else 0) + 1
    _vl = int(user.get("vip_level", 0) or 0)
    return {"rank": rank, "amount": int(amt) * RANK_POINTS_PER_DIAMOND, "gift_count": int(agg[0]["n"]) if agg else 0,
            "user": {"id": uid, "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"), "vip_level": _vl,
                     "name_color": _vip_name_color(_vl), "numeric_id": user.get("numeric_id"), "country_flag": user.get("country_flag")}}



# ───────────── Batch C — Room music (synchronized state; audio via Agora mixing) ─────────────
# Iter-153 — "From Internet" streams from Audius (artist-authorised, free public
# API, no key). Only tracks Audius marks streamable & ungated are shown, so every
# listed track is immediately playable. Legacy ids still resolve via admin-set
# licensed_url (db.music_catalog) but are hidden unless a URL is configured.
AUDIUS_API = "https://api.audius.co/v1"
AUDIUS_APP = "ORIO"
_audius_cache: dict = {}
# 30 famous Arabic songs (metadata only). Playback URLs must be licensed and are
# configured by admins in db.music_catalog.licensed_url — never bundled here.
ARABIC_CATALOG = [
    ("ana_lahbibi", "أنا لحبيبي", "فيروز"), ("enta_omri", "إنت عمري", "أم كلثوم"), ("alf_leila", "ألف ليلة وليلة", "أم كلثوم"),
    ("tamally_maak", "تملي معاك", "عمرو دياب"), ("nour_el_ein", "نور العين", "عمرو دياب"), ("habibi_ya_nour", "حبيبي يا نور العين", "عمرو دياب"),
    ("qariat_alfinjan", "قارئة الفنجان", "عبد الحليم حافظ"), ("ahwak", "أهواك", "عبد الحليم حافظ"), ("zay_el_hawa", "زي الهوا", "عبد الحليم حافظ"),
    ("ya_tayr", "يا طير", "راشد الماجد"), ("al_amaken", "الأماكن", "محمد عبده"), ("ala_el_bal", "على البال", "محمد عبده"),
    ("kifak_enta", "كيفك إنت", "فيروز"), ("shayef_el_bahr", "شايف البحر شو كبير", "فيروز"), ("aatini_el_nay", "أعطني الناي وغنِّ", "فيروز"),
    ("ah_w_noss", "آه ونص", "نانسي عجرم"), ("ya_salam", "يا سلام", "نانسي عجرم"), ("ehsas_jdeed", "إحساس جديد", "نانسي عجرم"),
    ("ahebak", "أحبك", "حسين الجسمي"), ("bahibak_ya_masr", "بحبك يا مصر", "حسين الجسمي"), ("fakdetak", "فقدتك", "حسين الجسمي"),
    ("qadeet_omri", "قضيت عمري", "كاظم الساهر"), ("zidini_ishqan", "زيديني عشقاً", "كاظم الساهر"), ("ana_wa_laila", "أنا وليلى", "كاظم الساهر"),
    ("akhasmak_ah", "أخاصمك آه", "نانسي عجرم"), ("leilet_hob", "ليلة حب", "أم كلثوم"), ("lamma_bada", "لما بدا يتثنى", "فيروز"),
    ("ya_rayeh", "يا رايح", "رشيد طه"), ("sidi_mansour", "سيدي منصور", "صابر الرباعي"), ("ya_lalali", "يا لالالي", "صابر الرباعي"),
]


def _audius_item(t: dict) -> Optional[dict]:
    if not t.get("is_streamable", True) or t.get("stream_conditions") or t.get("is_delete") or t.get("is_unlisted"):
        return None
    if t.get("is_available") is False or int(t.get("duration") or 0) < 30:
        return None
    art = (t.get("artwork") or {})
    return {"id": f"audius:{t['id']}", "title": (t.get("title") or "")[:120], "artist": ((t.get("user") or {}).get("name") or "")[:120],
            "artwork": art.get("150x150") or art.get("480x480"), "duration": int(t.get("duration") or 0),
            "url": f"{AUDIUS_API}/tracks/{t['id']}/stream?app_name={AUDIUS_APP}", "licensed": True, "provider": "audius"}


async def _audius_get(path: str, params: dict) -> list:
    key = path + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    hit = _audius_cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    import httpx as _hx
    try:
        async with _hx.AsyncClient(timeout=8.0) as c:
            r = await c.get(f"{AUDIUS_API}{path}", params={**params, "app_name": AUDIUS_APP})
            data = r.json().get("data") if r.status_code == 200 else None
    except Exception:
        data = None
    if data is None:
        return hit[1] if hit else []
    data = data if isinstance(data, list) else [data]
    _audius_cache[key] = (time.time(), data)
    return data


async def _music_catalog(db, q: Optional[str] = None) -> list:
    out: list = []
    seen: set = set()
    queries = [q.strip()[:60]] if q and q.strip() else ["عربي", "arabic", "اغاني", "طرب"]
    for qq in queries:
        for t in await _audius_get("/tracks/search", {"query": qq, "limit": 40}):
            it = _audius_item(t)
            if it and it["id"] not in seen:
                seen.add(it["id"])
                out.append(it)
    # Admin-licensed legacy entries (only when a playable URL is configured).
    async for d in db.music_catalog.find({"licensed_url": {"$nin": [None, ""]}}, {"_id": 0}):
        meta = next((x for x in ARABIC_CATALOG if x[0] == d.get("id")), None)
        if meta and (not q or q.lower() in (meta[1] + meta[2]).lower()):
            out.insert(0, {"id": meta[0], "title": meta[1], "artist": meta[2], "url": d["licensed_url"], "licensed": True})
    return out


async def _music_resolve(db, cid: str) -> Optional[dict]:
    if cid.startswith("audius:"):
        tid = cid.split(":", 1)[1]
        if not re.match(r"^[A-Za-z0-9]{1,32}$", tid):
            return None
        data = await _audius_get(f"/tracks/{tid}", {})
        return _audius_item(data[0]) if data else None
    d = await db.music_catalog.find_one({"id": cid, "licensed_url": {"$nin": [None, ""]}})
    meta = next((x for x in ARABIC_CATALOG if x[0] == cid), None)
    return {"id": cid, "title": meta[1], "artist": meta[2], "url": d["licensed_url"], "licensed": True} if d and meta else None


@api.get("/music/catalog")
async def _music_catalog_ep(q: Optional[str] = None, user=Depends(current_user)):
    return {"items": await _music_catalog(app.state.db, q)}


def _music_default() -> dict:
    return {"queue": [], "index": -1, "playing": False, "mode": "normal", "volume": 80, "dj_id": None, "updated_at": None}


async def _music_state(db, room_id: str) -> dict:
    r = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"music": 1, "seats": 1, "owner_id": 1, "moderators": 1, "full_muted_users": 1})
    if not r:
        raise HTTPException(404, "Room not found")
    return r


async def _music_save(db, room_id: str, music: dict) -> dict:
    music["updated_at"] = now_utc().isoformat()
    await db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": {"music": music}})
    try:
        await _hub.broadcast(room_id, {"type": "music_state", "music": music})
    except Exception:
        pass
    return music


@api.get("/rooms/{room_id}/music")
async def _room_music_get(room_id: str, user=Depends(current_user)):
    r = await _music_state(app.state.db, room_id)
    return r.get("music") or _music_default()


class _MusicAddIn(BaseModel):
    source: Literal["phone", "internet"]
    title: str = Field(min_length=1, max_length=120)
    artist: Optional[str] = Field(default=None, max_length=120)
    catalog_id: Optional[str] = None
    local_uri: Optional[str] = Field(default=None, max_length=2000)


@api.post("/rooms/{room_id}/music/add")
async def _room_music_add(room_id: str, body: _MusicAddIn, user=Depends(current_user)):
    db = app.state.db
    r = await _music_state(db, room_id)
    m = r.get("music") or _music_default()
    item = {"id": secrets.token_hex(6), "source": body.source, "title": body.title, "artist": body.artist,
            "owner_id": str(user["_id"]), "url": None, "local_uri": None}
    if body.source == "internet":
        cat = await _music_resolve(db, body.catalog_id or "")
        if not cat:
            raise HTTPException(404, "Song not available")
        item.update({"title": cat["title"], "artist": cat["artist"], "catalog_id": cat["id"], "url": cat["url"], "licensed": True,
                     "artwork": cat.get("artwork"), "duration": cat.get("duration")})
    else:
        if not body.local_uri:
            raise HTTPException(400, "Missing file")
        item["local_uri"] = body.local_uri  # playable only from the adder's device
    if any((q.get("catalog_id") and q.get("catalog_id") == item.get("catalog_id"))
           or (q.get("local_uri") and q.get("local_uri") == item.get("local_uri") and q.get("owner_id") == item["owner_id"])
           for q in m["queue"]):
        return m
    m["queue"] = (m["queue"] + [item])[-100:]
    return await _music_save(db, room_id, m)


class _MusicCtlIn(BaseModel):
    action: Literal["play", "pause", "select", "next", "mode", "volume", "remove", "ended"]
    index: Optional[int] = None
    value: Optional[int] = None


@api.post("/rooms/{room_id}/music/control")
async def _room_music_control(room_id: str, body: _MusicCtlIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    r = await _music_state(db, room_id)
    m = r.get("music") or _music_default()
    seated = any(((s or {}).get("user") or {}).get("id") == uid for s in (r.get("seats") or []))
    n = len(m["queue"])
    if body.action in ("play", "select", "next", "ended") and not seated:
        raise HTTPException(403, "MIC_REQUIRED")
    if body.action in ("play", "select", "next") and uid in (r.get("full_muted_users") or {}):
        raise HTTPException(403, "FULL_MUTED")
    if body.action in ("pause", "next", "ended", "volume") and m.get("dj_id") not in (None, uid) and not seated:
        raise HTTPException(403, "MIC_REQUIRED")

    def _playable(i: int) -> bool:
        q = m["queue"][i]
        return bool(q.get("url")) or (q.get("source") == "phone" and q.get("owner_id") == uid)

    if body.action == "select":
        if body.index is None or not (0 <= body.index < n):
            raise HTTPException(400, "Bad index")
        if not _playable(body.index):
            raise HTTPException(409, "TRACK_UNAVAILABLE")
        m.update({"index": body.index, "playing": True, "dj_id": uid})
    elif body.action == "play":
        if n == 0:
            raise HTTPException(400, "Empty playlist")
        i = m["index"] if 0 <= m["index"] < n else 0
        if not _playable(i):
            raise HTTPException(409, "TRACK_UNAVAILABLE")
        m.update({"index": i, "playing": True, "dj_id": uid})
    elif body.action == "pause":
        m["playing"] = False
    elif body.action in ("next", "ended"):
        if n == 0:
            m.update({"playing": False})
        elif body.action == "ended" and m["mode"] == "repeat_one":
            pass  # same index replays
        else:
            cands = [i for i in range(n) if _playable(i)]
            if not cands:
                m["playing"] = False
            elif m["mode"] == "shuffle" and len(cands) > 1:
                m["index"] = secrets.choice([i for i in cands if i != m["index"]])
            else:
                after = [i for i in cands if i > m["index"]]
                m["index"] = after[0] if after else cands[0]
            m["dj_id"] = uid
    elif body.action == "mode":
        m["mode"] = {"normal": "repeat_one", "repeat_one": "shuffle", "shuffle": "normal"}[m.get("mode", "normal")]
    elif body.action == "volume":
        m["volume"] = max(0, min(100, int(body.value if body.value is not None else 80)))
    elif body.action == "remove":
        if body.index is None or not (0 <= body.index < n):
            raise HTTPException(400, "Bad index")
        q = m["queue"][body.index]
        if q.get("owner_id") != uid and uid != r.get("owner_id") and uid not in (r.get("moderators") or []):
            raise HTTPException(403, "Not allowed")
        m["queue"].pop(body.index)
        if body.index == m["index"]:
            m.update({"playing": False, "index": -1})
        elif body.index < m["index"]:
            m["index"] -= 1
    m["rev"] = int(m.get("rev", 0)) + 1
    return await _music_save(db, room_id, m)


RANK_POINTS_PER_DIAMOND = 10  # 1 diamond spent on gifts = 10 ranking points


def _rank_user_row(u: dict, score: int, rank: int) -> dict:
    _vl = int(u.get("vip_level", 0) or 0)
    return {
        "rank": rank, "kind": "user", "score": int(score),
        "id": str(u["_id"]), "nickname": u.get("nickname"), "avatar_url": u.get("avatar_url"),
        "vip_level": _vl, "name_color": _vip_name_color(_vl), "age": u.get("age"), "gender": u.get("gender"),
        "wealth_level": u.get("wealth_level", 0), "charm_level": u.get("charm_level", 0),
        "country_flag": u.get("country_flag"), "numeric_id": u.get("numeric_id"),
    }


async def _gift_points_board(db, group_field: str, match: dict, me_id: Optional[str], kind: str, limit: int = 50):
    """Sum gift_transactions.total_cost (one row per recipient → no double counting) × 10."""
    pipeline = [{"$match": match}, {"$group": {"_id": group_field, "amount": {"$sum": "$total_cost"}}},
                {"$match": {"_id": {"$nin": [None, ""]}}}, {"$sort": {"amount": -1}}]
    rows = [r async for r in db.gift_transactions.aggregate(pipeline + [{"$limit": limit}])]
    me_row = None
    if me_id:
        hit = next((i for i, r in enumerate(rows) if str(r["_id"]) == me_id), None)
        if hit is not None:
            me_rank, me_amount = hit + 1, rows[hit]["amount"]
        else:
            agg = [r async for r in db.gift_transactions.aggregate([{"$match": {**match, group_field[1:]: me_id}},
                                                                    {"$group": {"_id": None, "amount": {"$sum": "$total_cost"}}}])]
            me_amount = agg[0]["amount"] if agg else 0
            me_rank = 0
            if me_amount > 0:
                ahead = [r async for r in db.gift_transactions.aggregate(pipeline[:2] + [{"$match": {"amount": {"$gt": me_amount}}}, {"$count": "n"}])]
                me_rank = (ahead[0]["n"] if ahead else 0) + 1
        me_row = {"id": me_id, "amount": me_amount, "rank": me_rank}
    return rows, me_row


@api.get("/rankings/v3/{category}")
async def _rankings_v3(category: Literal["charm", "wealth", "cp", "friendship", "custom_gifts", "rooms", "family"],
                       period: Literal["daily", "weekly", "monthly", "all"] = "all", user=Depends(current_user)):
    """Batch C — unified ranking with points (diamonds × 10) and the viewer's pinned row."""
    db = app.state.db
    uid = str(user["_id"])
    since = _period_start(period)
    match: dict = {"created_at": {"$gte": since}} if since else {}
    if category in ("wealth", "charm"):
        gf = "$sender_id" if category == "wealth" else "$recipient_id"
        rows, me = await _gift_points_board(db, gf, match, uid, "user")
        ids = [ObjectId(r["_id"]) for r in rows if ObjectId.is_valid(str(r["_id"]))]
        users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": ids + [user["_id"]]}})}
        items = [_rank_user_row(users[str(r["_id"])], r["amount"] * RANK_POINTS_PER_DIAMOND, i + 1)
                 for i, r in enumerate(rows) if str(r["_id"]) in users]
        me_item = _rank_user_row(user, me["amount"] * RANK_POINTS_PER_DIAMOND, me["rank"])
        return {"items": items, "me": me_item}
    if category == "rooms":
        rows, _ = await _gift_points_board(db, "$room_id", match, None, "room")
        ids = [ObjectId(r["_id"]) for r in rows if ObjectId.is_valid(str(r["_id"]))]
        rooms = {str(r["_id"]): r async for r in db.rooms.find({"_id": {"$in": ids}, "is_deleted": {"$ne": True}})}
        items = []
        for r in rows:
            rd = rooms.get(str(r["_id"]))
            if rd:
                items.append({"rank": len(items) + 1, "kind": "room", "score": int(r["amount"]) * RANK_POINTS_PER_DIAMOND,
                              "room": public_room(rd)})
        me_item = None
        my_room = await db.rooms.find_one({"owner_id": uid, "is_deleted": {"$ne": True}})
        if my_room:
            rid = str(my_room["_id"])
            hit = next((it for it in items if it["room"]["id"] == rid), None)
            if hit:
                me_item = hit
            else:
                agg = [x async for x in db.gift_transactions.aggregate([{"$match": {**match, "room_id": rid}},
                                                                       {"$group": {"_id": None, "amount": {"$sum": "$total_cost"}}}])]
                me_item = {"rank": 0, "kind": "room", "score": (agg[0]["amount"] if agg else 0) * RANK_POINTS_PER_DIAMOND,
                           "room": public_room(my_room)}
        return {"items": items, "me": me_item}
    # cp / friendship / custom_gifts / family — existing scores, viewer row pinned.
    items = await rankings_v2(category=category, period=period, country=None, user=user)
    for i, it in enumerate(items):
        it["rank"] = i + 1
    me_item = next((it for it in items if it.get("id") == uid), None)
    if category == "family":
        fam = await db.families.find_one({"members.user_id": uid}) or await db.families.find_one({"owner_id": uid})
        if fam:
            me_item = next((it for it in items if it.get("id") == str(fam["_id"])), None) or {
                "rank": 0, "kind": "family", "id": str(fam["_id"]), "nickname": fam.get("name"),
                "avatar_url": fam.get("icon_url") or fam.get("cover_url"), "score": int(fam.get("points", 0) or 0)}
    elif not me_item:
        me_item = _rank_user_row(user, 0, 0)
    return {"items": items, "me": me_item}


# Iter-85 — Admin Dashboard router (mounted on `api`'s /api/admin/dashboard/* prefix).
# MUST be registered BEFORE app.include_router(api) so FastAPI captures the routes.
try:
    from admin_dashboard import make_router as _admin_dash_router
    api.include_router(_admin_dash_router(current_user))
    # Iter-118 — Admin Phase 1 (user detail, bans, levels, wallet, audit search).
    from admin_phase1 import make_router as _admin_p1_router

    async def _p1_cumulative(system: str) -> list:
        th = await _load_level_thresholds(system)
        return [int(t["points"]) for t in sorted(th, key=lambda t: int(t["level"]))]

    async def _p1_notify(*a, **kw):
        return await _sys_notify(*a, **kw)

    api.include_router(_admin_p1_router(current_user, {"cumulative": _p1_cumulative, "notify": _p1_notify}))
except Exception as _e:
    logger.warning(f"Iter-85 admin dashboard router not mounted: {_e}")


# ---------------------------------------------------------------------------
# Iter-87 — Admin-dedicated Google session endpoint
# ---------------------------------------------------------------------------
# Separate from /api/auth/google/session so the Owner's Google login lands
# directly in the Admin Dashboard — never in the normal user onboarding flow.
# Only the configured ADMIN_OWNER_EMAIL can obtain an admin session here.
# ---------------------------------------------------------------------------

class _AdminGoogleSessionIn(BaseModel):
    session_id: str = Field(min_length=8, max_length=512)


@api.post("/admin/auth/google/session", response_model=Tokens)
async def _admin_auth_google_session(body: _AdminGoogleSessionIn):
    """Verify Google session + Owner email, then issue a session skipping normal onboarding."""
    db = app.state.db

    # Resolve the configured Owner email on every call so admin_config edits
    # take effect immediately.
    try:
        from admin_dashboard import get_owner_email as _get_owner_email
        owner_email = (await _get_owner_email(db)).strip().lower()
    except Exception:
        owner_email = ""
    if not owner_email:
        raise HTTPException(500, "Owner email is not configured")

    # Exchange the Emergent session_id for Google profile data.
    try:
        async with _httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        if r.status_code != 200:
            raise HTTPException(401, "Invalid or expired Google session")
        data = r.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Google auth service unavailable")

    email = norm_email(data.get("email") or "")
    if not email:
        raise HTTPException(400, "Google did not return an email")

    # SECURITY: Only the configured Owner Google email can obtain an admin session.
    if email != owner_email:
        logger.warning(f"admin google session denied: {email} != owner {owner_email}")
        raise HTTPException(
            403,
            "This Google account is not the configured Owner. "
            "Admin team members must use the email/password login on /admin/login.",
        )

    name = (data.get("name") or "Yazeen Owner")[:30]
    picture = data.get("picture")

    # Create or update the Owner user record. Mark `profile_completed=true` so
    # the normal AuthGate NEVER redirects the Owner to the onboarding flow.
    user = await db.users.find_one({"email": email})
    now = now_utc()
    if not user:
        base = "".join(ch for ch in email.split("@")[0] if ch.isalnum())[:14] or "owner"
        candidate = base
        i = 0
        while await db.users.find_one({"username": candidate}):
            i += 1
            candidate = f"{base}{i}"
        doc = {
            "email": email,
            "username": candidate,
            "nickname": name,
            "password_hash": pw_hash(secrets.token_hex(24)),  # random; owner uses Google
            "auth_provider": "google",
            "avatar_url": picture or f"https://api.dicebear.com/7.x/avataaars/png?seed={candidate}",
            "bio": "Yazeen Owner",
            "level": 1,
            "wealth_level": 0, "charm_level": 0, "vip_level": 0,
            "wealth_points": 0, "charm_points": 0, "growth_points": 0,
            "coins": 0, "diamonds": 0, "experience": 0,
            "followers_count": 0, "following_count": 0,
            # Iter-87: Owner skips normal onboarding — mark as fully completed.
            "profile_completed": True,
            "gender_locked": True,
            "created_at": now,
            "language": "en",
        }
        ins = await db.users.insert_one(doc)
        uid = str(ins.inserted_id)
        logger.info(f"admin google session: created Owner user {email}")
    else:
        # Owner user already exists — ensure profile_completed=true so AuthGate
        # does NOT bounce them to onboarding, and refresh avatar/nickname.
        set_fields: Dict[str, Any] = {
            "profile_completed": True,
            "updated_at": now,
            "auth_provider": "google",
        }
        if picture and not user.get("avatar_url"):
            set_fields["avatar_url"] = picture
        if name and not user.get("nickname"):
            set_fields["nickname"] = name
        await db.users.update_one({"_id": user["_id"]}, {"$set": set_fields})
        uid = str(user["_id"])

    return await issue_pair(db, uid)


# =========================================================================
# Iter-94 — Messages Inbox: Friend Requests · System Notifications ·
# Support Team · Activities. 100% real backend-connected endpoints.
# No mock data: every list queries actual MongoDB collections and returns
# empty when the user has nothing yet.
# =========================================================================
@api.get("/inbox/overview")
async def inbox_overview(user: dict = Depends(current_user)):
    """
    Returns the four Inbox tiles with real unread counts drawn from existing
    collections. Used by the Messages screen.
    """
    db = app.state.db
    uid = str(user["_id"])

    # 1) Friend Requests — Iter-98: incoming requests + followers not yet friends.
    friend_pending = len(await _incoming_friend_requests(db, uid))
    await _vip_warning_check(db, user)

    # 2) System Notifications — count unread system_notifications targeted at
    #    this user OR global broadcasts (user_id in [uid, "*"]).
    sys_unread = await db.system_notifications.count_documents({
        "user_id": {"$in": [uid, "*"]},
        "read_by": {"$ne": uid},
    })
    sys_latest_doc = await db.system_notifications.find_one(
        {"user_id": {"$in": [uid, "*"]}},
        sort=[("created_at", -1)],
    )
    sys_latest = sys_latest_doc.get("title") if sys_latest_doc else None

    # 3) Support Team — latest message from support_messages to this user.
    support_unread = await db.support_messages.count_documents({
        "user_id": uid, "from_support": True, "read": {"$ne": True},
    })
    support_latest_doc = await db.support_messages.find_one(
        {"user_id": uid}, sort=[("created_at", -1)]
    )
    support_latest = support_latest_doc.get("text") if support_latest_doc else None

    # 4) Activities — Iter-98: approved room activities currently running.
    _now = now_utc()
    activities_count = await db.room_events.count_documents({
        "status": "approved", "start_at": {"$lte": _now}, "end_at": {"$gt": _now},
    })

    return {
        "friend_requests":      {"count": friend_pending,  "latest": None},
        "system_notifications": {"count": sys_unread,      "latest": sys_latest},
        "support_team":         {"count": support_unread,  "latest": support_latest},
        "activities":           {"count": activities_count, "latest": None},
    }


@api.get("/notifications/system")
async def list_system_notifications(user: dict = Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    await _vip_warning_check(db, user)
    cur = db.system_notifications.find(
        {"user_id": {"$in": [uid, "*"]}}
    ).sort("created_at", -1).limit(100)
    items: List[Dict[str, Any]] = []
    unread_ids: List[str] = []
    async for n in cur:
        n["id"] = str(n.pop("_id"))
        read_by = n.get("read_by") or []
        n["read"] = uid in read_by
        if not n["read"]:
            unread_ids.append(n["id"])
        n.pop("read_by", None)
        items.append(n)

    # Mark all unread notifications as read for this user on fetch.
    if unread_ids:
        from bson import ObjectId as _OID
        await db.system_notifications.update_many(
            {"_id": {"$in": [_OID(i) for i in unread_ids]}},
            {"$addToSet": {"read_by": uid}},
        )
    return {"items": items}


@api.get("/support/messages")
async def list_support_messages(user: dict = Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    cur = db.support_messages.find({"user_id": uid}).sort("created_at", 1).limit(200)
    items: List[Dict[str, Any]] = []
    async for m in cur:
        m["id"] = str(m.pop("_id"))
        m.pop("admin_id", None)
        items.append(m)
    await db.support_messages.update_many(
        {"user_id": uid, "from_support": True, "read": {"$ne": True}},
        {"$set": {"read": True}},
    )
    return {"items": items, "can_send": int(user.get("vip_level") or 0) >= SUPPORT_MIN_VIP,
            "min_vip": SUPPORT_MIN_VIP}


class SupportMessageIn(BaseModel):
    text: str

@api.post("/support/messages", status_code=201)
async def send_support_message(body: SupportMessageIn, user: dict = Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    # Iter-98 — support chat is a VIP4+ privilege (server-enforced).
    if int(user.get("vip_level") or 0) < SUPPORT_MIN_VIP:
        raise HTTPException(403, "SUPPORT_VIP4_REQUIRED")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty message")
    doc = {
        "user_id": uid,
        "text": text[:1000],
        "from_support": False,
        "read": True,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.support_messages.insert_one(doc)
    return {"id": str(res.inserted_id), "text": doc["text"], "from_support": False, "created_at": doc["created_at"].isoformat()}


@api.get("/activities")
async def list_activities(user: dict = Depends(current_user)):
    """
    Returns the user's own recent wallet_transactions as an activity feed.
    Every entry is a real ledger row (gifts received, VIP purchases, agency
    payouts, etc.). No synthetic/mock entries.
    """
    db = app.state.db
    uid = str(user["_id"])
    cur = db.wallet_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(100)
    items: List[Dict[str, Any]] = []
    async for a in cur:
        if isinstance(a.get("created_at"), datetime):
            a["created_at"] = a["created_at"].isoformat()
        items.append(a)
    return {"items": items}


# ============================================================================
# Iter-97 — Cosmetics Store + My Bag + Medals + Level (Wealth/Charm) screens.
# Store = purchasable items from `cosmetic_items`. Bag = items the user owns
# (`user_inventory`). Room Backgrounds in the Bag also include every existing
# premium room background. No fake items are seeded.
# ============================================================================
COSMETIC_CATEGORIES = (
    "frames", "entrance_effects", "room_backgrounds", "entry_badges",
    "voice_waves", "profile_covers", "chat_bubbles",
)


def _cosmetic_out(d: dict) -> dict:
    return {
        "id": str(d.get("id") or d.get("_id")),
        "category": d.get("category"),
        "name_en": d.get("name_en") or d.get("title_en") or "",
        "name_ar": d.get("name_ar") or d.get("title_ar") or "",
        "image_url": d.get("image_url"),
        "price": int(d.get("price") or 0),
        "duration_days": d.get("duration_days"),
    }


def _check_cosmetic_category(category: str) -> None:
    if category not in COSMETIC_CATEGORIES:
        raise HTTPException(400, "Unknown category")


async def _owned_inventory(db, uid: str, category: Optional[str] = None) -> dict:
    q: dict = {"user_id": uid, "$or": [{"expires_at": None}, {"expires_at": {"$gt": now_utc()}}]}
    if category:
        q["category"] = category
    out = {}
    async for inv in db.user_inventory.find(q):
        out[inv["item_id"]] = inv
    return out


# Iter-131 — VIP entrance rewards (auto-granted by real VIP level). Media
# (alpha animation + synced audio) ships with the app keyed by `effect_key`.
VIP_ENTRANCE_REWARDS = [
    {"id": "vip6_ice_bear", "vip_min": 6, "effect_key": "ice_bear",
     "name_en": "Ice Bear", "name_ar": "الدب الجليدي"},
    {"id": "vip7_golden_leopard", "vip_min": 7, "effect_key": "golden_leopard",
     "name_en": "Golden Leopard", "name_ar": "الفهد الذهبي"},
]
_VIP_REWARD_BY_ID = {r["id"]: r for r in VIP_ENTRANCE_REWARDS}


def _vip_active_level(u: dict) -> int:
    """Current VIP level, 0 once the VIP period has expired."""
    lvl = int(u.get("vip_level") or 0)
    exp = u.get("vip_expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp <= now_utc():
            return 0
    return lvl


async def _grant_vip_entrances(db, u: dict) -> None:
    lvl = _vip_active_level(u)
    for r in VIP_ENTRANCE_REWARDS:
        if lvl >= r["vip_min"]:
            await db.user_inventory.update_one(
                {"user_id": str(u["_id"]), "item_id": r["id"]},
                {"$setOnInsert": {"category": "entrance_effects", "source": "vip",
                                  "expires_at": None, "created_at": now_utc()}},
                upsert=True,
            )


async def _grant_vip_entrances_all(db) -> None:
    """Idempotent backfill for every currently-eligible account."""
    q = {"vip_level": {"$gte": min(r["vip_min"] for r in VIP_ENTRANCE_REWARDS)}}
    async for u in db.users.find(q, {"vip_level": 1, "vip_expires_at": 1}):
        await _grant_vip_entrances(db, u)


def _vip_entrance_effect(u: dict) -> Optional[str]:
    """effect_key of the equipped VIP entrance, only while still eligible."""
    r = _VIP_REWARD_BY_ID.get((u.get("equipped") or {}).get("entrance_effects"))
    return r["effect_key"] if r and _vip_active_level(u) >= r["vip_min"] else None


_ENTRANCE_MEDIA_DIR = ROOT_DIR / "static" / "entrances"
_ENTRANCE_MEDIA_TYPES = {".webp": "image/webp", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm"}


@api.get("/static/entrances/{name}")
async def _entrance_media(name: str):
    """Public entrance media (alpha animation, audio, preview video)."""
    p = (_ENTRANCE_MEDIA_DIR / name)
    ext = p.suffix.lower()
    if "/" in name or ".." in name or ext not in _ENTRANCE_MEDIA_TYPES or not p.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(p, media_type=_ENTRANCE_MEDIA_TYPES[ext],
                        headers={"Cache-Control": "public, max-age=604800"})


@api.get("/cosmetics/store")
async def _cosmetics_store(category: str = Query(...), user=Depends(current_user)):
    _check_cosmetic_category(category)
    db = app.state.db
    owned = await _owned_inventory(db, str(user["_id"]), category)
    equipped_id = (user.get("equipped") or {}).get(category)
    items = []
    async for d in db.cosmetic_items.find({"category": category, "active": True}).sort("price", 1):
        it = _cosmetic_out(d)
        it["owned"] = it["id"] in owned
        it["equipped"] = it["owned"] and it["id"] == equipped_id
        it["can_wear"] = it["owned"]
        items.append(it)
    return {"category": category, "items": items}


@api.get("/me/bag")
async def _my_bag(category: str = Query(...), user=Depends(current_user)):
    _check_cosmetic_category(category)
    db = app.state.db
    if category == "entrance_effects":
        await _grant_vip_entrances(db, user)
    owned = await _owned_inventory(db, str(user["_id"]), category)
    equipped_id = (user.get("equipped") or {}).get(category)
    my_room = None
    vip_items = []
    if category == "entrance_effects":
        # Unlocked VIP rewards keep fixed positions; expired VIP → visible but not wearable.
        lvl = _vip_active_level(user)
        for r in VIP_ENTRANCE_REWARDS:
            if r["id"] not in owned:
                continue
            active = lvl >= r["vip_min"]
            vip_items.append({
                "id": r["id"], "category": category, "name_en": r["name_en"], "name_ar": r["name_ar"],
                "image_url": None, "price": 0, "duration_days": None, "expires_at": None,
                "source": "vip", "effect_key": r["effect_key"], "vip_min": r["vip_min"],
                "expired": not active, "can_wear": active, "equipped": active and equipped_id == r["id"],
            })
    if category == "room_backgrounds":
        my_room = await db.rooms.find_one({"owner_id": str(user["_id"]), "is_deleted": {"$ne": True}},
                                          {"background_preset_id": 1})
    items = []
    if owned:
        async for d in db.cosmetic_items.find({"id": {"$in": list(owned.keys())}}):
            it = _cosmetic_out(d)
            exp = owned.get(it["id"], {}).get("expires_at")
            it["expires_at"] = exp.isoformat() if isinstance(exp, datetime) else None
            it["source"] = "store"
            it["equipped"] = it["id"] == equipped_id
            it["can_wear"] = True
            items.append(it)
    if category == "room_backgrounds":
        cur_preset = (my_room or {}).get("background_preset_id")
        for b in PREMIUM_ROOM_BACKGROUNDS:
            it = _cosmetic_out({**b, "category": "room_backgrounds"})
            it["expires_at"] = None
            it["source"] = "room"
            # Wearing a room background = applying it to the user's own room.
            it["can_wear"] = my_room is not None
            it["equipped"] = my_room is not None and cur_preset == b["id"]
            items.append(it)
    return {"category": category, "items": vip_items + items}


class _EquipIn(BaseModel):
    category: str
    item_id: str
    source: Literal["store", "room", "vip"] = "store"


async def _apply_room_bg(db, user: dict, bg: dict) -> None:
    room = await db.rooms.find_one({"owner_id": str(user["_id"]), "is_deleted": {"$ne": True}}, {"_id": 1})
    if not room:
        raise HTTPException(400, "ROOM_REQUIRED")
    await db.rooms.update_one({"_id": room["_id"]},
                              {"$set": {"background_url": bg["image_url"], "background_preset_id": bg["id"]}})
    try:
        await _broadcast_room_state(str(room["_id"]))
    except Exception:
        pass


@api.post("/me/bag/equip")
async def _bag_equip(body: _EquipIn, user=Depends(current_user)):
    _check_cosmetic_category(body.category)
    db = app.state.db
    if body.source == "room":
        bg = next((b for b in PREMIUM_ROOM_BACKGROUNDS if b["id"] == body.item_id), None)
        if body.category != "room_backgrounds" or not bg:
            raise HTTPException(404, "Item not found")
        await _apply_room_bg(db, user, bg)
        return {"ok": True, "equipped": True}
    owned = await _owned_inventory(db, str(user["_id"]), body.category)
    if body.item_id not in owned:
        raise HTTPException(403, "Item not owned")
    vr = _VIP_REWARD_BY_ID.get(body.item_id)
    if vr and _vip_active_level(user) < vr["vip_min"]:
        raise HTTPException(403, "VIP_EXPIRED")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {f"equipped.{body.category}": body.item_id}})
    if body.category == "room_backgrounds":
        item = await db.cosmetic_items.find_one({"id": body.item_id})
        if item and item.get("image_url"):
            await _apply_room_bg(db, user, {"id": body.item_id, "image_url": item["image_url"]})
    return {"ok": True, "equipped": True}


@api.post("/me/bag/unequip")
async def _bag_unequip(body: _EquipIn, user=Depends(current_user)):
    _check_cosmetic_category(body.category)
    db = app.state.db
    await db.users.update_one({"_id": user["_id"]}, {"$unset": {f"equipped.{body.category}": ""}})
    if body.category == "room_backgrounds":
        # Revert the room to the default ORIO background.
        await _apply_room_bg(db, user, PREMIUM_ROOM_BACKGROUNDS[0])
    return {"ok": True, "equipped": False}


@api.get("/me/connections")
async def _my_connections(type: Literal["friends", "following", "followers"] = "friends",
                          user=Depends(current_user)):
    """Owner-only by design (always the caller's own lists)."""
    db = app.state.db
    uid = str(user["_id"])
    if type == "friends":
        ids = [f["b_id"] if f["a_id"] == uid else f["a_id"] async for f in
               db.friendships.find({"status": "accepted", "$or": [{"a_id": uid}, {"b_id": uid}]})]
    elif type == "following":
        ids = [f["followee_id"] async for f in db.follows.find({"follower_id": uid}).sort("created_at", -1).limit(500)]
    else:
        ids = [f["follower_id"] async for f in db.follows.find({"followee_id": uid}).sort("created_at", -1).limit(500)]
    oids = [ObjectId(i) for i in ids if _is_valid_oid(i)]
    users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": oids}})}
    follow_set = set(await db.follows.distinct("followee_id", {"follower_id": uid, "followee_id": {"$in": ids}}))
    items = []
    for i in ids:
        if i in users:
            m = _mini_user(users[i])
            m["is_following"] = i in follow_set
            items.append(m)
    counts = {
        "friends": await db.friendships.count_documents({"status": "accepted", "$or": [{"a_id": uid}, {"b_id": uid}]}),
        "following": await db.follows.count_documents({"follower_id": uid}),
        "followers": await db.follows.count_documents({"followee_id": uid}),
    }
    return {"type": type, "items": items, "counts": counts}


@api.post("/cosmetics/{item_id}/purchase")
async def _cosmetics_purchase(item_id: str, user=Depends(current_user)):
    db = app.state.db
    item = await db.cosmetic_items.find_one({"id": item_id, "active": True})
    if not item:
        raise HTTPException(404, "Item not found")
    uid = str(user["_id"])
    price = int(item.get("price") or 0)
    existing = await db.user_inventory.find_one({"user_id": uid, "item_id": item_id})
    days = item.get("duration_days")
    if existing and not days:
        raise HTTPException(409, "Already owned")
    deducted = await db.users.find_one_and_update(
        {"_id": user["_id"], "diamonds": {"$gte": price}},
        {"$inc": {"diamonds": -price}},
        return_document=True,
    )
    if not deducted:
        raise HTTPException(402, "Insufficient diamonds")
    expires_at = None
    if days:
        cur = existing.get("expires_at") if existing else None
        if isinstance(cur, datetime) and cur.tzinfo is None:
            cur = cur.replace(tzinfo=timezone.utc)
        base = cur if isinstance(cur, datetime) and cur > now_utc() else now_utc()
        expires_at = base + timedelta(days=int(days))
    await db.user_inventory.update_one(
        {"user_id": uid, "item_id": item_id},
        {"$set": {"category": item.get("category"), "expires_at": expires_at, "updated_at": now_utc()},
         "$setOnInsert": {"acquired_at": now_utc()}},
        upsert=True,
    )
    await db.wallet_transactions.insert_one({
        "user_id": uid, "type": "cosmetic_purchase", "currency": "diamonds",
        "amount": -price, "reference_id": item_id,
        "description": f"Store: {item.get('name_en') or item_id}",
        "status": "completed", "created_at": now_utc(),
    })
    return {"ok": True, "diamonds_remaining": int(deducted.get("diamonds", 0)),
            "expires_at": expires_at.isoformat() if expires_at else None}


@api.get("/me/medals")
async def _my_medals(user=Depends(current_user)):
    db = app.state.db
    earned_ids = [str(m.get("id") if isinstance(m, dict) else m) for m in (user.get("medals") or [])]
    catalog = {}
    async for b in db.badges.find({"active": {"$ne": False}}):
        catalog[str(b.get("id") or b["_id"])] = b

    def _b(bid: str, b: dict) -> dict:
        return {"id": bid, "name_en": b.get("name_en", ""), "name_ar": b.get("name_ar", ""),
                "image_url": b.get("image_url"), "kind": b.get("kind", "activity"),
                "earned": bid in earned_ids}

    my_badges = [_b(i, catalog[i]) for i in earned_ids if i in catalog]
    activity = [_b(i, b) for i, b in catalog.items() if b.get("kind", "activity") == "activity"]
    return {"my_badges": my_badges, "activity_badges": activity}


@api.get("/me/levels")
async def _my_levels(user=Depends(current_user)):
    out = {}
    for sys in ("wealth", "charm"):
        cfg = _LEVEL_FIELDS[sys]
        thresholds = await _load_level_thresholds(sys)
        pts = int(user.get(cfg["points"], user.get(cfg["level"], 0)) or 0)
        lvl = _compute_display_level(thresholds, pts, cfg["max"])
        by_lvl = {int(t["level"]): int(t["points"]) for t in thresholds}
        floor = by_lvl.get(lvl, 0)
        nxt = by_lvl.get(lvl + 1) if lvl < cfg["max"] else None
        out[sys] = {"level": lvl, "points": pts, "current_floor": floor,
                    "next_level": lvl + 1 if nxt is not None else None,
                    "next_threshold": nxt, "max_level": cfg["max"],
                    # Iter-115 — exact integer remaining to the next level; None at MAX.
                    "remaining": (nxt - pts) if nxt is not None else None,
                    "is_max": nxt is None,
                    # Cumulative points required through LV1..LV51 (index = level-1).
                    "cumulative": [int(t["points"]) for t in sorted(thresholds, key=lambda t: int(t["level"]))]}
    return out


# ============================================================================
# Iter-98 — Messages: Friend Requests · System Notifications · Support (VIP4+)
#           · Room Activities (events) with user applications + admin review.
# ============================================================================
SUPPORT_MIN_VIP = 4


def _mini_user(u: dict) -> dict:
    return {
        "id": str(u["_id"]), "nickname": u.get("nickname"), "username": u.get("username"),
        "avatar_url": u.get("avatar_url"), "vip_level": int(u.get("vip_level") or 0),
        "numeric_id": u.get("numeric_id"),
    }


async def _sys_notify(db, uid: str, kind: str, params: dict, action: Optional[dict], title: str,
                      dedup_key: Optional[str] = None) -> None:
    doc = {"user_id": uid, "kind": kind, "params": params or {}, "action": action,
           "title": title, "read_by": [], "created_at": now_utc()}
    if dedup_key:
        r = await db.system_notifications.update_one({"dedup_key": dedup_key}, {"$setOnInsert": doc}, upsert=True)
        if not r.upserted_id:
            return
    else:
        await db.system_notifications.insert_one(doc)
    await _notify_push([uid], "Yazeen", title or "New notification", "/notifications", key=dedup_key and f"sys:{dedup_key}")


async def _notify_room_kick(db, target_id: str, actor: dict, room: dict) -> None:
    name = actor.get("nickname") or actor.get("username") or ""
    vip = int(actor.get("vip_level") or 0)
    await _sys_notify(
        db, target_id, "room_kick",
        {"username": name, "vip_level": vip, "room_name": room.get("name", "")},
        {"type": "profile", "id": str(actor["_id"])},
        f"{name} (VIP{vip}) kicked you from {room.get('name', '')}.",
    )


async def _vip_warning_check(db, user: dict) -> None:
    """Persist ONE warning per VIP cycle when ≤3 days remain and the user has
    not yet reached the growth-points maintenance threshold."""
    try:
        snap = await _vip_maintenance_cycle(user["_id"])
    except Exception:
        return
    lvl = int(snap.get("level") or 0)
    if lvl < 1 or lvl in VIP_RECHARGE_MAINTENANCE:
        return
    remaining = int(snap.get("maintenance_remaining") or 0)
    days = int(snap.get("remaining_days") or 0)
    if remaining <= 0 or days <= 0 or days > 3:
        return
    uid = str(user["_id"])
    await _sys_notify(
        db, uid, "vip_warning", {"points": remaining, "vip_level": lvl, "days": days},
        {"type": "vip"},
        f"Your current growth points have not increased. You need {remaining} more points to maintain VIP{lvl}.",
        dedup_key=f"vip_warn:{uid}:{snap.get('vip_expires_at')}",
    )


async def _incoming_friend_requests(db, uid: str) -> list[dict]:
    """Incoming pending friendship requests + followers who are not friends
    yet and whose request was not rejected."""
    out: dict[str, str] = {}
    async for f in db.friendships.find({"$or": [{"a_id": uid}, {"b_id": uid}], "status": "pending",
                                        "requested_by": {"$ne": uid}}):
        out[f["requested_by"]] = "request"
    related = set()
    async for f in db.friendships.find({"$or": [{"a_id": uid}, {"b_id": uid}]}, {"a_id": 1, "b_id": 1}):
        related.add(f["b_id"] if f["a_id"] == uid else f["a_id"])
    dismissed = set(await db.friend_request_dismissals.distinct("from_id", {"user_id": uid}))
    async for fl in db.follows.find({"followee_id": uid}).sort("created_at", -1).limit(300):
        fid = fl["follower_id"]
        if fid not in out and fid not in related and fid not in dismissed:
            out[fid] = "follower"
    return [{"user_id": k, "source": v} for k, v in out.items()]


@api.get("/friend-requests")
async def _friend_requests(user=Depends(current_user)):
    db = app.state.db
    reqs = await _incoming_friend_requests(db, str(user["_id"]))
    oids = [ObjectId(r["user_id"]) for r in reqs if _is_valid_oid(r["user_id"])]
    users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": oids}})}
    items = [{"user": _mini_user(users[r["user_id"]]), "source": r["source"]}
             for r in reqs if r["user_id"] in users]
    return {"items": items}


@api.post("/friend-requests/{other_id}/accept")
async def _friend_request_accept(other_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    if other_id == my_id or not _is_valid_oid(other_id) or not await db.users.find_one({"_id": ObjectId(other_id)}, {"_id": 1}):
        raise HTTPException(404, "User not found")
    pk = _pair_key(my_id, other_id)
    a, b = sorted([my_id, other_id])
    await db.friendships.update_one(
        {"pair_key": pk},
        {"$set": {"status": "accepted", "accepted_at": now_utc()},
         "$setOnInsert": {"a_id": a, "b_id": b, "requested_by": other_id, "points": 0, "created_at": now_utc()}},
        upsert=True,
    )
    await db.friend_request_dismissals.delete_many({"user_id": my_id, "from_id": other_id})
    return {"ok": True, "status": "accepted"}


@api.post("/friend-requests/{other_id}/reject")
async def _friend_request_reject(other_id: str, user=Depends(current_user)):
    db = app.state.db
    my_id = str(user["_id"])
    await db.friendships.delete_one({"pair_key": _pair_key(my_id, other_id), "status": "pending",
                                     "requested_by": other_id})
    await db.friend_request_dismissals.update_one(
        {"user_id": my_id, "from_id": other_id},
        {"$set": {"created_at": now_utc()}}, upsert=True,
    )
    return {"ok": True, "status": "rejected"}


# ---------- Room Activities (events) ----------
class _EventApplyIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    image_url: str = Field(min_length=8, max_length=3_000_000)


def _event_out(e: dict, room: Optional[dict]) -> dict:
    return {
        "id": str(e["_id"]), "name": e.get("name"), "image_url": e.get("image_url"),
        "start_at": e["start_at"].isoformat() if isinstance(e.get("start_at"), datetime) else None,
        "end_at": e["end_at"].isoformat() if isinstance(e.get("end_at"), datetime) else None,
        "status": e.get("status"), "room_id": e.get("room_id"),
        "room_name": (room or {}).get("name"), "room_cover": (room or {}).get("cover_url"),
    }


@api.get("/room-events")
async def _room_events(scope: Literal["all", "mine"] = "all",
                       phase: Literal["ongoing", "upcoming"] = "ongoing",
                       user=Depends(current_user)):
    db = app.state.db
    now = now_utc()
    q: dict = {"status": "approved"} if scope == "all" else {"user_id": str(user["_id"])}
    if scope == "mine":
        sort = [("start_at", -1)]  # My Activities: every own event, no phase split
    elif phase == "ongoing":
        q.update({"start_at": {"$lte": now}, "end_at": {"$gt": now}})
        sort = [("start_at", -1)]
    else:
        q["start_at"] = {"$gt": now}
        sort = [("start_at", 1)]
    events = await db.room_events.find(q).sort(sort).to_list(100)
    rids = [ObjectId(e["room_id"]) for e in events if _is_valid_oid(e.get("room_id"))]
    rooms = {str(r["_id"]): r async for r in db.rooms.find({"_id": {"$in": rids}}, {"name": 1, "cover_url": 1})}
    return {"items": [_event_out(e, rooms.get(e.get("room_id"))) for e in events]}


@api.post("/room-events/apply", status_code=201)
async def _room_event_apply(body: _EventApplyIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    try:
        day = datetime.strptime(body.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "Invalid date")
    if day + timedelta(days=1) <= now_utc():
        raise HTTPException(400, "DATE_IN_PAST")
    if not (body.image_url.startswith("data:image/") or body.image_url.startswith("http")):
        raise HTTPException(400, "Invalid image")
    room = await db.rooms.find_one({"owner_id": uid, "is_live": True, "is_deleted": {"$ne": True}}, {"_id": 1})
    if not room:
        raise HTTPException(400, "ROOM_REQUIRED")
    r = await db.room_events.insert_one({
        "user_id": uid, "room_id": str(room["_id"]), "name": body.name.strip()[:20],
        "image_url": body.image_url, "start_at": day, "end_at": day + timedelta(days=1),
        "status": "pending", "created_at": now_utc(),
    })
    return {"ok": True, "id": str(r.inserted_id), "status": "pending"}


async def _require_admin_perm(user: dict, perm: str) -> None:
    from admin_dashboard import resolve_admin_access as _resolve
    access = await _resolve(app.state.db, user)
    if not access or (not access["is_owner"] and perm not in access["permissions"]):
        raise HTTPException(403, "Admin access denied")


@api.get("/admin/room-events")
async def _admin_room_events(status: str = "pending", user=Depends(current_user)):
    await _require_admin_perm(user, "rooms.manage")
    db = app.state.db
    events = await db.room_events.find({"status": status}).sort("created_at", -1).to_list(200)
    rids = [ObjectId(e["room_id"]) for e in events if _is_valid_oid(e.get("room_id"))]
    rooms = {str(r["_id"]): r async for r in db.rooms.find({"_id": {"$in": rids}}, {"name": 1, "cover_url": 1})}
    return {"items": [_event_out(e, rooms.get(e.get("room_id"))) for e in events]}


class _EventDecisionIn(BaseModel):
    approve: bool


@api.post("/admin/room-events/{event_id}/decision")
async def _admin_room_event_decision(event_id: str, body: _EventDecisionIn, user=Depends(current_user)):
    await _require_admin_perm(user, "rooms.manage")
    db = app.state.db
    if not _is_valid_oid(event_id):
        raise HTTPException(404, "Not found")
    status_ = "approved" if body.approve else "rejected"
    e = await db.room_events.find_one_and_update(
        {"_id": ObjectId(event_id), "status": "pending"},
        {"$set": {"status": status_, "reviewed_by": str(user["_id"]), "reviewed_at": now_utc()}},
        return_document=True,
    )
    if not e:
        raise HTTPException(404, "No pending application")
    kind = "activity_approved" if body.approve else "activity_rejected"
    title = (f"Your activity \"{e.get('name')}\" was approved." if body.approve
             else f"Your activity \"{e.get('name')}\" was not approved.")
    await _sys_notify(db, e["user_id"], kind, {"name": e.get("name")},
                      {"type": "room", "id": e.get("room_id")} if body.approve else None, title)
    return {"ok": True, "status": status_}


# ---------- Admin: support inbox ----------
@api.get("/admin/support/threads")
async def _admin_support_threads(user=Depends(current_user)):
    await _require_admin_perm(user, "reports.resolve")
    db = app.state.db
    rows = await db.support_messages.aggregate([
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$user_id", "last_text": {"$first": "$text"}, "last_at": {"$first": "$created_at"},
                    "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$from_support", False]},
                                                            {"$ne": ["$admin_read", True]}]}, 1, 0]}}}},
        {"$sort": {"last_at": -1}}, {"$limit": 200},
    ]).to_list(200)
    oids = [ObjectId(r["_id"]) for r in rows if _is_valid_oid(r["_id"])]
    users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": oids}})}
    return {"items": [{
        "user": _mini_user(users[r["_id"]]) if r["_id"] in users else {"id": r["_id"]},
        "last_text": r.get("last_text"), "unread": r.get("unread", 0),
        "last_at": r["last_at"].isoformat() if isinstance(r.get("last_at"), datetime) else None,
    } for r in rows]}


@api.get("/admin/support/{user_id}")
async def _admin_support_thread(user_id: str, user=Depends(current_user)):
    await _require_admin_perm(user, "reports.resolve")
    db = app.state.db
    items = []
    async for m in db.support_messages.find({"user_id": user_id}).sort("created_at", 1).limit(500):
        m["id"] = str(m.pop("_id"))
        if isinstance(m.get("created_at"), datetime):
            m["created_at"] = m["created_at"].isoformat()
        items.append(m)
    await db.support_messages.update_many({"user_id": user_id, "from_support": False}, {"$set": {"admin_read": True}})
    return {"items": items}


@api.post("/admin/support/{user_id}/reply", status_code=201)
async def _admin_support_reply(user_id: str, body: SupportMessageIn, user=Depends(current_user)):
    await _require_admin_perm(user, "reports.resolve")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty message")
    db = app.state.db
    doc = {"user_id": user_id, "text": text[:1000], "from_support": True, "read": False,
           "admin_id": str(user["_id"]), "created_at": now_utc()}
    r = await db.support_messages.insert_one(doc)
    return {"id": str(r.inserted_id), "ok": True}


# =====================================================================
# Iter-117 — Media storage (Emergent Object Storage), referrals, tasks,
# room dedupe. Appended surgically; no existing routes changed.
# =====================================================================
import base64 as _b64  # noqa: E402
import uuid as _uuid  # noqa: E402
import requests as _requests  # noqa: E402
from fastapi import Request as _Request  # noqa: E402
from fastapi.responses import Response as _Response  # noqa: E402
from starlette.concurrency import run_in_threadpool as _run_in_threadpool  # noqa: E402

_STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
_STORAGE_URL = _STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_STORAGE_APP = "orio"
_storage_key: Optional[str] = None
import tempfile as _tempfile  # noqa: E402
# Chunked uploads are staged on local disk before going to storage. Override
# with UPLOAD_TMP_DIR when the default temp dir is not writable by the service.
_UPLOAD_TMP = Path((os.environ.get("UPLOAD_TMP_DIR") or "").strip() or Path(_tempfile.gettempdir()) / "orio_uploads")


def _ensure_upload_tmp() -> None:
    try:
        _UPLOAD_TMP.mkdir(parents=True, exist_ok=True)
        probe = _UPLOAD_TMP / f".probe-{os.getpid()}"
        probe.write_bytes(b"")
        probe.unlink()
    except OSError:
        logger.exception("Upload temp dir %s is not writable", _UPLOAD_TMP)
        raise HTTPException(503, "Upload storage is not available")
_MEDIA_LIMITS = {"image": 10 * 1024 * 1024, "video": 60 * 1024 * 1024, "audio": 6 * 1024 * 1024}
_MEDIA_CACHE: dict = {}  # small in-process LRU of recently served objects


def _storage_init(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    try:
        resp = _requests.post(f"{_STORAGE_URL}/init", json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
        resp.raise_for_status()
        _storage_key = resp.json()["storage_key"]
    except Exception:
        logger.exception("Emergent storage init failed (is S3_BUCKET set?)")
        raise HTTPException(503, "Storage unavailable")
    return _storage_key


_S3_BUCKET = (os.environ.get("S3_BUCKET") or "").strip()
_s3_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config
        # Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (or an IAM role).
        _s3_client = boto3.client(
            "s3", region_name=(os.environ.get("AWS_REGION") or "").strip() or None,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=10, read_timeout=90),
        )
    return _s3_client


def _storage_put(path: str, data: bytes, content_type: str) -> dict:
    if _S3_BUCKET:
        try:
            _s3().put_object(Bucket=_S3_BUCKET, Key=path, Body=data, ContentType=content_type)
        except Exception:
            logging.getLogger(__name__).exception("S3 upload failed")
            raise HTTPException(503, "Storage unavailable")
        return {"path": path}
    for attempt in range(2):
        key = _storage_init(force=attempt > 0)
        resp = _requests.put(f"{_STORAGE_URL}/objects/{path}",
                             headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=180)
        if resp.status_code == 503 and attempt == 0:
            continue
        if resp.status_code == 402:
            raise HTTPException(402, "Storage credits exhausted. Please try again later.")
        resp.raise_for_status()
        return resp.json()
    raise HTTPException(503, "Storage unavailable")


def _storage_get(path: str) -> tuple:
    if _S3_BUCKET:
        try:
            obj = _s3().get_object(Bucket=_S3_BUCKET, Key=path)
            return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
        except Exception as e:
            code = getattr(e, "response", {}).get("Error", {}).get("Code") if hasattr(e, "response") else None
            if code in ("NoSuchKey", "404"):
                raise HTTPException(404, "Not found")
            logging.getLogger(__name__).exception("S3 download failed")
            raise HTTPException(503, "Storage unavailable")
    for attempt in range(2):
        key = _storage_init(force=attempt > 0)
        resp = _requests.get(f"{_STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=90)
        if resp.status_code == 503 and attempt == 0:
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise HTTPException(503, "Storage unavailable")


_MEDIA_URL_RE = re.compile(r"/api/media/files/([a-f0-9]{24})")


async def _assert_media_owned(db, url: str, owner_id: str) -> None:
    """Media attached to posts/reports must be an uploaded file owned by the user."""
    m = _MEDIA_URL_RE.search(url or "")
    if not m:
        raise HTTPException(400, "Invalid media reference")
    f = await db.media_files.find_one({"_id": ObjectId(m.group(1)), "owner_id": owner_id, "is_deleted": {"$ne": True}})
    if not f:
        raise HTTPException(400, "Media not found")


class _MediaInitIn(BaseModel):
    kind: Literal["image", "video", "audio"]
    mime: str = Field(max_length=80)
    size: int = Field(ge=1)
    purpose: Literal["post", "report", "chat", "cover", "gift"]
    total_chunks: int = Field(ge=1, le=200)
    duration: Optional[float] = None


class _MediaChunkIn(BaseModel):
    upload_id: str
    index: int = Field(ge=0)
    data: str  # base64 chunk (≤ ~3MB encoded)


class _MediaCompleteIn(BaseModel):
    upload_id: str


@api.post("/media/upload/init")
async def _media_init(body: _MediaInitIn, user=Depends(current_user)):
    if body.size > _MEDIA_LIMITS[body.kind]:
        raise HTTPException(413, "File is too large")
    mime = body.mime.lower()
    if not mime.startswith(body.kind + "/"):
        raise HTTPException(400, "Unsupported file type")
    if body.kind == "video" and body.duration is not None and body.duration > 30.5:
        raise HTTPException(400, "Video must be 30 seconds or shorter")
    if body.kind == "audio" and (body.purpose != "chat" or (body.duration is not None and body.duration > 31)):
        raise HTTPException(400, "Voice messages must be 30 seconds or shorter")
    if body.kind == "video" and body.purpose == "chat":
        raise HTTPException(400, "Unsupported chat media")
    if body.purpose == "gift" and body.kind == "video":
        if int(user.get("vip_level", 0) or 0) < 5:
            raise HTTPException(403, "VIP5_REQUIRED")
        if body.duration is None or body.duration > 10.5:
            raise HTTPException(400, "Gift video must be 10 seconds or shorter")
    elif body.purpose in ("cover", "gift") and (body.kind != "image" or int(user.get("vip_level", 0) or 0) < 5):
        raise HTTPException(403, "VIP5_REQUIRED")
    _ensure_upload_tmp()
    db = app.state.db
    r = await db.media_uploads.insert_one({
        "owner_id": str(user["_id"]), "kind": body.kind, "mime": mime, "size": body.size,
        "purpose": body.purpose, "total_chunks": body.total_chunks, "next_index": 0,
        "duration": body.duration, "status": "uploading", "created_at": now_utc(),
    })
    return {"upload_id": str(r.inserted_id)}


async def _get_upload(db, upload_id: str, uid: str) -> dict:
    try:
        up = await db.media_uploads.find_one({"_id": ObjectId(upload_id), "owner_id": uid})
    except Exception:
        up = None
    if not up or up.get("status") != "uploading":
        raise HTTPException(404, "Upload not found")
    return up


@api.post("/media/upload/chunk")
async def _media_chunk(body: _MediaChunkIn, user=Depends(current_user)):
    db = app.state.db
    up = await _get_upload(db, body.upload_id, str(user["_id"]))
    if body.index != int(up["next_index"]):
        raise HTTPException(409, f"Expected chunk {up['next_index']}")
    try:
        raw = _b64.b64decode(body.data.split(",", 1)[-1])
    except Exception:
        raise HTTPException(400, "Invalid chunk encoding")
    part = _UPLOAD_TMP / f"{body.upload_id}.part"
    if (part.stat().st_size if part.exists() else 0) + len(raw) > _MEDIA_LIMITS[up["kind"]]:
        raise HTTPException(413, "File is too large")
    with open(part, "ab") as fh:
        fh.write(raw)
    await db.media_uploads.update_one({"_id": up["_id"]}, {"$inc": {"next_index": 1}})
    return {"ok": True, "received": body.index + 1}


@api.post("/media/upload/complete")
async def _media_complete(body: _MediaCompleteIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    up = await _get_upload(db, body.upload_id, uid)
    if int(up["next_index"]) != int(up["total_chunks"]):
        raise HTTPException(400, "Upload incomplete")
    part = _UPLOAD_TMP / f"{body.upload_id}.part"
    if not part.exists():
        raise HTTPException(400, "Upload incomplete")
    data = part.read_bytes()
    ext = (up["mime"].split("/", 1)[1].split(";")[0] or "bin")[:8].replace("quicktime", "mov").replace("jpeg", "jpg").replace("x-m4a", "m4a").replace("mp4a-latm", "m4a")
    path = f"{_STORAGE_APP}/uploads/{uid}/{_uuid.uuid4().hex}.{ext}"
    res = await _run_in_threadpool(_storage_put, path, data, up["mime"])
    try:
        part.unlink()
    except Exception:
        pass
    f = await db.media_files.insert_one({
        "owner_id": uid, "storage_path": res.get("path", path), "mime": up["mime"], "kind": up["kind"],
        "size": len(data), "purpose": up["purpose"], "public": up["purpose"] in ("post", "cover", "gift"),
        "duration": up.get("duration"), "is_deleted": False, "created_at": now_utc(),
    })
    await db.media_uploads.update_one({"_id": up["_id"]}, {"$set": {"status": "done", "file_id": str(f.inserted_id)}})
    return {"id": str(f.inserted_id), "url": f"/api/media/files/{f.inserted_id}", "kind": up["kind"]}


@api.get("/media/files/{file_id}")
async def _media_get(file_id: str, request: _Request, t: Optional[str] = None):
    db = app.state.db
    try:
        f = await db.media_files.find_one({"_id": ObjectId(file_id), "is_deleted": {"$ne": True}})
    except Exception:
        f = None
    if not f:
        raise HTTPException(404, "Not found")
    if not f.get("public"):
        # Private (report evidence): owner or admin, via Bearer header or ?t= token.
        tok = t or (request.headers.get("authorization") or "").replace("Bearer ", "")
        try:
            p = jwt.decode(tok, ACCESS_SECRET, algorithms=[ALG])
            viewer = await db.users.find_one({"_id": ObjectId(p["sub"])})
        except Exception:
            viewer = None
        if not viewer or (str(viewer["_id"]) != f["owner_id"] and str(viewer["_id"]) not in (f.get("peer_ids") or [])
                          and not viewer.get("admin_access") and not viewer.get("is_admin")):
            raise HTTPException(403, "Forbidden")
    cached = _MEDIA_CACHE.get(file_id)
    if cached is None:
        data, ctype = await _run_in_threadpool(_storage_get, f["storage_path"])
        ctype = f.get("mime") or ctype
        if len(data) < 8 * 1024 * 1024:
            if len(_MEDIA_CACHE) > 40:
                _MEDIA_CACHE.pop(next(iter(_MEDIA_CACHE)))
            _MEDIA_CACHE[file_id] = (data, ctype)
    else:
        data, ctype = cached
    headers = {"Cache-Control": "public, max-age=86400" if f.get("public") else "private, max-age=3600",
               "Accept-Ranges": "bytes"}
    rng = request.headers.get("range")
    m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
    if m and (m.group(1) or m.group(2)):
        total = len(data)
        start = int(m.group(1)) if m.group(1) else max(0, total - int(m.group(2)))
        end = int(m.group(2)) if (m.group(1) and m.group(2)) else total - 1
        end = min(end, total - 1)
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        return _Response(content=data[start:end + 1], status_code=206, media_type=ctype, headers=headers)
    return _Response(content=data, media_type=ctype, headers=headers)


# ---------- Referral redemption (24h window, one-time, anti-abuse) ----------
REFERRAL_WINDOW_HOURS = 24
REFERRAL_REWARD = 500
REFERRAL_DAILY_CAP = 20


def _created_at(u: dict) -> datetime:
    c = u.get("created_at") or now_utc()
    if isinstance(c, str):
        try:
            c = datetime.fromisoformat(c.replace("Z", "+00:00"))
        except Exception:
            c = now_utc()
    return c if c.tzinfo else c.replace(tzinfo=timezone.utc)


@api.get("/referral/status")
async def _referral_status(user=Depends(current_user)):
    db = app.state.db
    code = _make_short_code(str(user["_id"]))
    if user.get("referral_code") != code:
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"referral_code": code}})
    expires = _created_at(user) + timedelta(hours=REFERRAL_WINDOW_HOURS)
    redeemed = user.get("referred_by")
    count = await db.users.count_documents({"referred_by": code})
    return {
        "code": code, "referrals_count": count, "reward_per_referral": REFERRAL_REWARD,
        "redeemed_code": redeemed,
        "redeem_expires_at": expires.isoformat(),
        "can_redeem": (not redeemed) and now_utc() < expires,
        "status": "redeemed" if redeemed else ("open" if now_utc() < expires else "expired"),
    }


class _ReferralRedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)


@api.post("/referral/redeem")
async def _referral_redeem(body: _ReferralRedeemIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    code = body.code.strip().upper()
    if user.get("referred_by"):
        raise HTTPException(409, "You have already redeemed a referral code")
    if now_utc() >= _created_at(user) + timedelta(hours=REFERRAL_WINDOW_HOURS):
        raise HTTPException(410, "The 24-hour referral window has expired")
    if code == _make_short_code(uid):
        raise HTTPException(400, "You cannot use your own code")
    ref = await db.users.find_one({"referral_code": code})
    if not ref:
        raise HTTPException(404, "Invalid referral code")
    rid = str(ref["_id"])
    if _created_at(ref) >= _created_at(user):
        raise HTTPException(400, "This code is not eligible")
    if ref.get("referred_by") == _make_short_code(uid):
        raise HTTPException(400, "This code is not eligible")
    day_start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    if await db.referral_redemptions.count_documents({"referrer_id": rid, "created_at": {"$gte": day_start}}) >= REFERRAL_DAILY_CAP:
        raise HTTPException(429, "This code has reached its daily limit")
    # Atomic one-time claim.
    res = await db.users.update_one({"_id": user["_id"], "referred_by": {"$in": [None, ""]}},
                                    {"$set": {"referred_by": code, "referred_at": now_utc()}})
    if res.modified_count != 1:
        raise HTTPException(409, "You have already redeemed a referral code")
    await db.users.update_one({"_id": ref["_id"]}, {"$inc": {"coins": REFERRAL_REWARD}})
    await db.referral_redemptions.insert_one({"referrer_id": rid, "redeemer_id": uid, "code": code,
                                              "reward": REFERRAL_REWARD, "created_at": now_utc()})
    await _sys_notify(db, rid, "referral_reward", {"amount": REFERRAL_REWARD, "username": user.get("nickname") or ""},
                      {"type": "profile", "id": uid},
                      f"{user.get('nickname') or 'A friend'} used your referral code. +{REFERRAL_REWARD} diamonds")
    return {"ok": True, "redeemed_code": code}


# ---------- Server-side task tracking ----------
async def _task_bump(db, uid: str, task_id: str, inc: int = 1) -> None:
    task = next((t for t in TASK_CATALOG if t["id"] == task_id), None)
    if not task:
        return
    try:
        day = _today_key()
        r = await db.tasks_progress.find_one_and_update(
            {"user_id": uid, "day": day, "task_id": task_id},
            {"$inc": {"progress": inc}, "$setOnInsert": {"created_at": now_utc()}},
            upsert=True, return_document=True,
        )
        if int((r or {}).get("progress", 0)) >= task["target"] and not (r or {}).get("completed"):
            await db.tasks_progress.update_one({"_id": r["_id"]}, {"$set": {"completed": True, "completed_at": now_utc()}})
    except Exception as e:
        logger.warning(f"task bump failed {task_id}: {e}")


class _TaskHeartbeatIn(BaseModel):
    room_id: str


@api.post("/tasks/heartbeat")
async def _task_heartbeat(body: _TaskHeartbeatIn, user=Depends(current_user)):
    """Called ~every 60s while inside a room. Credits 1 minute toward room/mic
    tasks only if the user is actually connected (and seated for mic tasks)."""
    db = app.state.db
    uid = str(user["_id"])
    if uid not in (_hub.presence.get(body.room_id) or {}):
        return {"ok": False, "reason": "not_in_room"}
    cutoff = now_utc() - timedelta(seconds=55)
    hb = await db.task_heartbeats.find_one_and_update(
        {"user_id": uid, "$or": [{"last_at": {"$lt": cutoff}}, {"last_at": {"$exists": False}}]},
        {"$set": {"last_at": now_utc()}}, upsert=False,
    )
    if hb is None:
        if await db.task_heartbeats.count_documents({"user_id": uid}):
            return {"ok": False, "reason": "rate_limited"}
        await db.task_heartbeats.insert_one({"user_id": uid, "last_at": now_utc()})
    await _task_bump(db, uid, "room_10m")
    try:
        room = await db.rooms.find_one({"_id": ObjectId(body.room_id)}, {"seats": 1})
    except Exception:
        room = None
    seated = any(((s or {}).get("user") or {}).get("id") == uid for s in (room or {}).get("seats") or [])
    if seated:
        for tid in ("mic_10m", "mic_20m", "mic_30m"):
            await _task_bump(db, uid, tid)
    return {"ok": True, "seated": seated}


# ---------- One owned room per user: safe dedupe ----------
async def _iter117_dedupe_rooms(db) -> None:
    """Keep exactly one non-deleted room per owner (live first, then most
    recent). Extras are SOFT-archived — chat, members and history retained."""
    dupes = await db.rooms.aggregate([
        {"$match": {"is_deleted": {"$ne": True}, "owner_id": {"$exists": True}}},
        {"$sort": {"is_live": -1, "created_at": -1}},
        {"$group": {"_id": "$owner_id", "ids": {"$push": "$_id"}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]).to_list(None)
    archived = 0
    for d in dupes:
        extras = d["ids"][1:]
        r = await db.rooms.update_many(
            {"_id": {"$in": extras}},
            {"$set": {"is_deleted": True, "is_live": False, "archived_reason": "duplicate_cleanup", "archived_at": now_utc()}},
        )
        archived += r.modified_count
    if archived:
        logger.info(f"Iter-117 dedupe: archived {archived} duplicate rooms across {len(dupes)} owners")
    try:
        await db.users.create_index("referral_code", sparse=True)
        missing = db.users.find({"referral_code": {"$exists": False}}, {"_id": 1})
        async for u in missing:
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"referral_code": _make_short_code(str(u["_id"]))}})
    except Exception as e:
        logger.warning(f"referral backfill: {e}")



# ---------- VIP5+ profile cover ----------
class _ProfileCoverIn(BaseModel):
    cover_url: str = Field(max_length=200)


@api.patch("/users/me/cover")
async def _update_profile_cover(body: _ProfileCoverIn, user=Depends(current_user)):
    """Only VIP5+ users may set a custom profile cover (uploaded image they own)."""
    if int(user.get("vip_level", 0) or 0) < 5:
        raise HTTPException(403, "VIP5_REQUIRED")
    db = app.state.db
    uid = str(user["_id"])
    if await _is_user_media_blocked(db, uid):
        raise HTTPException(403, "USER_MEDIA_BLOCKED")
    url = body.cover_url.strip()
    await _assert_media_owned(db, url, uid)
    f = await db.media_files.find_one({"_id": ObjectId(_MEDIA_URL_RE.search(url).group(1))})
    if (f or {}).get("kind") != "image":
        raise HTTPException(400, "Cover must be an image")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"cover_url": url}})
    u = await db.users.find_one({"_id": user["_id"]})
    return public_user(u)


# ───────────── Iter-150 — Name-change limits · Full mute · Room images · Push ─────────────
import asyncio  # noqa: E402
import push as _push  # noqa: E402

NAME_CHANGE_DEFAULTS = {0: 1, 1: 2, 2: 2, 3: 4, 4: 4, 5: 6, 6: 6}
SEAT_GRACE_S = 180


async def _name_change_limits(db) -> dict:
    doc = await db.config.find_one({"_id": "name_change_limits"}) or {}
    lim = dict(NAME_CHANGE_DEFAULTS)
    for k, v in (doc.get("limits") or {}).items():
        try:
            lim[int(k)] = int(v)
        except Exception:
            pass
    return lim


async def _name_change_status(db, user: dict) -> dict:
    lim = await _name_change_limits(db)
    lv = int(user.get("vip_level", 0) or 0)
    limit = lim.get(lv) if lv in lim else lim[max(k for k in lim if k <= lv)]
    month = now_utc().strftime("%Y-%m")
    nc = user.get("name_changes") or {}
    used = int(nc.get("used", 0)) if nc.get("month") == month else 0
    return {"month": month, "used": used, "limit": limit, "remaining": max(0, limit - used),
            "vip_level": lv, "table": [{"vip": "0", "limit": lim[0]}, {"vip": "1-2", "limit": lim[1]},
                                       {"vip": "3-4", "limit": lim[3]}, {"vip": "5-6", "limit": lim[5]}]}


@api.get("/users/me/name-changes")
async def _name_changes_ep(user=Depends(current_user)):
    return await _name_change_status(app.state.db, user)


async def _seat_grace_vacate(room_id: str, uid: str) -> None:
    """Release a seat only after the user stayed disconnected for SEAT_GRACE_S."""
    await asyncio.sleep(SEAT_GRACE_S)
    if uid in _hub.presence.get(room_id, {}):
        return
    try:
        r = await app.state.db.rooms.update_one(
            {"_id": ObjectId(room_id), "seats.user.id": uid},
            {"$set": {"seats.$.user": None, "seats.$.muted": False}})
        if r.modified_count:
            await _broadcast_room_state(room_id)
    except Exception:
        pass


class _FullMuteIn(BaseModel):
    user_id: str
    mute: bool


@api.post("/rooms/{room_id}/seats/full-mute")
async def _room_full_mute(room_id: str, body: _FullMuteIn, user=Depends(current_user)):
    """Profile-card mute: silences the user's mic AND their outgoing room music.
    Owner/mods → anyone (not the owner unless self); ordinary users → self only.
    A mute applied by staff cannot be lifted by the muted user."""
    db = app.state.db
    try:
        oid = ObjectId(room_id)
    except Exception:
        raise HTTPException(404, "Room not found")
    room = await db.rooms.find_one({"_id": oid})
    if not room:
        raise HTTPException(404, "Room not found")
    me = str(user["_id"])
    staff = me == room.get("owner_id") or me in (room.get("moderators") or [])
    target = body.user_id
    if target != me and not staff:
        raise HTTPException(403, "Not allowed")
    if target != me and target == room.get("owner_id"):
        raise HTTPException(403, "Cannot mute the owner")
    if not any(((s or {}).get("user") or {}).get("id") == target for s in room.get("seats") or []):
        raise HTTPException(400, "Not on a seat")
    fm = room.get("full_muted_users") or {}
    if not body.mute and target == me and fm.get(me) not in (None, me) and not staff:
        raise HTTPException(403, "MUTED_BY_STAFF")
    if body.mute:
        await db.rooms.update_one({"_id": oid}, {"$set": {f"full_muted_users.{target}": me}})
        m = room.get("music") or {}
        if m.get("playing") and m.get("dj_id") == target:
            m["playing"] = False
            m["rev"] = int(m.get("rev", 0)) + 1
            await _music_save(db, room_id, m)
    else:
        await db.rooms.update_one({"_id": oid}, {"$unset": {f"full_muted_users.{target}": ""}})
    await _broadcast_room_state(room_id)
    r2 = await db.rooms.find_one({"_id": oid}, {"password_hash": 0})
    return public_room(r2)


class _RoomImageIn(BaseModel):
    media_url: str = Field(max_length=200)


@api.post("/rooms/{room_id}/chat/image")
async def _room_chat_image(room_id: str, body: _RoomImageIn, user=Depends(current_user)):
    db = app.state.db
    uid = str(user["_id"])
    if int(user.get("vip_level", 0) or 0) < 5:
        raise HTTPException(403, "VIP5_REQUIRED")
    if uid not in _hub.presence.get(room_id, {}):
        raise HTTPException(403, "Join the room first")
    _rc = await db.rooms.find_one({"_id": ObjectId(room_id)}, {"owner_id": 1, "moderators": 1, "chat_locked": 1, "chat_muted_users": 1})
    if not _rc:
        raise HTTPException(404, "Room not found")
    _priv = uid == _rc.get("owner_id") or uid in (_rc.get("moderators") or [])
    if not _priv and (uid in (_rc.get("chat_muted_users") or []) or _rc.get("chat_locked")):
        raise HTTPException(403, "CHAT_MUTED")
    _m = re.match(r"^/api/media/files/([0-9a-f]{24})$", body.media_url)
    f = await db.media_files.find_one({"_id": ObjectId(_m.group(1)), "owner_id": uid, "is_deleted": {"$ne": True}}) if _m else None
    if not f or f.get("kind") != "image" or not f.get("public"):
        raise HTTPException(400, "Invalid media")
    _now = now_utc()
    _now = _now.replace(microsecond=(_now.microsecond // 1000) * 1000)
    entry = {"room_id": room_id, "mid": secrets.token_hex(8), "user_id": uid, "text": "",
             "kind": "image", "media_url": body.media_url, "created_at": _now}
    await db.room_chat.insert_one(entry)
    pub = {"id": uid, "nickname": user.get("nickname"), "avatar_url": user.get("avatar_url"),
           "vip_level": int(user.get("vip_level", 0) or 0), "wealth_level": int(user.get("wealth_level", 0) or 0),
           "charm_level": int(user.get("charm_level", 0) or 0), "age": user.get("age")}
    await _hub.broadcast(room_id, {"type": "chat", "id": entry["mid"], "user": pub, "text": "", "kind": "image",
                                   "media_url": body.media_url, "at": _now.isoformat()})
    return {"ok": True, "id": entry["mid"]}


# ---- Push notifications (Firebase Cloud Messaging) ----
class RegisterPushBody(BaseModel):
    user_id: Optional[str] = None
    platform: Literal["android", "ios"]
    device_token: str = Field(min_length=8, max_length=4096)


@api.post("/register-push", status_code=201)
async def _register_push(body: RegisterPushBody, user=Depends(current_user)):
    await _push.register_device(app.state.db, str(user["_id"]), body.platform, body.device_token)
    return {"status": "registered"}


class _PushPrefIn(BaseModel):
    enabled: bool


@api.get("/users/me/push")
async def _push_pref_get(user=Depends(current_user)):
    return {"enabled": user.get("push_enabled", True) is not False}


@api.put("/users/me/push")
async def _push_pref_set(body: _PushPrefIn, user=Depends(current_user)):
    await app.state.db.users.update_one({"_id": user["_id"]}, {"$set": {"push_enabled": body.enabled}})
    return {"enabled": body.enabled}


async def _notify_push(recipient_ids: list[str], title: str, message: str, action_url: Optional[str] = None,
                       key: Optional[str] = None) -> None:
    """Fire-and-forget push; respects per-user ON/OFF and never blocks the caller."""
    async def _run():
        try:
            ids = []
            for rid in dict.fromkeys(recipient_ids):
                try:
                    u = await app.state.db.users.find_one({"_id": ObjectId(rid)}, {"push_enabled": 1})
                except Exception:
                    u = None
                if u and u.get("push_enabled", True) is not False:
                    ids.append(rid)
            data = {"title": title[:80], "message": message[:200]}
            if action_url:
                data["action_url"] = action_url
            await _push.send_push(app.state.db, ids, data, idempotency_key=key)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Push failed (non-blocking): {e}")
    asyncio.create_task(_run())


# ---- Native client diagnostics (release-build crash / error reports) ----
class _ClientErrIn(BaseModel):
    kind: str = Field(max_length=20)
    message: str = Field(max_length=600)
    stack: str = Field(default="", max_length=3000)
    extra: str = Field(default="", max_length=2000)
    platform: str = Field(default="", max_length=10)
    os_version: str = Field(default="", max_length=20)
    app_version: str = Field(default="", max_length=20)
    route: str = Field(default="", max_length=200)


@api.post("/client-errors", status_code=201)
async def _client_error(body: _ClientErrIn, request: Request):
    db = app.state.db
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    since = now_utc() - timedelta(minutes=10)
    if await db.client_errors.count_documents({"ip": ip, "created_at": {"$gte": since}}) >= 60:
        return {"ok": False}
    await db.client_errors.insert_one({**body.model_dump(), "ip": ip, "created_at": now_utc()})
    return {"ok": True}


@api.get("/admin/client-errors")
async def _client_errors_list(limit: int = 100, user=Depends(current_user)):
    await _require_admin_perm(user, "rooms.manage")
    out = []
    async for d in app.state.db.client_errors.find({}, {"_id": 0, "ip": 0}).sort("created_at", -1).limit(min(limit, 300)):
        d["created_at"] = d["created_at"].isoformat()
        out.append(d)
    return {"items": out}


@app.get("/health")
async def _root_health():
    return {"status": "ok"}


app.include_router(api)


