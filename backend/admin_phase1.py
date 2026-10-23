"""
Iter-118 — Admin Phase 1: full user management, advanced bans, level/wallet
controls with history, searchable audit, official Orio Team welcome.

Surgical module: mounted from server.py; reuses admin_dashboard's permission
model (resolve_admin_access) so Owner → everything, admins → only granted.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from admin_dashboard import resolve_admin_access, get_owner_email, PERMISSIONS_SET, _normalise_email

logger = logging.getLogger(__name__)

ORIO_TEAM_USERNAME = "orioteam"
ORIO_WELCOME_TEXT = ("نرحب بك في اوريو شات، يمكنك تكوين صداقات والتعرف على أصدقاء جدد من أنحاء العالم "
                     "والاستمتاع معهم، في الوقت الفعلي.Orio Team")
BAN_MESSAGE_AR = "لقد تم حظرك بسبب انتهاك خصوصية المجتمع."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d):
    if isinstance(d, datetime) and d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d


def _iso(d) -> Optional[str]:
    d = _aware(d)
    return d.isoformat() if isinstance(d, datetime) else d


# ---------------------------------------------------------------------------
# Ban enforcement (called from server.current_user on EVERY authed request)
# ---------------------------------------------------------------------------
_device_ban_cache: Dict[str, Any] = {"at": None, "ids": {}}


async def _active_device_bans(db) -> Dict[str, Any]:
    c = _device_ban_cache
    if c["at"] and (_now() - c["at"]).total_seconds() < 5:
        return c["ids"]
    ids: Dict[str, Any] = {}
    async for b in db.bans.find({"active": True, "device_ids.0": {"$exists": True}}):
        exp = _aware(b.get("expires_at"))
        if exp and exp <= _now():
            continue
        for d in b.get("device_ids") or []:
            ids[d] = b
    c["at"], c["ids"] = _now(), ids
    return ids


def invalidate_device_ban_cache() -> None:
    _device_ban_cache["at"] = None


def _ban_exc(ban: dict) -> HTTPException:
    exp = _aware(ban.get("expires_at"))
    return HTTPException(403, {
        "code": "BANNED",
        "message": BAN_MESSAGE_AR,
        "ban_type": ban.get("type"),
        "permanent": exp is None,
        "expires_at": _iso(exp),
        "server_now": _now().isoformat(),
    })


async def enforce_ban(db, user: dict, device_id: Optional[str]) -> None:
    ban = user.get("active_ban")
    if ban:
        exp = _aware(ban.get("expires_at"))
        if exp is not None and exp <= _now():
            # Exact-duration auto-lift.
            await db.users.update_one({"_id": user["_id"]}, {"$unset": {"active_ban": ""}, "$set": {"is_banned": False}})
            await db.bans.update_many({"user_id": str(user["_id"]), "active": True, "expires_at": {"$lte": _now()}},
                                      {"$set": {"active": False, "ended_reason": "expired", "ended_at": _now()}})
            invalidate_device_ban_cache()
        elif ban.get("type") in ("account", "both"):
            raise _ban_exc(ban)
    if device_id:
        dmap = await _active_device_bans(db)
        if device_id in dmap:
            raise _ban_exc(dmap[device_id])


async def track_device_and_activity(db, user: dict, device_id: Optional[str]) -> None:
    """Throttled: last_active_at (60s) and known device ids for device bans."""
    upd: Dict[str, Any] = {}
    last = _aware(user.get("last_active_at"))
    if not last or (_now() - last).total_seconds() > 60:
        upd["$set"] = {"last_active_at": _now()}
    if device_id and device_id not in (user.get("device_ids") or []):
        upd["$addToSet"] = {"device_ids": device_id}
    if upd:
        try:
            await db.users.update_one({"_id": user["_id"]}, upd)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Official Orio Team account + one-time welcome (new users only)
# ---------------------------------------------------------------------------
async def ensure_orio_team(db) -> str:
    u = await db.users.find_one({"username": ORIO_TEAM_USERNAME})
    if u:
        if not u.get("is_official"):
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"is_official": True}})
        return str(u["_id"])
    r = await db.users.insert_one({
        "email": "team@orio.official", "username": ORIO_TEAM_USERNAME, "nickname": "Orio Team",
        "is_official": True, "profile_completed": True, "password_hash": None,
        "avatar_url": None, "coins": 0, "created_at": _now(),
    })
    return str(r.inserted_id)


async def ensure_welcome_launch(db) -> datetime:
    cfg = await db.admin_config.find_one({"_id": "config"}) or {}
    at = _aware(cfg.get("orio_welcome_launch_at"))
    if not at:
        at = _now()
        await db.admin_config.update_one({"_id": "config"}, {"$set": {"orio_welcome_launch_at": at}}, upsert=True)
    return at


async def maybe_send_welcome(db, user: dict, thread_key_fn) -> None:
    """Send the official welcome ONCE to accounts registered after launch."""
    if user.get("orio_welcome_sent") or user.get("is_official"):
        return
    launch = await ensure_welcome_launch(db)
    created = _aware(user.get("created_at"))
    if not isinstance(created, datetime) or created < launch:
        return
    claimed = await db.users.update_one({"_id": user["_id"], "orio_welcome_sent": {"$ne": True}},
                                        {"$set": {"orio_welcome_sent": True}})
    if claimed.modified_count != 1:
        return
    team_id = await ensure_orio_team(db)
    uid = str(user["_id"])
    await db.messages.insert_one({
        "sender_id": team_id, "recipient_id": uid, "thread_key": thread_key_fn(team_id, uid),
        "text": ORIO_WELCOME_TEXT, "read": False, "is_official": True, "created_at": _now(),
    })


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class BanIn(BaseModel):
    type: Literal["account", "device", "both"] = "account"
    hours: Optional[float] = Field(default=None, gt=0, le=24 * 3650)
    permanent: bool = False
    reason: str = Field(min_length=2, max_length=300)
    device_ids: Optional[List[str]] = None


class UnbanIn(BaseModel):
    reason: str = Field(min_length=2, max_length=300)


class LevelSetIn(BaseModel):
    system: Literal["wealth", "charm", "vip"]
    level: int = Field(ge=0, le=51)
    reason: str = Field(min_length=2, max_length=300)
    vip_days: Optional[int] = Field(default=None, ge=1, le=3650)


class WalletAdjustIn(BaseModel):
    currency: Literal["coins", "diamonds"] = "coins"
    delta: int = Field(ge=-100_000_000, le=100_000_000)
    reason: str = Field(min_length=2, max_length=300)


class ProfileEditIn(BaseModel):
    nickname: Optional[str] = Field(default=None, min_length=1, max_length=40)
    bio: Optional[str] = Field(default=None, max_length=300)
    gender: Optional[Literal["male", "female"]] = None
    age: Optional[int] = Field(default=None, ge=13, le=120)
    country_code: Optional[str] = Field(default=None, max_length=3)
    reset_avatar: Optional[bool] = None
    reason: str = Field(min_length=2, max_length=300)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def make_router(current_user_dep, helpers: Dict[str, Any]) -> APIRouter:
    router = APIRouter(prefix="/admin/dashboard", tags=["admin-phase1"])

    def db_():
        from server import app  # noqa: WPS433
        return app.state.db

    def require(perm: Optional[str] = None):
        async def _dep(user=Depends(current_user_dep)):
            db = db_()
            access = await resolve_admin_access(db, user)
            if not access:
                raise HTTPException(403, "Admin access denied")
            if perm and perm not in PERMISSIONS_SET:
                raise HTTPException(500, "Invalid required permission")
            if perm and not access["is_owner"] and perm not in access["permissions"]:
                raise HTTPException(403, f"Missing permission: {perm}")
            return {"user": user, "access": access}
        return _dep

    async def audit(db, actor: dict, action: str, *, target_user_id=None, before=None, after=None, reason=None, extra=None):
        await db.admin_audit.insert_one({
            "admin_id": str(actor["_id"]), "admin_email": _normalise_email(actor.get("email")),
            "action": action, "target_user_id": target_user_id, "before": before, "after": after,
            "note": reason, "extra": extra, "created_at": _now(),
        })

    async def target_or_404(db, user_id: str) -> dict:
        try:
            t = await db.users.find_one({"_id": ObjectId(user_id)})
        except Exception:
            t = None
        if not t:
            raise HTTPException(404, "User not found")
        return t

    async def guard_owner_target(db, t: dict, actor: dict):
        if _normalise_email(t.get("email")) == await get_owner_email(db):
            raise HTTPException(400, "The Owner account cannot be modified")
        if str(t["_id"]) == str(actor["_id"]):
            raise HTTPException(400, "You cannot apply this action to yourself")

    # ------------------------------------------------------------------ detail
    @router.get("/users/{user_id}/detail")
    async def user_detail(user_id: str, ctx=Depends(require("users.view"))):
        db = db_()
        t = await target_or_404(db, user_id)
        uid = str(t["_id"])
        following = set(await db.follows.distinct("followee_id", {"follower_id": uid}))
        followers = set(await db.follows.distinct("follower_id", {"followee_id": uid}))
        providers = [p for p, ok in (
            ("email", bool(t.get("password_hash"))), ("google", bool(t.get("google_sub") or t.get("google_id") or t.get("auth_provider") == "google")),
            ("phone", bool(t.get("phone"))), ("facebook", bool(t.get("facebook_id"))),
        ) if ok]
        ban = t.get("active_ban")
        return {
            "id": uid, "numeric_id": t.get("numeric_id"), "email": t.get("email"), "username": t.get("username"),
            "nickname": t.get("nickname"), "avatar_url": t.get("avatar_url"), "animated_avatar_url": t.get("animated_avatar_url"),
            "bio": t.get("bio"), "age": t.get("age"), "gender": t.get("gender"), "country_code": t.get("country_code"),
            "country_flag": t.get("country_flag"), "created_at": _iso(t.get("created_at")),
            "last_active_at": _iso(t.get("last_active_at")), "providers": providers, "device_ids": t.get("device_ids") or [],
            "coins": int(t.get("coins") or 0), "diamonds": int(t.get("diamonds") or 0),
            "vip_level": int(t.get("vip_level") or 0), "vip_expires_at": _iso(t.get("vip_expires_at")),
            "wealth_level": int(t.get("wealth_level") or 0), "wealth_points": int(t.get("wealth_points") or 0),
            "charm_level": int(t.get("charm_level") or 0), "charm_points": int(t.get("charm_points") or 0),
            "counts": {
                "followers": len(followers), "following": len(following), "friends": len(followers & following),
                "blocked": await db.user_blocks.count_documents({"blocker_id": uid}),
                "blocked_by": await db.user_blocks.count_documents({"blocked_id": uid}),
            },
            "active_ban": ({**ban, "expires_at": _iso(ban.get("expires_at")), "created_at": _iso(ban.get("created_at"))} if ban else None),
            "media_restricted_until": _iso(t.get("media_restricted_until")),
            "is_official": bool(t.get("is_official")),
        }

    @router.get("/users/{user_id}/relations")
    async def user_relations(user_id: str, kind: Literal["followers", "following", "friends", "blocked", "blocked_by"],
                             ctx=Depends(require("users.view"))):
        db = db_()
        await target_or_404(db, user_id)
        rows: List[dict] = []
        if kind == "followers":
            rows = [{"user_id": d["follower_id"], "at": d.get("created_at")} async for d in db.follows.find({"followee_id": user_id}).sort("created_at", -1).limit(500)]
        elif kind == "following":
            rows = [{"user_id": d["followee_id"], "at": d.get("created_at")} async for d in db.follows.find({"follower_id": user_id}).sort("created_at", -1).limit(500)]
        elif kind == "friends":
            fo = {d["followee_id"]: d.get("created_at") async for d in db.follows.find({"follower_id": user_id})}
            async for d in db.follows.find({"followee_id": user_id, "follower_id": {"$in": list(fo)}}):
                a, b = _aware(fo.get(d["follower_id"])), _aware(d.get("created_at"))
                rows.append({"user_id": d["follower_id"], "at": max([x for x in (a, b) if x] or [None]) if (a or b) else None})
        elif kind == "blocked":
            rows = [{"user_id": d["blocked_id"], "at": d.get("created_at")} async for d in db.user_blocks.find({"blocker_id": user_id}).sort("created_at", -1).limit(500)]
        else:
            rows = [{"user_id": d["blocker_id"], "at": d.get("created_at")} async for d in db.user_blocks.find({"blocked_id": user_id}).sort("created_at", -1).limit(500)]
        ids = [ObjectId(r["user_id"]) for r in rows if ObjectId.is_valid(r["user_id"])]
        users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": ids}}, {"nickname": 1, "numeric_id": 1, "avatar_url": 1})}
        return {"items": [{
            "user_id": r["user_id"], "at": _iso(r["at"]),
            "nickname": (users.get(r["user_id"]) or {}).get("nickname"),
            "numeric_id": (users.get(r["user_id"]) or {}).get("numeric_id"),
            "avatar_url": (users.get(r["user_id"]) or {}).get("avatar_url"),
        } for r in rows]}

    @router.get("/users/{user_id}/transactions")
    async def user_txs(user_id: str, limit: int = Query(100, le=500), ctx=Depends(require("wallet.view"))):
        db = db_()
        items = []
        async for x in db.wallet_transactions.find({"user_id": user_id}).sort("created_at", -1).limit(limit):
            items.append({"id": str(x["_id"]), "type": x.get("type"), "currency": x.get("currency", "coins"),
                          "amount": x.get("amount"), "balance_after": x.get("balance_after"), "status": x.get("status"),
                          "description": x.get("description"), "admin_id": x.get("admin_id"), "created_at": _iso(x.get("created_at"))})
        return {"items": items}

    @router.post("/users/{user_id}/wallet")
    async def user_wallet_adjust(user_id: str, body: WalletAdjustIn, ctx=Depends(require("wallet.adjust"))):
        db = db_()
        actor = ctx["user"]
        if body.delta == 0:
            raise HTTPException(400, "Amount cannot be zero")
        t = await target_or_404(db, user_id)
        field = body.currency
        before = int(t.get(field) or 0)
        if before + body.delta < 0:
            raise HTTPException(400, "Balance cannot go below zero")
        # Atomic + guarded: never below zero.
        flt: Dict[str, Any] = {"_id": t["_id"]}
        if body.delta < 0:
            flt[field] = {"$gte": -body.delta}
        res = await db.users.find_one_and_update(flt, {"$inc": {field: body.delta}}, return_document=True)
        if not res:
            raise HTTPException(409, "Balance changed; retry")
        after = int(res.get(field) or 0)
        # Immutable ledger entry (corrections are new entries, never edits).
        await db.wallet_transactions.insert_one({
            "user_id": user_id, "type": "admin_credit" if body.delta > 0 else "admin_debit", "currency": field,
            "amount": body.delta, "balance_after": after, "status": "completed", "description": body.reason,
            "admin_id": str(actor["_id"]), "created_at": _now(), "immutable": True,
        })
        await audit(db, actor, f"wallet.{'credit' if body.delta > 0 else 'debit'}", target_user_id=user_id,
                    before={field: before}, after={field: after}, reason=body.reason)
        return {"ok": True, "currency": field, "before": before, "after": after}

    # ------------------------------------------------------------------ levels
    @router.get("/users/{user_id}/level-history")
    async def level_history(user_id: str, ctx=Depends(require("users.view"))):
        db = db_()
        items = []
        async for h in db.level_history.find({"user_id": user_id}).sort("created_at", -1).limit(300):
            items.append({"system": h.get("system"), "from": h.get("from"), "to": h.get("to"), "source": h.get("source"),
                          "reason": h.get("reason"), "admin_email": h.get("admin_email"), "created_at": _iso(h.get("created_at"))})
        return {"items": items}

    @router.post("/users/{user_id}/levels")
    async def set_level(user_id: str, body: LevelSetIn, ctx=Depends(require("users.levels"))):
        db = db_()
        actor = ctx["user"]
        t = await target_or_404(db, user_id)
        if _normalise_email(t.get("email")) == await get_owner_email(db) and not ctx["access"]["is_owner"]:
            raise HTTPException(403, "Only the Owner can change the Owner account")
        if body.system == "vip":
            if body.level > 10:
                raise HTTPException(400, "VIP level must be 0–10")
            before = int(t.get("vip_level") or 0)
            upd: Dict[str, Any] = {"$set": {"vip_level": body.level}}
            if body.level == 0:
                upd["$unset"] = {"vip_expires_at": ""}
            else:
                base = _aware(t.get("vip_expires_at"))
                base = base if isinstance(base, datetime) and base > _now() else _now()
                upd["$set"]["vip_expires_at"] = base + timedelta(days=body.vip_days or 30)
            await db.users.update_one({"_id": t["_id"]}, upd)
        else:
            cum = await helpers["cumulative"](body.system)  # list, index = level-1
            lf, pf = f"{body.system}_level", f"{body.system}_points"
            before = int(t.get(lf) or 0)
            pts = 0 if body.level == 0 else int(cum[body.level - 1])
            await db.users.update_one({"_id": t["_id"]}, {"$set": {lf: body.level, pf: pts}})
        await db.level_history.insert_one({
            "user_id": user_id, "system": body.system, "from": before, "to": body.level, "source": "admin",
            "reason": body.reason, "admin_email": _normalise_email(actor.get("email")), "created_at": _now(),
        })
        await audit(db, actor, f"levels.{body.system}", target_user_id=user_id,
                    before={"level": before}, after={"level": body.level}, reason=body.reason)
        if body.level > before and body.system != "vip":
            await helpers["notify"](db, user_id, "level_up", {"system": body.system, "level": body.level},
                                    {"type": "level", "id": body.system},
                                    f"Congratulations on reaching {body.system.title()} LV {body.level}")
        return {"ok": True, "system": body.system, "before": before, "after": body.level}

    # ------------------------------------------------------------------ profile
    @router.patch("/users/{user_id}/profile")
    async def edit_profile(user_id: str, body: ProfileEditIn, ctx=Depends(require("users.edit_profile"))):
        db = db_()
        actor = ctx["user"]
        t = await target_or_404(db, user_id)
        if _normalise_email(t.get("email")) == await get_owner_email(db) and not ctx["access"]["is_owner"]:
            raise HTTPException(403, "Only the Owner can change the Owner account")
        fields = body.model_dump(exclude_none=True, exclude={"reason", "reset_avatar"})
        unset = {}
        if body.reset_avatar:
            unset = {"avatar_url": "", "animated_avatar_url": ""}
        if not fields and not unset:
            raise HTTPException(400, "No changes requested")
        before = {k: t.get(k) for k in list(fields) + list(unset)}
        upd: Dict[str, Any] = {}
        if fields:
            upd["$set"] = fields
        if unset:
            upd["$unset"] = unset
        await db.users.update_one({"_id": t["_id"]}, upd)
        await audit(db, actor, "users.edit_profile", target_user_id=user_id, before=before,
                    after={**fields, **({"avatar": "reset"} if unset else {})}, reason=body.reason)
        return {"ok": True}

    # ------------------------------------------------------------------ bans
    @router.post("/users/{user_id}/ban")
    async def ban_user(user_id: str, body: BanIn, ctx=Depends(require("bans.manage"))):
        db = db_()
        actor = ctx["user"]
        t = await target_or_404(db, user_id)
        await guard_owner_target(db, t, actor)
        if not body.permanent and not body.hours:
            raise HTTPException(400, "Choose a duration or permanent")
        devices = body.device_ids if body.device_ids is not None else (t.get("device_ids") or [])
        if body.type in ("device", "both") and not devices:
            raise HTTPException(400, "No known devices for this user yet (device ban needs at least one recorded device)")
        exp = None if body.permanent else _now() + timedelta(hours=float(body.hours))
        await db.bans.update_many({"user_id": user_id, "active": True},
                                  {"$set": {"active": False, "ended_reason": "superseded", "ended_at": _now()}})
        ban = {"user_id": user_id, "type": body.type, "reason": body.reason, "created_at": _now(),
               "expires_at": exp, "device_ids": devices if body.type in ("device", "both") else [],
               "active": True, "created_by": _normalise_email(actor.get("email"))}
        r = await db.bans.insert_one(ban)
        ban.pop("_id", None)
        await db.users.update_one({"_id": t["_id"]}, {"$set": {"active_ban": {**ban, "ban_id": str(r.inserted_id)}, "is_banned": True}})
        # Revoke every active session immediately.
        await db.refresh_sessions.delete_many({"user_id": user_id})
        invalidate_device_ban_cache()
        await audit(db, actor, "bans.create", target_user_id=user_id, before=None,
                    after={"type": body.type, "expires_at": _iso(exp), "permanent": exp is None, "devices": len(ban["device_ids"])},
                    reason=body.reason)
        return {"ok": True, "ban_id": str(r.inserted_id), "expires_at": _iso(exp)}

    @router.post("/users/{user_id}/unban")
    async def unban_user(user_id: str, body: UnbanIn, ctx=Depends(require("bans.manage"))):
        db = db_()
        actor = ctx["user"]
        t = await target_or_404(db, user_id)
        n = await db.bans.update_many({"user_id": user_id, "active": True},
                                      {"$set": {"active": False, "ended_reason": "lifted", "ended_at": _now(),
                                                "lifted_by": _normalise_email(actor.get("email")), "lift_reason": body.reason}})
        await db.users.update_one({"_id": t["_id"]}, {"$unset": {"active_ban": ""}, "$set": {"is_banned": False}})
        invalidate_device_ban_cache()
        await audit(db, actor, "bans.lift", target_user_id=user_id, before={"active_bans": n.modified_count}, after={"active_bans": 0}, reason=body.reason)
        return {"ok": True, "lifted": n.modified_count}

    @router.get("/bans")
    async def list_bans(active: bool = True, limit: int = Query(200, le=500), ctx=Depends(require("bans.view"))):
        db = db_()
        q: Dict[str, Any] = {"active": True} if active else {}
        rows = [b async for b in db.bans.find(q).sort("created_at", -1).limit(limit)]
        ids = [ObjectId(b["user_id"]) for b in rows if ObjectId.is_valid(b.get("user_id", ""))]
        users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": ids}}, {"nickname": 1, "numeric_id": 1})}
        return {"server_now": _now().isoformat(), "items": [{
            "id": str(b["_id"]), "user_id": b["user_id"], "nickname": (users.get(b["user_id"]) or {}).get("nickname"),
            "numeric_id": (users.get(b["user_id"]) or {}).get("numeric_id"), "type": b.get("type"), "reason": b.get("reason"),
            "created_at": _iso(b.get("created_at")), "expires_at": _iso(b.get("expires_at")), "active": b.get("active"),
            "created_by": b.get("created_by"), "ended_reason": b.get("ended_reason"), "devices": len(b.get("device_ids") or []),
        } for b in rows]}

    @router.get("/users/{user_id}/bans")
    async def user_bans(user_id: str, ctx=Depends(require("bans.view"))):
        db = db_()
        return {"items": [{
            "id": str(b["_id"]), "type": b.get("type"), "reason": b.get("reason"), "created_at": _iso(b.get("created_at")),
            "expires_at": _iso(b.get("expires_at")), "active": b.get("active"), "created_by": b.get("created_by"),
            "ended_reason": b.get("ended_reason"), "lifted_by": b.get("lifted_by"),
        } async for b in db.bans.find({"user_id": user_id}).sort("created_at", -1).limit(100)]}

    @router.post("/users/{user_id}/revoke-sessions")
    async def revoke_sessions(user_id: str, ctx=Depends(require("users.sessions"))):
        db = db_()
        t = await target_or_404(db, user_id)
        await guard_owner_target(db, t, ctx["user"])
        n = await db.refresh_sessions.delete_many({"user_id": user_id})
        await audit(db, ctx["user"], "users.revoke_sessions", target_user_id=user_id, after={"revoked": n.deleted_count})
        return {"ok": True, "revoked": n.deleted_count}

    # ------------------------------------------------------------------ audit search
    @router.get("/audit/search")
    async def audit_search(q: Optional[str] = None, action: Optional[str] = None, admin_email: Optional[str] = None,
                           target_user_id: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                           limit: int = Query(100, le=500), skip: int = Query(0, ge=0), ctx=Depends(require("audit.view"))):
        db = db_()
        f: Dict[str, Any] = {}
        if action:
            f["action"] = {"$regex": "^" + re.escape(action)}
        if admin_email:
            f["admin_email"] = _normalise_email(admin_email)
        if target_user_id:
            f["target_user_id"] = target_user_id
        rng: Dict[str, Any] = {}
        for k, v in (("$gte", date_from), ("$lte", date_to)):
            if v:
                try:
                    rng[k] = _aware(datetime.fromisoformat(v.replace("Z", "+00:00")))
                except ValueError:
                    raise HTTPException(400, f"Invalid date: {v}")
        if rng:
            f["created_at"] = rng
        if q:
            rx = {"$regex": re.escape(q), "$options": "i"}
            f["$or"] = [{"note": rx}, {"action": rx}, {"admin_email": rx}, {"target_user_id": rx}]
        total = await db.admin_audit.count_documents(f)
        items = []
        async for a in db.admin_audit.find(f).sort("created_at", -1).skip(skip).limit(limit):
            items.append({"id": str(a["_id"]), "admin_email": a.get("admin_email"), "action": a.get("action") or ("patch" if a.get("patch") else None),
                          "target_user_id": a.get("target_user_id"), "target_room_id": a.get("target_room_id"),
                          "before": a.get("before"), "after": a.get("after") or a.get("patch"), "note": a.get("note"),
                          "created_at": _iso(a.get("created_at"))})
        return {"total": total, "items": items}

    @router.get("/me")
    async def my_access(ctx=Depends(require())):
        a = ctx["access"]
        return {"is_owner": a["is_owner"], "permissions": a["permissions"]}

    return router
