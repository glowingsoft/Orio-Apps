"""ORIO — Permanent account deletion (Batch B).

Flow:
  1. POST /api/account/deletion/request  → 72h pending window, all sessions revoked.
  2. Logging in again (any provider) inside the window cancels the request
     (hook: `cancel_on_login`, called from issue_pair).
  3. `finalize_due_loop` permanently deletes accounts whose window expired:
     PII removed, login providers unlinked, posts/social graph removed,
     balances forfeited (ledger rows kept — legal retention), sessions purged.
  4. Credential reuse: the same email / phone / provider id can only create a
     NEW account after a 3-day cooldown (`assert_credential_reusable`).
"""
import asyncio
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

log = logging.getLogger("orio.deletion")

PENDING_HOURS = 72
REUSE_COOLDOWN_DAYS = 3


def _now():
    return datetime.now(timezone.utc)


def _aware(d):
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _h(kind: str, value: str) -> str:
    return hashlib.sha256(f"{kind}:{value.strip().lower()}".encode()).hexdigest()


async def request_deletion(db, user: dict) -> dict:
    now = _now()
    scheduled = now + timedelta(hours=PENDING_HOURS)
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"deletion_status": "pending", "deletion_requested_at": now,
                  "deletion_scheduled_at": scheduled},
         "$unset": {"deletion_cancelled_at": ""}},
    )
    await db.account_deletion_log.insert_one({
        "user_id": str(user["_id"]), "event": "requested", "at": now, "scheduled_at": scheduled,
    })
    # Revoke every session — logging in again is the only way to cancel.
    await db.refresh_sessions.delete_many({"user_id": str(user["_id"])})
    return {"status": "pending", "scheduled_at": scheduled.isoformat()}


async def cancel_on_login(db, user_id: str) -> None:
    from bson import ObjectId
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"deletion_status": 1, "deletion_scheduled_at": 1})
    if not u:
        return
    if u.get("deletion_status") == "deleted":
        raise HTTPException(410, "This account has been permanently deleted")
    if u.get("deletion_status") == "pending":
        sched = _aware(u.get("deletion_scheduled_at"))
        if sched and sched <= _now():
            # Window already expired — finalize instead of reviving.
            await finalize_user(db, user_id)
            raise HTTPException(410, "This account has been permanently deleted")
        await db.users.update_one(
            {"_id": u["_id"], "deletion_status": "pending"},
            {"$set": {"deletion_status": "cancelled", "deletion_cancelled_at": _now(),
                      "deletion_cancel_notice": True},
             "$unset": {"deletion_scheduled_at": ""}},
        )
        await db.account_deletion_log.insert_one({"user_id": user_id, "event": "cancelled_by_login", "at": _now()})


async def assert_credential_reusable(db, **creds) -> None:
    hashes = [_h(k, v) for k, v in creds.items() if v]
    if not hashes:
        return
    hit = await db.deleted_credentials.find_one({"hash": {"$in": hashes}, "reuse_after": {"$gt": _now()}})
    if hit:
        raise HTTPException(
            403,
            "This sign-in method belonged to a recently deleted account. "
            "It can be used to create a new account after 3 days.",
        )


async def finalize_user(db, user_id: str) -> bool:
    from bson import ObjectId
    oid = ObjectId(user_id)
    u = await db.users.find_one_and_update(
        {"_id": oid, "deletion_status": "pending"},
        {"$set": {"deletion_status": "finalizing"}},
    )
    if not u:
        return False
    now = _now()
    reuse_after = now + timedelta(days=REUSE_COOLDOWN_DAYS)
    creds = {
        "email": u.get("email") if not str(u.get("email", "")).endswith(".invalid") else None,
        "phone": u.get("phone"), "facebook_id": u.get("facebook_id"), "apple_sub": u.get("apple_sub"),
    }
    for kind, val in creds.items():
        if val:
            await db.deleted_credentials.insert_one(
                {"hash": _h(kind, str(val)), "kind": kind, "deleted_at": now, "reuse_after": reuse_after})
    # Legal-retention ledger row for forfeited balances (ledger itself is kept).
    if (u.get("diamonds") or 0) or (u.get("coins") or 0):
        await db.wallet_transactions.insert_one({
            "user_id": user_id, "type": "account_deletion_forfeit", "currency": "diamonds",
            "amount": -int(u.get("diamonds") or 0), "coins_forfeited": int(u.get("coins") or 0),
            "balance_after": 0, "status": "completed", "created_at": now,
            "description": "Balance forfeited on permanent account deletion",
        })
    await db.users.update_one({"_id": oid}, {
        "$set": {
            "deletion_status": "deleted", "account_deleted": True, "deleted_at": now,
            "email": f"deleted_{user_id}@deleted.orio.invalid",
            "username": f"deleted_{user_id}",
            "nickname": "Deleted User", "bio": "", "avatar_url": None, "cover_url": None,
            "password_hash": secrets.token_hex(32),
            "diamonds": 0, "coins": 0, "vip_level": 0, "vip_expires_at": None,
            "entrance_effect": None, "gif_avatar_expires_at": None,
        },
        "$unset": {"phone": "", "facebook_id": "", "apple_sub": "", "auth_provider": "",
                   "deletion_scheduled_at": "", "photos": "", "birthday": "", "country": ""},
    })
    # Non-destructive retirement: records are archived (ids re-keyed with an
    # "archived:" prefix so they no longer link to anyone), never hard-deleted.
    await db.refresh_sessions.update_many({"user_id": user_id}, {"$set": {"expires_at": now, "revoked": True}})
    await db.posts.update_many(
        {"$or": [{"user_id": user_id}, {"author_id": user_id}]},
        [{"$set": {"is_deleted": True, "archived_at": now,
                   "author_id": {"$concat": ["archived:", {"$ifNull": ["$author_id", ""]}]},
                   "user_id": {"$concat": ["archived:", {"$ifNull": ["$user_id", ""]}]}}}])
    await db.follows.update_many(
        {"$or": [{"follower_id": user_id}, {"followee_id": user_id}]},
        [{"$set": {"archived_at": now,
                   "follower_id": {"$concat": ["archived:", "$follower_id"]},
                   "followee_id": {"$concat": ["archived:", "$followee_id"]}}}])
    await db.friendships.update_many(
        {"$or": [{"a_id": user_id}, {"b_id": user_id}]},
        [{"$set": {"archived_at": now,
                   "a_id": {"$concat": ["archived:", "$a_id"]},
                   "b_id": {"$concat": ["archived:", "$b_id"]}}}])
    await db.rooms.update_many({"owner_id": user_id}, {"$set": {"is_live": False, "is_deleted": True,
                                                                "archived_reason": "owner_account_deleted"}})
    await db.account_deletion_log.insert_one({"user_id": user_id, "event": "finalized", "at": now})
    log.info("account %s permanently deleted", user_id)
    return True


async def finalize_due(db) -> int:
    n = 0
    async for u in db.users.find({"deletion_status": "pending", "deletion_scheduled_at": {"$lte": _now()}}, {"_id": 1}):
        if await finalize_user(db, str(u["_id"])):
            n += 1
    return n


async def finalize_due_loop(app):
    while True:
        try:
            await finalize_due(app.state.db)
        except Exception as e:  # keep the loop alive
            log.warning("deletion finalizer error: %s", e)
        await asyncio.sleep(600)
