"""
ORIO — Admin Dashboard module (Iter-86 Owner + Approved Admin model)
=====================================================================

Security model:
  • One Owner (identity determined by email match with configured owner_email).
  • Zero or more Approved Admins — email + per-permission flags + enabled flag.
  • A request has admin access only if either:
      (a) authenticated user's email == owner_email, OR
      (b) authenticated user's email is in admin_approvals with enabled=true.
  • Every API endpoint enforces this server-side via `require_admin(perm=...)`.
  • Knowing the admin URL / having a normal ORIO account is NEVER enough.

Collections used:
  • admin_config         — singleton doc `{_id:"config", owner_email, ...}`
  • admin_approvals      — one doc per approved admin email
  • admin_audit          — every admin mutation
  • wallet_transactions  — admin_adjust entries (mirrored for ledger)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field, field_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------
PERMISSIONS: List[str] = [
    # Users
    "users.view", "users.manage", "users.ban",
    # Rooms
    "rooms.view", "rooms.manage", "rooms.lock", "rooms.close",
    # Reports
    "reports.view", "reports.resolve", "reports.dismiss", "reports.ban",
    # VIP
    "vip.view", "vip.manage",
    # Wallet
    "wallet.view", "wallet.adjust",
    # Withdrawals
    "withdrawals.view", "withdrawals.approve", "withdrawals.reject",
    # Audit
    "audit.view",
    # Iter-118 — Phase 1 granular controls
    "users.edit_profile", "users.levels", "users.sessions",
    "bans.view", "bans.manage",
    "messages.review",
]
PERMISSIONS_SET = set(PERMISSIONS)
OWNER_EMAIL_DEFAULT = "orioowner@gmail.com"


def _normalise_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


# ---------------------------------------------------------------------------
# Pydantic request bodies (module-scope so FastAPI/pydantic resolve forward refs)
# ---------------------------------------------------------------------------
class UserPatchIn(BaseModel):
    is_banned: Optional[bool] = None
    vip_level: Optional[int] = Field(default=None, ge=0, le=10)
    vip_days: Optional[int] = Field(default=None, ge=0, le=3650,
                                    description="If set with vip_level≥1, extends vip_expires_at by N days.")
    diamonds_delta: Optional[int] = Field(default=None, ge=-10_000_000, le=10_000_000)
    coins_delta: Optional[int] = Field(default=None, ge=-10_000_000, le=10_000_000)
    reason: Optional[str] = Field(default=None, max_length=240)


class RoomPatchIn(BaseModel):
    is_live: Optional[bool] = None
    is_locked: Optional[bool] = None
    reason: Optional[str] = Field(default=None, max_length=240)


class ReportActionIn(BaseModel):
    action: str = Field(pattern="^(resolve|dismiss|ban_reported|warn_reported)$")
    note: Optional[str] = Field(default=None, max_length=240)


class AdminTeamIn(BaseModel):
    email: EmailStr
    permissions: List[str] = Field(default_factory=list)

    @field_validator("permissions")
    @classmethod
    def _check_perms(cls, v: List[str]) -> List[str]:
        bad = [p for p in v if p not in PERMISSIONS_SET]
        if bad:
            raise ValueError(f"Unknown permissions: {bad}")
        return list(dict.fromkeys(v))  # dedupe, preserve order


class AdminTeamPatchIn(BaseModel):
    permissions: Optional[List[str]] = None
    enabled: Optional[bool] = None

    @field_validator("permissions")
    @classmethod
    def _check_perms(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        bad = [p for p in v if p not in PERMISSIONS_SET]
        if bad:
            raise ValueError(f"Unknown permissions: {bad}")
        return list(dict.fromkeys(v))


class OwnerEmailChangeIn(BaseModel):
    new_email: EmailStr


# ---------------------------------------------------------------------------
# Owner / Admin configuration helpers
# ---------------------------------------------------------------------------
async def get_owner_email(db) -> str:
    """Return the current owner email (normalised, lower-case)."""
    try:
        doc = await db.admin_config.find_one({"_id": "config"})
    except Exception:
        doc = None
    env_default = _normalise_email(os.getenv("ADMIN_OWNER_EMAIL") or OWNER_EMAIL_DEFAULT)
    if doc and doc.get("owner_email"):
        return _normalise_email(doc["owner_email"])
    return env_default


async def seed_admin(db) -> None:
    """Idempotent — ensure admin_config exists with owner_email from env/default.

    Does NOT create any user accounts. The owner must authenticate via Google
    (or any supported login) using the configured owner email; identity is
    verified by email match, not by a seeded password.
    """
    now = datetime.now(timezone.utc)
    owner_email = _normalise_email(os.getenv("ADMIN_OWNER_EMAIL") or OWNER_EMAIL_DEFAULT)
    try:
        await db.admin_config.update_one(
            {"_id": "config"},
            {
                "$setOnInsert": {
                    "_id": "config",
                    "owner_email": owner_email,
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )
        logger.info(f"admin_seed: owner_email configured as {owner_email}")

        # Ensure useful indexes (idempotent).
        try:
            await db.admin_approvals.create_index([("email", 1)], unique=True)
        except Exception as e:
            logger.debug(f"admin_approvals index: {e}")
    except Exception as e:
        logger.warning(f"admin_seed: failed: {e}")


async def resolve_admin_access(db, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return {is_owner, permissions, enabled} if user is admin, else None.

    - Owner → all permissions, is_owner=True.
    - Approved admin with enabled=True → their permission set.
    - Everyone else → None (denied).
    """
    if not user:
        return None
    email = _normalise_email(user.get("email"))
    if not email:
        return None
    owner_email = await get_owner_email(db)
    if email == owner_email:
        return {"is_owner": True, "permissions": list(PERMISSIONS), "enabled": True}
    try:
        approval = await db.admin_approvals.find_one({"email": email})
    except Exception:
        approval = None
    if approval and approval.get("enabled") is True:
        perms = [p for p in (approval.get("permissions") or []) if p in PERMISSIONS_SET]
        return {"is_owner": False, "permissions": perms, "enabled": True}
    return None


# ---------------------------------------------------------------------------
# Router builder
# ---------------------------------------------------------------------------
def make_router(current_user_dep) -> APIRouter:
    """Build the admin dashboard router. `current_user_dep` is server.py's current_user."""

    router = APIRouter(prefix="/admin/dashboard", tags=["admin-dashboard"])

    # ---------- Dependencies ----------
    def require_admin(permission: Optional[str] = None):
        async def _dep(user=Depends(current_user_dep)):
            # Lazy import inside the closure to avoid a circular import at module load.
            from server import app  # noqa: WPS433
            db = app.state.db
            access = await resolve_admin_access(db, user)
            if not access:
                raise HTTPException(403, "Admin access denied")
            if permission and permission not in PERMISSIONS_SET:
                raise HTTPException(500, "Invalid required permission")
            if permission and not access["is_owner"] and permission not in access["permissions"]:
                raise HTTPException(403, f"Missing permission: {permission}")
            # Attach context for handlers (owner flag, permissions)
            return {"user": user, "access": access}
        return _dep

    def require_owner():
        async def _dep(user=Depends(current_user_dep)):
            from server import app  # noqa: WPS433
            db = app.state.db
            access = await resolve_admin_access(db, user)
            if not access or not access["is_owner"]:
                raise HTTPException(403, "Owner-only action")
            return {"user": user, "access": access}
        return _dep

    # ---------- Helpers ----------
    def _oid(id_str: str) -> ObjectId:
        try:
            return ObjectId(id_str)
        except (InvalidId, TypeError, ValueError):
            raise HTTPException(400, "Invalid id")

    def _slim_user(u: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(u["_id"]),
            "email": u.get("email"),
            "username": u.get("username"),
            "nickname": u.get("nickname"),
            "numeric_id": u.get("numeric_id"),
            "avatar_url": u.get("avatar_url"),
            "animated_avatar_url": u.get("animated_avatar_url"),
            "vip_level": u.get("vip_level") or 0,
            "coins": u.get("coins") or 0,
            "diamonds": u.get("diamonds") or 0,
            "level": u.get("level") or 1,
            "is_banned": bool(u.get("is_banned")),
            "created_at": (u.get("created_at").isoformat() if u.get("created_at") else None),
            "language": u.get("language"),
            "phone": u.get("phone"),
            "facebook_id": u.get("facebook_id"),
        }

    def _slim_room(r: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(r["_id"]),
            "name": r.get("name"),
            "title": r.get("title") or r.get("name"),
            "owner_id": r.get("owner_id"),
            "owner_nickname": (r.get("owner_public") or {}).get("nickname"),
            "owner_username": (r.get("owner_public") or {}).get("username"),
            "cover_url": r.get("cover_url"),
            "background_url": r.get("background_url") or r.get("custom_background_url"),
            "num_seats": r.get("num_seats") or len(r.get("seats") or []),
            "is_live": bool(r.get("is_live")),
            "is_locked": bool(r.get("is_locked")),
            "listeners_count": r.get("listeners_count") or 0,
            "created_at": (r.get("created_at").isoformat() if r.get("created_at") else None),
            "category": r.get("category"),
            "country": r.get("country"),
        }

    def _slim_tx(t: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(t.get("_id")),
            "user_id": t.get("user_id"),
            "type": t.get("type"),
            "currency": t.get("currency"),
            "amount": t.get("amount"),
            "balance_after": t.get("balance_after"),
            "status": t.get("status"),
            "description": t.get("description"),
            "created_at": (t.get("created_at").isoformat() if t.get("created_at") else None),
        }

    def _slim_report(r: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(r.get("_id")),
            "reporter_id": r.get("reporter_id"),
            "reported_id": r.get("reported_id"),
            "reason": r.get("reason"),
            "details": r.get("details"),
            "status": r.get("status") or "open",
            "media_kind": r.get("media_kind"),
            "has_media": bool(r.get("media_data_url")),
            "created_at": (r.get("created_at").isoformat() if r.get("created_at") else None),
            "resolved_at": (r.get("resolved_at").isoformat() if r.get("resolved_at") else None),
            "resolved_by": r.get("resolved_by"),
            "action": r.get("action"),
        }

    async def _audit(db, actor: Dict[str, Any], **fields):
        try:
            doc = {
                "admin_id": str(actor["_id"]),
                "admin_email": _normalise_email(actor.get("email")),
                "created_at": datetime.now(timezone.utc),
                **fields,
            }
            await db.admin_audit.insert_one(doc)
        except Exception as e:
            logger.debug(f"audit write failed: {e}")

    # ======================================================================
    # Stats
    # ======================================================================
    @router.get("/stats")
    async def dashboard_stats(ctx=Depends(require_admin())):
        from server import app
        db = app.state.db
        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)

        total_users = await db.users.count_documents({})
        new_users_24h = await db.users.count_documents({"created_at": {"$gte": day_ago}})
        new_users_7d = await db.users.count_documents({"created_at": {"$gte": week_ago}})
        vip_users = await db.users.count_documents({"vip_level": {"$gte": 1}})
        banned_users = await db.users.count_documents({"is_banned": True})

        # Admin count = owner + enabled approvals
        admin_users = 1
        try:
            admin_users += await db.admin_approvals.count_documents({"enabled": True})
        except Exception:
            pass

        total_rooms = await db.rooms.count_documents({})
        live_rooms = await db.rooms.count_documents({"is_live": True})

        econ = {"diamonds": 0, "coins": 0}
        async for row in db.users.aggregate([
            {"$group": {
                "_id": None,
                "diamonds": {"$sum": {"$ifNull": ["$diamonds", 0]}},
                "coins": {"$sum": {"$ifNull": ["$coins", 0]}},
            }}
        ]):
            econ["diamonds"] = int(row.get("diamonds") or 0)
            econ["coins"] = int(row.get("coins") or 0)

        open_reports = 0
        try:
            open_reports = await db.user_reports.count_documents({"status": "open"})
        except Exception:
            pass

        pending_withdrawals = 0
        try:
            pending_withdrawals = await db.withdrawals.count_documents(
                {"status": {"$in": ["REQUESTED", "UNDER_REVIEW"]}}
            )
        except Exception:
            pass

        vip_breakdown: Dict[str, int] = {}
        async for row in db.users.aggregate([
            {"$match": {"vip_level": {"$gte": 1}}},
            {"$group": {"_id": "$vip_level", "count": {"$sum": 1}}},
        ]):
            vip_breakdown[str(int(row["_id"]))] = int(row["count"])

        return {
            "users": {
                "total": total_users,
                "new_24h": new_users_24h,
                "new_7d": new_users_7d,
                "vip": vip_users,
                "banned": banned_users,
                "admins": admin_users,
            },
            "rooms": {"total": total_rooms, "live": live_rooms},
            "economy": econ,
            "vip_breakdown": vip_breakdown,
            "moderation": {
                "open_reports": open_reports,
                "pending_withdrawals": pending_withdrawals,
            },
            "server_time": now.isoformat(),
            "access": ctx["access"],  # inform client of its own permissions
        }

    # ======================================================================
    # Users
    # ======================================================================
    @router.get("/users")
    async def list_users(
        q: Optional[str] = Query(default=None),
        filter: Optional[str] = Query(default=None),
        limit: int = Query(default=50, le=200),
        skip: int = Query(default=0, ge=0),
        ctx=Depends(require_admin("users.view")),
    ):
        from server import app
        db = app.state.db
        query: Dict[str, Any] = {}
        if q:
            query["$or"] = [
                {"email": {"$regex": q, "$options": "i"}},
                {"username": {"$regex": q, "$options": "i"}},
                {"nickname": {"$regex": q, "$options": "i"}},
                {"numeric_id": q},
            ]
        if filter == "vip":
            query["vip_level"] = {"$gte": 1}
        elif filter == "banned":
            query["is_banned"] = True
        elif filter == "new":
            query["created_at"] = {"$gte": datetime.now(timezone.utc) - timedelta(days=7)}
        total = await db.users.count_documents(query)
        cur = db.users.find(query).sort("created_at", -1).skip(skip).limit(limit)
        items = [_slim_user(u) async for u in cur]
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    @router.patch("/users/{user_id}")
    async def patch_user(user_id: str, body: UserPatchIn = Body(...),
                         ctx=Depends(require_admin("users.manage"))):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        access = ctx["access"]
        oid = _oid(user_id)
        target = await db.users.find_one({"_id": oid})
        if not target:
            raise HTTPException(404, "User not found")

        # Owner can never be modified by anyone — even themselves — through this endpoint.
        owner_email = await get_owner_email(db)
        if _normalise_email(target.get("email")) == owner_email:
            raise HTTPException(400, "Owner cannot be modified from this endpoint")

        # Self-protection
        if str(target["_id"]) == str(actor["_id"]):
            if body.is_banned is True:
                raise HTTPException(400, "You cannot ban yourself")

        # Ban requires the dedicated users.ban permission (or owner).
        if body.is_banned is not None and not access["is_owner"] and "users.ban" not in access["permissions"]:
            raise HTTPException(403, "Missing permission: users.ban")
        # VIP changes require vip.manage.
        if (body.vip_level is not None or body.vip_days is not None) and not access["is_owner"] and "vip.manage" not in access["permissions"]:
            raise HTTPException(403, "Missing permission: vip.manage")
        # Wallet changes require wallet.adjust.
        if (body.diamonds_delta or body.coins_delta) and not access["is_owner"] and "wallet.adjust" not in access["permissions"]:
            raise HTTPException(403, "Missing permission: wallet.adjust")

        set_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
        unset_fields: Dict[str, Any] = {}
        if body.is_banned is not None:
            set_fields["is_banned"] = bool(body.is_banned)
            if body.is_banned:
                set_fields["banned_at"] = datetime.now(timezone.utc)
                set_fields["banned_by"] = str(actor["_id"])
        if body.vip_level is not None:
            set_fields["vip_level"] = int(body.vip_level)
            if body.vip_level == 0:
                unset_fields["vip_expires_at"] = ""
            elif body.vip_days and body.vip_days > 0:
                base = datetime.now(timezone.utc)
                existing = target.get("vip_expires_at")
                if isinstance(existing, datetime) and existing > base:
                    base = existing
                set_fields["vip_expires_at"] = base + timedelta(days=int(body.vip_days))

        inc_fields: Dict[str, Any] = {}
        if body.diamonds_delta:
            inc_fields["diamonds"] = int(body.diamonds_delta)
        if body.coins_delta:
            inc_fields["coins"] = int(body.coins_delta)

        update: Dict[str, Any] = {}
        if set_fields:
            update["$set"] = set_fields
        if unset_fields:
            update["$unset"] = unset_fields
        if inc_fields:
            update["$inc"] = inc_fields
        if not update:
            raise HTTPException(400, "No changes requested")

        await db.users.update_one({"_id": oid}, update)

        now = datetime.now(timezone.utc)
        if body.diamonds_delta:
            new_balance = (target.get("diamonds") or 0) + int(body.diamonds_delta)
            await db.wallet_transactions.insert_one({
                "user_id": str(oid), "type": "admin_adjust", "currency": "diamonds",
                "amount": int(body.diamonds_delta), "balance_after": new_balance,
                "status": "completed",
                "description": body.reason or "Admin diamond adjustment",
                "created_at": now, "admin_id": str(actor["_id"]),
            })
        if body.coins_delta:
            new_balance = (target.get("coins") or 0) + int(body.coins_delta)
            await db.wallet_transactions.insert_one({
                "user_id": str(oid), "type": "admin_adjust", "currency": "coins",
                "amount": int(body.coins_delta), "balance_after": new_balance,
                "status": "completed",
                "description": body.reason or "Admin coin adjustment",
                "created_at": now, "admin_id": str(actor["_id"]),
            })

        await _audit(db, actor, target_user_id=str(oid), patch=body.model_dump(exclude_none=True))

        fresh = await db.users.find_one({"_id": oid})
        return {"ok": True, "user": _slim_user(fresh)}

    # ======================================================================
    # Rooms
    # ======================================================================
    @router.get("/rooms")
    async def list_rooms(
        q: Optional[str] = Query(default=None),
        filter: Optional[str] = Query(default=None),
        limit: int = Query(default=50, le=200),
        skip: int = Query(default=0, ge=0),
        _=Depends(require_admin("rooms.view")),
    ):
        from server import app
        db = app.state.db
        query: Dict[str, Any] = {}
        if q:
            query["$or"] = [
                {"name": {"$regex": q, "$options": "i"}},
                {"title": {"$regex": q, "$options": "i"}},
                {"owner_public.username": {"$regex": q, "$options": "i"}},
                {"owner_public.nickname": {"$regex": q, "$options": "i"}},
            ]
        if filter == "live":
            query["is_live"] = True
        elif filter == "locked":
            query["is_locked"] = True
        elif filter == "new":
            query["created_at"] = {"$gte": datetime.now(timezone.utc) - timedelta(days=7)}
        total = await db.rooms.count_documents(query)
        cur = db.rooms.find(query).sort("created_at", -1).skip(skip).limit(limit)
        items = [_slim_room(r) async for r in cur]
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    @router.patch("/rooms/{room_id}")
    async def patch_room(room_id: str, body: RoomPatchIn = Body(...),
                         ctx=Depends(require_admin("rooms.manage"))):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        access = ctx["access"]
        oid = _oid(room_id)
        room = await db.rooms.find_one({"_id": oid})
        if not room:
            raise HTTPException(404, "Room not found")

        # Fine-grained perms: close requires rooms.close, lock requires rooms.lock.
        if body.is_live is False and not access["is_owner"] and "rooms.close" not in access["permissions"]:
            raise HTTPException(403, "Missing permission: rooms.close")
        if body.is_locked is not None and not access["is_owner"] and "rooms.lock" not in access["permissions"]:
            raise HTTPException(403, "Missing permission: rooms.lock")

        set_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
        if body.is_live is not None:
            set_fields["is_live"] = bool(body.is_live)
            if body.is_live is False:
                set_fields["closed_at"] = datetime.now(timezone.utc)
                set_fields["closed_by"] = str(actor["_id"])
        if body.is_locked is not None:
            set_fields["is_locked"] = bool(body.is_locked)
        if len(set_fields) == 1:
            raise HTTPException(400, "No changes requested")
        await db.rooms.update_one({"_id": oid}, {"$set": set_fields})
        await _audit(db, actor, target_room_id=str(oid), patch=body.model_dump(exclude_none=True))
        fresh = await db.rooms.find_one({"_id": oid})
        return {"ok": True, "room": _slim_room(fresh)}

    # ======================================================================
    # Wallet / VIP
    # ======================================================================
    @router.get("/transactions")
    async def recent_transactions(
        currency: Optional[str] = Query(default=None),
        type: Optional[str] = Query(default=None),
        limit: int = Query(default=100, le=500),
        skip: int = Query(default=0, ge=0),
        _=Depends(require_admin("wallet.view")),
    ):
        from server import app
        db = app.state.db
        query: Dict[str, Any] = {}
        if currency in ("diamonds", "coins"):
            query["currency"] = currency
        if type:
            query["type"] = type
        total = await db.wallet_transactions.count_documents(query)
        cur = db.wallet_transactions.find(query).sort("created_at", -1).skip(skip).limit(limit)
        items = [_slim_tx(t) async for t in cur]
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    @router.get("/vip")
    async def vip_members(
        min_level: int = Query(default=1, ge=1, le=10),
        limit: int = Query(default=100, le=500),
        skip: int = Query(default=0, ge=0),
        _=Depends(require_admin("vip.view")),
    ):
        from server import app
        db = app.state.db
        query: Dict[str, Any] = {"vip_level": {"$gte": min_level}}
        total = await db.users.count_documents(query)
        cur = db.users.find(query).sort([("vip_level", -1), ("vip_expires_at", -1)]).skip(skip).limit(limit)
        items: List[Dict[str, Any]] = []
        async for u in cur:
            d = _slim_user(u)
            exp = u.get("vip_expires_at")
            d["vip_expires_at"] = exp.isoformat() if isinstance(exp, datetime) else None
            items.append(d)
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    # ======================================================================
    # Reports
    # ======================================================================
    @router.get("/reports")
    async def list_reports(
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=50, le=200),
        skip: int = Query(default=0, ge=0),
        _=Depends(require_admin("reports.view")),
    ):
        from server import app
        db = app.state.db
        query: Dict[str, Any] = {}
        if status in ("open", "resolved", "dismissed"):
            query["status"] = status
        try:
            total = await db.user_reports.count_documents(query)
        except Exception:
            return {"total": 0, "items": [], "skip": skip, "limit": limit}
        cur = db.user_reports.find(query).sort("created_at", -1).skip(skip).limit(limit)

        raw_items = []
        async for r in cur:
            raw_items.append(r)

        ids: set = set()
        for r in raw_items:
            if r.get("reporter_id"):
                ids.add(r["reporter_id"])
            if r.get("reported_id"):
                ids.add(r["reported_id"])
        users_map: Dict[str, Dict[str, Any]] = {}
        if ids:
            oids = []
            for s in ids:
                try:
                    oids.append(ObjectId(s))
                except Exception:
                    continue
            async for u in db.users.find(
                {"_id": {"$in": oids}},
                {"username": 1, "nickname": 1, "avatar_url": 1, "numeric_id": 1},
            ):
                users_map[str(u["_id"])] = {
                    "username": u.get("username"),
                    "nickname": u.get("nickname"),
                    "avatar_url": u.get("avatar_url"),
                    "numeric_id": u.get("numeric_id"),
                }

        items = []
        for r in raw_items:
            d = _slim_report(r)
            d["reporter"] = users_map.get(d["reporter_id"] or "")
            d["reported"] = users_map.get(d["reported_id"] or "")
            items.append(d)
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    @router.get("/reports/{report_id}")
    async def report_detail(report_id: str, _=Depends(require_admin("reports.view"))):
        from server import app
        db = app.state.db
        oid = _oid(report_id)
        r = await db.user_reports.find_one({"_id": oid})
        if not r:
            raise HTTPException(404, "Report not found")
        d = _slim_report(r)
        d["media_data_url"] = r.get("media_data_url")
        return d

    @router.patch("/reports/{report_id}")
    async def act_on_report(report_id: str, body: ReportActionIn = Body(...),
                             ctx=Depends(require_admin())):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        access = ctx["access"]
        oid = _oid(report_id)
        r = await db.user_reports.find_one({"_id": oid})
        if not r:
            raise HTTPException(404, "Report not found")

        # Fine-grained perms per action.
        required = {
            "resolve": "reports.resolve",
            "dismiss": "reports.dismiss",
            "ban_reported": "reports.ban",
            "warn_reported": "reports.resolve",
        }[body.action]
        if not access["is_owner"] and required not in access["permissions"]:
            raise HTTPException(403, f"Missing permission: {required}")

        now = datetime.now(timezone.utc)
        status = "resolved" if body.action in ("resolve", "ban_reported", "warn_reported") else "dismissed"
        await db.user_reports.update_one(
            {"_id": oid},
            {"$set": {
                "status": status, "resolved_at": now, "resolved_by": str(actor["_id"]),
                "action": body.action, "resolver_note": body.note,
            }},
        )
        if body.action == "ban_reported" and r.get("reported_id"):
            try:
                await db.users.update_one(
                    {"_id": ObjectId(r["reported_id"])},
                    {"$set": {"is_banned": True, "banned_at": now, "banned_by": str(actor["_id"])}},
                )
            except Exception:
                pass
        await _audit(db, actor, target_report_id=str(oid), action=body.action, note=body.note)
        return {"ok": True}

    # ======================================================================
    # Audit
    # ======================================================================
    @router.get("/audit")
    async def audit_log(
        limit: int = Query(default=100, le=500),
        skip: int = Query(default=0, ge=0),
        _=Depends(require_admin("audit.view")),
    ):
        from server import app
        db = app.state.db
        try:
            total = await db.admin_audit.count_documents({})
        except Exception:
            return {"total": 0, "items": [], "skip": skip, "limit": limit}
        cur = db.admin_audit.find({}).sort("created_at", -1).skip(skip).limit(limit)
        items = []
        async for a in cur:
            items.append({
                "id": str(a.get("_id")),
                "admin_id": a.get("admin_id"),
                "admin_email": a.get("admin_email"),
                "target_user_id": a.get("target_user_id"),
                "target_room_id": a.get("target_room_id"),
                "target_report_id": a.get("target_report_id"),
                "target_admin_email": a.get("target_admin_email"),
                "patch": a.get("patch"),
                "action": a.get("action"),
                "note": a.get("note"),
                "created_at": (a.get("created_at").isoformat() if a.get("created_at") else None),
            })
        return {"total": total, "items": items, "skip": skip, "limit": limit}

    # ======================================================================
    # Admin team (Owner only) — add/remove/enable/disable/update
    # ======================================================================
    @router.get("/team")
    async def list_team(ctx=Depends(require_owner())):
        from server import app
        db = app.state.db
        items: List[Dict[str, Any]] = []
        async for a in db.admin_approvals.find({}).sort("created_at", -1):
            items.append({
                "email": a.get("email"),
                "permissions": a.get("permissions") or [],
                "enabled": bool(a.get("enabled")),
                "created_at": (a.get("created_at").isoformat() if a.get("created_at") else None),
                "updated_at": (a.get("updated_at").isoformat() if a.get("updated_at") else None),
                "created_by": a.get("created_by"),
                "disabled_at": (a.get("disabled_at").isoformat() if a.get("disabled_at") else None),
            })
        owner_email = await get_owner_email(db)
        return {"owner_email": owner_email, "items": items, "all_permissions": list(PERMISSIONS)}

    @router.post("/team")
    async def add_admin(body: AdminTeamIn = Body(...), ctx=Depends(require_owner())):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        email = _normalise_email(body.email)
        if not email:
            raise HTTPException(400, "Invalid email")
        owner_email = await get_owner_email(db)
        if email == owner_email:
            raise HTTPException(400, "Owner email cannot be added as a regular admin")
        now = datetime.now(timezone.utc)
        try:
            await db.admin_approvals.update_one(
                {"email": email},
                {
                    "$set": {
                        "email": email,
                        "permissions": body.permissions,
                        "enabled": True,
                        "updated_at": now,
                        "updated_by": str(actor["_id"]),
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "created_by": str(actor["_id"]),
                    },
                },
                upsert=True,
            )
        except Exception as e:
            raise HTTPException(500, f"Failed to add admin: {e}")
        await _audit(db, actor, target_admin_email=email, action="admin_added",
                      patch={"permissions": body.permissions, "enabled": True})
        return {"ok": True, "email": email, "permissions": body.permissions, "enabled": True}

    @router.patch("/team/{email}")
    async def patch_admin(email: str, body: AdminTeamPatchIn = Body(...),
                           ctx=Depends(require_owner())):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        em = _normalise_email(email)
        approval = await db.admin_approvals.find_one({"email": em})
        if not approval:
            raise HTTPException(404, "Admin not found")
        if body.permissions is None and body.enabled is None:
            raise HTTPException(400, "Nothing to update")
        set_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc),
                                      "updated_by": str(actor["_id"])}
        action = "admin_updated"
        if body.permissions is not None:
            set_fields["permissions"] = body.permissions
        if body.enabled is not None:
            set_fields["enabled"] = bool(body.enabled)
            if body.enabled is False:
                set_fields["disabled_at"] = datetime.now(timezone.utc)
                set_fields["disabled_by"] = str(actor["_id"])
                action = "admin_disabled"
            else:
                set_fields["disabled_at"] = None
                action = "admin_enabled"
        await db.admin_approvals.update_one({"email": em}, {"$set": set_fields})
        await _audit(db, actor, target_admin_email=em, action=action,
                      patch=body.model_dump(exclude_none=True))
        fresh = await db.admin_approvals.find_one({"email": em})
        return {"ok": True, "email": em,
                "permissions": fresh.get("permissions") or [],
                "enabled": bool(fresh.get("enabled"))}

    @router.delete("/team/{email}")
    async def remove_admin(email: str, ctx=Depends(require_owner())):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        em = _normalise_email(email)
        res = await db.admin_approvals.delete_one({"email": em})
        if res.deleted_count == 0:
            raise HTTPException(404, "Admin not found")
        await _audit(db, actor, target_admin_email=em, action="admin_removed")
        return {"ok": True, "email": em}

    # ======================================================================
    # Owner management (Owner only)
    # ======================================================================
    @router.get("/owner")
    async def get_owner(ctx=Depends(require_admin())):
        from server import app
        db = app.state.db
        return {"owner_email": await get_owner_email(db), "is_owner": ctx["access"]["is_owner"]}

    @router.post("/owner")
    async def change_owner(body: OwnerEmailChangeIn = Body(...), ctx=Depends(require_owner())):
        from server import app
        db = app.state.db
        actor = ctx["user"]
        new_email = _normalise_email(body.new_email)
        if not new_email:
            raise HTTPException(400, "Invalid email")
        previous_email = await get_owner_email(db)
        if new_email == previous_email:
            raise HTTPException(400, "That is already the current owner email")
        now = datetime.now(timezone.utc)
        await db.admin_config.update_one(
            {"_id": "config"},
            {"$set": {
                "owner_email": new_email,
                "updated_at": now,
                "updated_by": str(actor["_id"]),
                "previous_owner_email": previous_email,
            }},
            upsert=True,
        )
        # If the new email was in approvals, delete that entry — owner outranks approvals.
        try:
            await db.admin_approvals.delete_one({"email": new_email})
        except Exception:
            pass
        await _audit(db, actor, action="owner_email_changed",
                      patch={"previous": previous_email, "new": new_email})
        return {"ok": True, "previous_owner_email": previous_email, "owner_email": new_email}

    return router
