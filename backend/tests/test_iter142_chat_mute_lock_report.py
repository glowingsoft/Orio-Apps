"""Iter-142 — Chat mute / Chat lock / Report-room backend tests.

Covers:
- POST /api/rooms/{id}/chat-mute       (owner/mod add+remove, 400 self/owner,
                                        403 non-priv, 403 mod→mod/owner)
- POST /api/rooms/{id}/chat-lock       (owner/mod ok, 403 non-priv)
- POST /api/rooms/{id}/report          (user_reports row, status 'open',
                                        target_type 'room', room NOT deleted/banned)
- WS /api/ws/rooms/{id}?token=         (muted/non-priv rejected w/ chat_rejected
                                        and no row stored in room_chat)
- public_room exposes chat_locked + chat_muted_users
"""
import asyncio
import json
import os
import time
import uuid

import pymongo
import pytest
import requests
import websockets
from bson import ObjectId

BASE_URL = os.environ.get("EXPO_BACKEND_URL_TEST") or "https://audio-community-9.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "voiceup"


def _login(email: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": "demo1234"},
                      timeout=15)
    r.raise_for_status()
    j = r.json()
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {j['access_token']}"},
                      timeout=15).json()
    return {"token": j["access_token"], "id": me["id"], "nickname": me.get("nickname")}


@pytest.fixture(scope="module")
def users():
    return {
        "owner": _login("test.1@oriotest.dev"),   # owner
        "mod":   _login("test.2@oriotest.dev"),   # moderator
        "mod2":  _login("test.3@oriotest.dev"),   # second moderator (mod→mod test)
        "reg":   _login("test.4@oriotest.dev"),   # regular user
        "stranger": _login("test.5@oriotest.dev"),  # unrelated reporter
    }


@pytest.fixture(scope="module")
def mongo():
    cli = pymongo.MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


@pytest.fixture(scope="module")
def room(users, mongo):
    """Create a fresh (non-test, non-deleted) room owned by test.1.

    Soft-archives test.1's previously-owned rooms by design (see server.create_room).
    After the module runs, we hard-delete this room and restore all archived rooms.
    """
    owner = users["owner"]
    db = mongo
    # Snapshot owner's rooms that are currently alive (should be none per observation).
    pre_alive = list(db.rooms.find({"owner_id": owner["id"], "is_deleted": {"$ne": True}}, {"_id": 1}))

    body = {
        "name": f"TEST_iter142_{uuid.uuid4().hex[:6]}",
        "description": "iter-142 chat-mute/lock/report regression room",
        "num_seats": 8,
        "category": "chat",
    }
    r = requests.post(f"{BASE_URL}/api/rooms",
                      headers={"Authorization": f"Bearer {owner['token']}"},
                      json=body, timeout=20)
    assert r.status_code == 201, (r.status_code, r.text)
    room_id = r.json()["id"]

    # Make test.2 (mod) and test.3 (mod2) approved members, promote both to moderator.
    for u in (users["mod"], users["mod2"], users["reg"]):
        db.room_members.update_one(
            {"user_id": u["id"], "room_id": room_id},
            {"$set": {"user_id": u["id"], "room_id": room_id}},
            upsert=True,
        )
    for u in (users["mod"], users["mod2"]):
        pr = requests.post(f"{BASE_URL}/api/rooms/{room_id}/moderators/add",
                           headers={"Authorization": f"Bearer {owner['token']}"},
                           json={"user_id": u["id"]}, timeout=15)
        assert pr.status_code == 200, (pr.status_code, pr.text)

    yield {"id": room_id, "pre_alive": [str(x["_id"]) for x in pre_alive]}

    # Teardown: remove reports, chat-mute flags, then hard-delete the test room.
    try:
        db.user_reports.delete_many({"reported_room_id": room_id})
        db.room_chat.delete_many({"room_id": room_id})
        db.room_members.delete_many({"room_id": room_id})
        db.rooms.delete_one({"_id": ObjectId(room_id)})
    except Exception:
        pass


# ---------------------- chat-mute permissions ----------------------
class TestChatMutePermissions:
    def test_regular_user_cannot_mute(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['reg']['token']}"},
                          json={"user_id": users["mod"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 403, r.text

    def test_owner_can_mute_regular(self, users, room, mongo):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['owner']['token']}"},
                          json={"user_id": users["reg"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "muted": True}
        doc = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"chat_muted_users": 1})
        assert users["reg"]["id"] in (doc.get("chat_muted_users") or [])

    def test_owner_can_unmute(self, users, room, mongo):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['owner']['token']}"},
                          json={"user_id": users["reg"]["id"], "muted": False}, timeout=15)
        assert r.status_code == 200
        doc = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"chat_muted_users": 1})
        assert users["reg"]["id"] not in (doc.get("chat_muted_users") or [])

    def test_moderator_can_mute_regular(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['mod']['token']}"},
                          json={"user_id": users["reg"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 200
        # cleanup
        requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                      headers={"Authorization": f"Bearer {users['mod']['token']}"},
                      json={"user_id": users["reg"]["id"], "muted": False}, timeout=15)

    def test_moderator_cannot_mute_another_moderator(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['mod']['token']}"},
                          json={"user_id": users["mod2"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 403, r.text

    def test_moderator_cannot_mute_owner(self, users, room):
        # Server returns 400 "Cannot mute this user" (owner protection).
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['mod']['token']}"},
                          json={"user_id": users["owner"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 400, r.text

    def test_owner_cannot_mute_self(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                          headers={"Authorization": f"Bearer {users['owner']['token']}"},
                          json={"user_id": users["owner"]["id"], "muted": True}, timeout=15)
        assert r.status_code == 400


# ---------------------- chat-lock permissions ----------------------
class TestChatLockPermissions:
    def test_regular_user_cannot_lock(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                          headers={"Authorization": f"Bearer {users['reg']['token']}"},
                          json={"locked": True}, timeout=15)
        assert r.status_code == 403

    def test_owner_can_lock_and_unlock(self, users, room, mongo):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                          headers={"Authorization": f"Bearer {users['owner']['token']}"},
                          json={"locked": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["locked"] is True
        doc = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"chat_locked": 1})
        assert doc.get("chat_locked") is True

        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                         headers={"Authorization": f"Bearer {users['owner']['token']}"},
                         json={"locked": False}, timeout=15)
        assert r.status_code == 200
        doc = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"chat_locked": 1})
        assert doc.get("chat_locked") is False

    def test_moderator_can_lock(self, users, room):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                          headers={"Authorization": f"Bearer {users['mod']['token']}"},
                          json={"locked": True}, timeout=15)
        assert r.status_code == 200
        # Cleanup
        requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                      headers={"Authorization": f"Bearer {users['mod']['token']}"},
                      json={"locked": False}, timeout=15)


# ---------------------- public_room exposure ----------------------
class TestPublicRoomFields:
    def test_public_room_exposes_chat_fields(self, users, room):
        r = requests.get(f"{BASE_URL}/api/rooms/{room['id']}",
                         headers={"Authorization": f"Bearer {users['reg']['token']}"},
                         timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "chat_locked" in d and isinstance(d["chat_locked"], bool)
        assert "chat_muted_users" in d and isinstance(d["chat_muted_users"], list)


# ---------------------- report-room ----------------------
class TestReportRoom:
    def test_report_creates_user_reports_row(self, users, room, mongo):
        before = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"is_deleted": 1})
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/report",
                          headers={"Authorization": f"Bearer {users['stranger']['token']}"},
                          json={"reason": "insult", "details": "TEST_iter142 reporting room"},
                          timeout=15)
        assert r.status_code == 201, r.text
        rep_id = r.json().get("id")
        assert rep_id

        doc = mongo.user_reports.find_one({"_id": ObjectId(rep_id)})
        assert doc is not None
        assert doc.get("target_type") == "room"
        assert doc.get("status") == "open"
        assert doc.get("reported_room_id") == room["id"]
        assert doc.get("reason") == "insult"
        assert doc.get("reporter_id") == users["stranger"]["id"]

        # Room must NOT be auto-banned / deleted.
        after = mongo.rooms.find_one({"_id": ObjectId(room["id"])}, {"is_deleted": 1, "banned": 1})
        assert bool(after.get("is_deleted")) == bool(before.get("is_deleted"))
        assert not after.get("banned")

    def test_invalid_reason_coerced_to_other(self, users, room, mongo):
        r = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/report",
                          headers={"Authorization": f"Bearer {users['stranger']['token']}"},
                          json={"reason": "zzz_bogus_reason", "details": "TEST_iter142"}, timeout=15)
        assert r.status_code == 201
        doc = mongo.user_reports.find_one({"_id": ObjectId(r.json()["id"])})
        assert doc["reason"] == "other"


# ---------------------- WebSocket chat enforcement ----------------------
async def _ws_consume_for(ws, seconds: float):
    """Drain messages for `seconds` and return the list received."""
    out = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.monotonic()))
            try:
                out.append(json.loads(msg))
            except Exception:
                pass
        except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            break
    return out


class TestWebSocketEnforcement:
    @pytest.mark.asyncio
    async def test_muted_user_cannot_send_chat(self, users, room, mongo):
        # Mute test.4 (regular) via API as owner.
        rr = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                           headers={"Authorization": f"Bearer {users['owner']['token']}"},
                           json={"user_id": users["reg"]["id"], "muted": True}, timeout=15)
        assert rr.status_code == 200

        marker = f"TEST_iter142_muted_{uuid.uuid4().hex[:6]}"
        url = f"{WS_BASE}/api/ws/rooms/{room['id']}?token={users['reg']['token']}"
        async with websockets.connect(url) as ws:
            # Drain initial presence/join events
            await _ws_consume_for(ws, 0.4)
            await ws.send(json.dumps({"type": "chat", "text": marker}))
            msgs = await _ws_consume_for(ws, 1.5)

        rejected = [m for m in msgs if m.get("type") == "chat_rejected"]
        assert rejected, f"expected chat_rejected, got {msgs}"
        assert rejected[0].get("code") == "CHAT_MUTED"

        # Nothing stored in room_chat for this marker.
        stored = mongo.room_chat.find_one({"room_id": room["id"], "text": marker})
        assert stored is None

        # Cleanup — unmute.
        requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-mute",
                      headers={"Authorization": f"Bearer {users['owner']['token']}"},
                      json={"user_id": users["reg"]["id"], "muted": False}, timeout=15)

    @pytest.mark.asyncio
    async def test_non_priv_blocked_when_chat_locked(self, users, room, mongo):
        # Lock chat as owner
        rr = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                           headers={"Authorization": f"Bearer {users['owner']['token']}"},
                           json={"locked": True}, timeout=15)
        assert rr.status_code == 200

        marker = f"TEST_iter142_locked_{uuid.uuid4().hex[:6]}"
        url = f"{WS_BASE}/api/ws/rooms/{room['id']}?token={users['reg']['token']}"
        async with websockets.connect(url) as ws:
            await _ws_consume_for(ws, 0.4)
            await ws.send(json.dumps({"type": "chat", "text": marker}))
            msgs = await _ws_consume_for(ws, 1.5)
        rejected = [m for m in msgs if m.get("type") == "chat_rejected"]
        assert rejected, f"expected chat_rejected, got {msgs}"
        assert rejected[0].get("code") == "CHAT_LOCKED"

        stored = mongo.room_chat.find_one({"room_id": room["id"], "text": marker})
        assert stored is None

        # Cleanup — unlock
        requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                      headers={"Authorization": f"Bearer {users['owner']['token']}"},
                      json={"locked": False}, timeout=15)

    @pytest.mark.asyncio
    async def test_moderator_can_chat_when_locked(self, users, room, mongo):
        rr = requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                           headers={"Authorization": f"Bearer {users['owner']['token']}"},
                           json={"locked": True}, timeout=15)
        assert rr.status_code == 200

        marker = f"TEST_iter142_modok_{uuid.uuid4().hex[:6]}"
        url = f"{WS_BASE}/api/ws/rooms/{room['id']}?token={users['mod']['token']}"
        async with websockets.connect(url) as ws:
            await _ws_consume_for(ws, 0.4)
            await ws.send(json.dumps({"type": "chat", "text": marker}))
            msgs = await _ws_consume_for(ws, 1.5)
        rejected = [m for m in msgs if m.get("type") == "chat_rejected"]
        assert not rejected, f"moderator unexpectedly rejected: {rejected}"
        # Message is stored (allow a brief write delay)
        stored = None
        for _ in range(10):
            stored = mongo.room_chat.find_one({"room_id": room["id"], "text": marker})
            if stored:
                break
            await asyncio.sleep(0.1)
        assert stored is not None, "mod chat not stored while locked"

        # Cleanup
        mongo.room_chat.delete_one({"_id": stored["_id"]})
        requests.post(f"{BASE_URL}/api/rooms/{room['id']}/chat-lock",
                      headers={"Authorization": f"Bearer {users['owner']['token']}"},
                      json={"locked": False}, timeout=15)
