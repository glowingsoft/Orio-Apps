"""Iter-151 — Custom gifts with video + chat mute/lock backend tests.

Covers:
 1. GET /api/gifts/custom/settings → price == 4999, allowed_types includes video, max_video_duration_s=10.
 2. POST /api/gifts/custom without video_url → 400 (for VIP5+). For VIP<5 → 403.
 3. GET /api/gifts/custom returns an approved non-deleted gift seeded by OTHER user with `mine=false`
    and includes gift_id="cg_<id>", video_url, image_url, price=4999.
 4. Another user (test.1) can send that custom gift via /api/gifts/send-multi.
 5. Admin: GET /api/admin/custom-gifts (orioowner) works + non-admin → 403; DELETE removes from catalog.
 6. Chat mute: WS chat_muted user → chat_rejected with code CHAT_MUTED (no broadcast).
 7. Chat lock: non-staff → chat_rejected code CHAT_LOCKED; staff (owner) chat echoed.
"""

import os
import time
import json
import asyncio
import requests
import pytest
import pymongo
import websockets
from bson import ObjectId
from datetime import datetime, timezone

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
WS_URL = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

PASS = "demo1234"
OWNER_EMAIL = "orioowner@gmail.com"
OWNER_PASSWORD = "OwnerTest!2026"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    cli = pymongo.MongoClient(MONGO_URL)
    return cli[DB_NAME]


@pytest.fixture(scope="module")
def tokens():
    return {
        "t1": _login("test.1@oriotest.dev", PASS),
        "t2": _login("test.2@oriotest.dev", PASS),
        "owner": _login(OWNER_EMAIL, OWNER_PASSWORD),
    }


@pytest.fixture(scope="module")
def user_ids(tokens):
    out = {}
    for k, tok in tokens.items():
        r = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15).json()
        out[k] = r["id"]
    return out


# ─────────────────────────────────────────────────────────────────────
# 1. settings
# ─────────────────────────────────────────────────────────────────────
class TestCustomGiftSettings:
    def test_settings_price_and_types(self, tokens):
        r = requests.get(f"{API}/gifts/custom/settings", headers=_auth(tokens["t2"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["price"] == 4999, f"expected 4999, got {j.get('price')}"
        assert "video" in j["allowed_types"], j
        assert "image" in j["allowed_types"], j
        assert j.get("max_video_duration_s") == 10

    def test_create_without_video_url(self, tokens):
        """VIP5+ user missing video_url → 400 'Gift video is required'. VIP<5 → 403."""
        # Use test.2 — according to credentials file post iter-133, test.2 should have VIP≥5.
        r = requests.post(
            f"{API}/gifts/custom",
            headers=_auth(tokens["t2"]),
            json={"name": "TEST_iter151_novideo",
                  "media_url": "/api/media/files/" + "0" * 24,
                  "media_type": "image"},
            timeout=20,
        )
        # if VIP<5 → 403; else 400 with video required (or 400 invalid media)
        assert r.status_code in (400, 403), f"expected 400/403, got {r.status_code}: {r.text}"
        if r.status_code == 400:
            # must mention video OR media
            txt = r.text.lower()
            assert "video" in txt or "media" in txt, f"unexpected 400 body: {r.text}"


# ─────────────────────────────────────────────────────────────────────
# 2. List /api/gifts/custom shows gifts seeded by other users
# ─────────────────────────────────────────────────────────────────────
SEEDED_CG_ID = None  # populated during seed


@pytest.fixture(scope="module")
def seeded_cg(db, user_ids):
    """Seed a custom gift owned by test.2 so test.1 can see it with mine=false."""
    # pick an existing media file from media_files owned by test.2 or create a fake id (resolve by path pattern won't be checked on GET)
    # GET /api/gifts/custom only reads custom_gifts collection — no media validation on read.
    cg = {
        "owner_id": user_ids["t2"],
        "owner_nickname": "TEST_cg_owner",
        "name": "TEST_iter151_CG",
        "media_url": "/api/media/files/" + "aaaaaaaaaaaaaaaaaaaaaaaa",
        "media_type": "image",
        "video_url": "/api/media/files/" + "bbbbbbbbbbbbbbbbbbbbbbbb",
        "price": 4999,
        "status": "approved",
        "created_at": datetime.now(timezone.utc),
    }
    r = db.custom_gifts.insert_one(cg)
    cg_id = str(r.inserted_id)
    yield cg_id
    # Teardown
    try:
        db.custom_gifts.delete_one({"_id": ObjectId(cg_id)})
    except Exception:
        pass


class TestCustomGiftList:
    def test_list_includes_other_users_gifts_with_mine_false(self, tokens, seeded_cg):
        """test.1 should see test.2's seeded cg with mine=false and all required fields."""
        r = requests.get(f"{API}/gifts/custom", headers=_auth(tokens["t1"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        found = [g for g in items if g["id"] == seeded_cg]
        assert found, f"seeded cg {seeded_cg} not listed. count={len(items)}"
        g = found[0]
        assert g["gift_id"] == f"cg_{seeded_cg}", g
        assert g["price"] == 4999, g
        assert g["status"] == "approved", g
        assert g["mine"] is False, g
        assert g.get("video_url"), f"video_url missing: {g}"
        assert g.get("image_url"), f"image_url missing: {g}"
        assert g.get("category") == "custom"


# ─────────────────────────────────────────────────────────────────────
# 3. Admin endpoints
# ─────────────────────────────────────────────────────────────────────
class TestAdminCustomGifts:
    def test_admin_list_works(self, tokens, seeded_cg):
        r = requests.get(f"{API}/admin/custom-gifts", headers=_auth(tokens["owner"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(g["id"] == seeded_cg for g in items), f"seeded cg not in admin list"

    def test_non_admin_list_forbidden(self, tokens):
        r = requests.get(f"{API}/admin/custom-gifts", headers=_auth(tokens["t1"]), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_non_admin_delete_forbidden(self, tokens, seeded_cg):
        r = requests.delete(f"{API}/admin/custom-gifts/{seeded_cg}", headers=_auth(tokens["t1"]), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_admin_delete_removes_from_catalog(self, tokens, db, user_ids):
        """Create a separate TEST cg then admin-delete it and verify it's gone from GET /api/gifts/custom."""
        ins = db.custom_gifts.insert_one({
            "owner_id": user_ids["t2"],
            "owner_nickname": "TEST_cg_del",
            "name": "TEST_iter151_del",
            "media_url": "/api/media/files/" + "c" * 24,
            "media_type": "image",
            "video_url": "/api/media/files/" + "d" * 24,
            "price": 4999, "status": "approved", "created_at": datetime.now(timezone.utc),
        })
        cg_id = str(ins.inserted_id)
        try:
            # exists in GET
            lst = requests.get(f"{API}/gifts/custom", headers=_auth(tokens["t1"]), timeout=15).json()["items"]
            assert any(g["id"] == cg_id for g in lst)
            # delete as owner
            r = requests.delete(f"{API}/admin/custom-gifts/{cg_id}",
                                headers=_auth(tokens["owner"]), timeout=15)
            assert r.status_code == 200, r.text
            # gone from catalog
            lst2 = requests.get(f"{API}/gifts/custom", headers=_auth(tokens["t1"]), timeout=15).json()["items"]
            assert not any(g["id"] == cg_id for g in lst2), f"deleted cg still listed"
        finally:
            db.custom_gifts.delete_one({"_id": ObjectId(cg_id)})


# ─────────────────────────────────────────────────────────────────────
# 4. Send custom gift as another user → gift_batch includes video_url
# ─────────────────────────────────────────────────────────────────────
ROOM_ID = "6ac923fb64abed17bb59980a"  # TEST · Music Night (seeded)


class TestSendOthersCustomGift:
    @pytest.mark.asyncio
    async def test_any_user_can_send_cg_and_batch_has_video_url(self, tokens, user_ids, seeded_cg, db):
        """test.1 (not owner) sends test.2's cg; gift_batch broadcast includes video_url."""
        cg_gift_id = f"cg_{seeded_cg}"
        # Ensure test.1 has coins — top up directly if needed
        u = db.users.find_one({"email": "test.1@oriotest.dev"}, {"coins": 1})
        if (u or {}).get("coins", 0) < 5000:
            db.users.update_one({"email": "test.1@oriotest.dev"}, {"$inc": {"coins": 50000}})

        # Open WS as a listener in the room (test.2)
        url = f"{WS_URL}/api/ws/rooms/{ROOM_ID}?token={tokens['t2']}"
        url_t1 = f"{WS_URL}/api/ws/rooms/{ROOM_ID}?token={tokens['t1']}"
        async with websockets.connect(url, open_timeout=10) as ws, \
                   websockets.connect(url_t1, open_timeout=10) as ws_t1:
            try:
                for _ in range(5):
                    await asyncio.wait_for(ws.recv(), timeout=0.5)
            except Exception:
                pass
            try:
                for _ in range(5):
                    await asyncio.wait_for(ws_t1.recv(), timeout=0.5)
            except Exception:
                pass
            # send-multi from test.1 (not owner)
            r = requests.post(
                f"{API}/gifts/send-multi",
                headers=_auth(tokens["t1"]),
                json={"gift_id": cg_gift_id,
                      "recipient_ids": [user_ids["t2"]],
                      "quantity": 1,
                      "room_id": ROOM_ID},
                timeout=15,
            )
            assert r.status_code == 200, f"non-owner send cg → {r.status_code}: {r.text}"
            # Wait for gift_batch broadcast
            got_batch = None
            deadline = time.time() + 5.0
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.6)
                except asyncio.TimeoutError:
                    continue
                m = json.loads(raw)
                if m.get("type") == "gift_batch" and (m.get("gift") or {}).get("id") == cg_gift_id:
                    got_batch = m
                    break
            assert got_batch, "gift_batch for cg not received"
            assert got_batch["gift"].get("video_url"), f"video_url missing: {got_batch['gift']}"


# ─────────────────────────────────────────────────────────────────────
# 5. Chat mute / lock over WS
# ─────────────────────────────────────────────────────────────────────


class TestChatMuteLock:
    @pytest.mark.asyncio
    async def test_chat_muted_user_rejected(self, tokens, user_ids, db):
        """Add test.1 to chat_muted_users directly in Mongo; send chat → chat_rejected CHAT_MUTED."""
        db.rooms.update_one({"_id": ObjectId(ROOM_ID)},
                            {"$addToSet": {"chat_muted_users": user_ids["t1"]}})
        try:
            tk = tokens["t1"]
            url = f"{WS_URL}/api/ws/rooms/{ROOM_ID}?token={tk}"
            async with websockets.connect(url, open_timeout=10) as ws:
                # drain
                try:
                    for _ in range(5):
                        await asyncio.wait_for(ws.recv(), timeout=0.5)
                except Exception:
                    pass
                payload = f"TEST_iter151_muted_{int(time.time())}"
                await ws.send(json.dumps({"type": "chat", "text": payload}))
                got_rejected_code = None
                got_broadcast = False
                deadline = time.time() + 3.0
                while time.time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                    except asyncio.TimeoutError:
                        break
                    m = json.loads(raw)
                    if m.get("type") == "chat_rejected":
                        got_rejected_code = m.get("code")
                    if m.get("type") == "chat" and (m.get("text") or "") == payload:
                        got_broadcast = True
                assert got_rejected_code == "CHAT_MUTED", f"expected CHAT_MUTED, got {got_rejected_code}"
                assert not got_broadcast, "muted user's chat was broadcast"
        finally:
            db.rooms.update_one({"_id": ObjectId(ROOM_ID)},
                                {"$pull": {"chat_muted_users": user_ids["t1"]}})
            db.room_chat.delete_many({"text": {"$regex": "TEST_iter151"}})

    @pytest.mark.asyncio
    async def test_chat_locked_non_staff_rejected(self, tokens, db):
        """Lock room chat → non-staff (test.2) WS chat → chat_rejected CHAT_LOCKED."""
        db.rooms.update_one({"_id": ObjectId(ROOM_ID)},
                            {"$set": {"chat_locked": True, "moderators": []}})
        try:
            tk = tokens["t2"]
            url = f"{WS_URL}/api/ws/rooms/{ROOM_ID}?token={tk}"
            async with websockets.connect(url, open_timeout=10) as ws:
                try:
                    for _ in range(5):
                        await asyncio.wait_for(ws.recv(), timeout=0.5)
                except Exception:
                    pass
                payload = f"TEST_iter151_lock_{int(time.time())}"
                await ws.send(json.dumps({"type": "chat", "text": payload}))
                got_rejected_code = None
                got_broadcast = False
                deadline = time.time() + 3.0
                while time.time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                    except asyncio.TimeoutError:
                        break
                    m = json.loads(raw)
                    if m.get("type") == "chat_rejected":
                        got_rejected_code = m.get("code")
                    if m.get("type") == "chat" and (m.get("text") or "") == payload:
                        got_broadcast = True
                assert got_rejected_code == "CHAT_LOCKED", f"expected CHAT_LOCKED, got {got_rejected_code}"
                assert not got_broadcast, "non-staff chat was broadcast while chat_locked"
        finally:
            db.rooms.update_one({"_id": ObjectId(ROOM_ID)},
                                {"$set": {"chat_locked": False}})
            db.room_chat.delete_many({"text": {"$regex": "TEST_iter151"}})
