"""
Iter-145 Batch B — Phase 3 Animated Emoji Reactions.

Validates:
  (A) Room WS /api/ws/rooms/{id}:
       - Seated sender → broadcast {type:'reaction', seat_index=<their seat>}
       - Non-seated sender → broadcast seat_index=null
       - Within 2.5s cooldown → sender receives {type:'reaction_rejected', code:'COOLDOWN'};
         no broadcast to others
       - Invalid emoji key → silently ignored (no broadcast, no rejection)

  (B) Private chat POST /api/messages/reaction:
       - 200 → GET /api/messages/with/{peer} shows kind='emoji' with emoji code
         for BOTH users (sender + recipient)
       - Immediate second (within 2.5s) → 429 "Slow down"
       - Unknown key → 400 "Unknown reaction"
       - Blocked recipient → 403
"""
import os
import json
import asyncio
import time
import secrets
import pytest
import requests
import websockets
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

TEST_PWD = "demo1234"
ROOM_ID = "6ac923fb64abed17bb59980a"


# ---------- helpers ----------
def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": TEST_PWD}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.text}"
    sess = r.json()
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {sess['access_token']}"},
                      timeout=15)
    assert me.status_code == 200, me.text
    sess["user"] = me.json()
    return sess


def _h(sess):
    return {"Authorization": f"Bearer {sess['access_token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mdb():
    cli = MongoClient(MONGO_URL)
    return cli[DB_NAME]


@pytest.fixture(scope="module")
def tokens():
    return {
        "t1": _login("test.1@oriotest.dev"),   # non-seated sender
        "t2": _login("test.2@oriotest.dev"),   # dm recipient
        "t5": _login("test.5@oriotest.dev"),   # seated sender (seat 1)
    }


@pytest.fixture(scope="module", autouse=True)
def seat_test5(mdb, tokens):
    """Seat test.5 at seat index 1 on the shared test room, cleanup after."""
    rid = ObjectId(ROOM_ID)
    u5 = tokens["t5"]["user"]
    seat_user = {
        "id": u5["id"],
        "nickname": u5.get("nickname") or u5.get("username"),
        "avatar_url": u5.get("avatar_url"),
    }
    # Snapshot original seat 1 for cleanup
    doc = mdb.rooms.find_one({"_id": rid}, {"seats": 1})
    original_seat1 = None
    for s in (doc or {}).get("seats") or []:
        if s.get("index") == 1:
            original_seat1 = (s or {}).get("user")
            break
    # Also remove t5 from any other seat and clear
    mdb.rooms.update_one(
        {"_id": rid},
        {"$set": {"seats.$[s].user": None, "seats.$[s].muted": False}},
        array_filters=[{"s.user.id": u5["id"]}],
    )
    # Put t5 on seat 1
    mdb.rooms.update_one(
        {"_id": rid, "seats.index": 1},
        {"$set": {"seats.$.user": seat_user, "seats.$.muted": False}},
    )
    yield
    # Cleanup — restore seat 1 to its prior state
    mdb.rooms.update_one(
        {"_id": rid, "seats.index": 1},
        {"$set": {"seats.$.user": original_seat1, "seats.$.muted": False}},
    )


async def _open_room_ws(sess, room_id=ROOM_ID):
    """POST /join then open the room WS, drain initial frames."""
    requests.post(f"{BASE_URL}/api/rooms/{room_id}/join",
                  headers=_h(sess), timeout=15)
    url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={sess['access_token']}"
    ws = await websockets.connect(url, close_timeout=5, max_size=16 * 1024 * 1024)
    try:
        for _ in range(20):
            await asyncio.wait_for(ws.recv(), timeout=0.5)
    except asyncio.TimeoutError:
        pass
    await asyncio.sleep(0.6)
    return ws


async def _drain(ws, duration=1.5):
    out = []
    deadline = time.time() + duration
    while time.time() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.3)
        except asyncio.TimeoutError:
            continue
        except Exception:
            break
        try:
            out.append(json.loads(raw))
        except Exception:
            pass
    return out


# ============================================================
# (A) Room WS reactions
# ============================================================
class TestRoomReactionWS:
    @pytest.mark.asyncio
    async def test_seated_user_broadcasts_seat_index(self, tokens):
        """test.5 is seated at seat 1 → broadcast carries seat_index=1."""
        t5 = tokens["t5"]
        t1 = tokens["t1"]
        # Cooldown spacing from any previous test runs
        await asyncio.sleep(3.0)
        sender_ws = await _open_room_ws(t5)
        viewer_ws = await _open_room_ws(t1)
        try:
            await sender_ws.send(json.dumps({"type": "reaction", "emoji": "1f60d"}))
            # Give server a beat
            frames = await _drain(viewer_ws, duration=1.5)
        finally:
            await sender_ws.close()
            await viewer_ws.close()
        reactions = [f for f in frames if f.get("type") == "reaction"]
        assert reactions, f"no reaction frames; got types={[f.get('type') for f in frames]}"
        react = reactions[-1]
        assert react.get("seat_index") == 1, f"expected seat_index=1, got {react}"
        assert react.get("emoji") == "1f60d"
        assert (react.get("user") or {}).get("id") == tokens["t5"]["user"]["id"]

    @pytest.mark.asyncio
    async def test_nonseated_user_seat_index_null(self, tokens):
        """test.1 is NOT seated → broadcast carries seat_index=null."""
        t1 = tokens["t1"]
        t5 = tokens["t5"]
        await asyncio.sleep(3.0)
        sender_ws = await _open_room_ws(t1)
        viewer_ws = await _open_room_ws(t5)
        try:
            await sender_ws.send(json.dumps({"type": "reaction", "emoji": "1f389"}))
            frames = await _drain(viewer_ws, duration=1.5)
        finally:
            await sender_ws.close()
            await viewer_ws.close()
        reactions = [f for f in frames if f.get("type") == "reaction"]
        assert reactions, f"no reaction frames; got types={[f.get('type') for f in frames]}"
        react = reactions[-1]
        assert react.get("seat_index") is None, f"expected seat_index=None, got {react}"
        assert react.get("emoji") == "1f389"

    @pytest.mark.asyncio
    async def test_cooldown_rejects_second_within_2_5s(self, tokens):
        """Second reaction within 2.5s → reaction_rejected COOLDOWN to sender; no broadcast."""
        t1 = tokens["t1"]
        t5 = tokens["t5"]
        await asyncio.sleep(3.0)
        sender_ws = await _open_room_ws(t1)
        viewer_ws = await _open_room_ws(t5)
        try:
            await sender_ws.send(json.dumps({"type": "reaction", "emoji": "1f44d"}))
            await asyncio.sleep(0.3)
            # Drain the first broadcast so viewer buffer is clean
            await _drain(viewer_ws, duration=0.6)
            await _drain(sender_ws, duration=0.3)
            # Second immediately
            await sender_ws.send(json.dumps({"type": "reaction", "emoji": "1f602"}))
            sender_frames = await _drain(sender_ws, duration=1.2)
            viewer_frames = await _drain(viewer_ws, duration=1.0)
        finally:
            await sender_ws.close()
            await viewer_ws.close()
        rejects = [f for f in sender_frames if f.get("type") == "reaction_rejected"]
        assert rejects, f"expected reaction_rejected frame; got {sender_frames}"
        assert rejects[-1].get("code") == "COOLDOWN"
        # Viewer should see NO new reaction for 1f602
        new_broadcasts = [f for f in viewer_frames
                          if f.get("type") == "reaction" and f.get("emoji") == "1f602"]
        assert not new_broadcasts, f"second reaction leaked to viewer: {new_broadcasts}"

    @pytest.mark.asyncio
    async def test_invalid_key_ignored(self, tokens):
        """Invalid emoji key → silently ignored. No broadcast; no rejection frame."""
        t1 = tokens["t1"]
        t5 = tokens["t5"]
        await asyncio.sleep(3.0)
        sender_ws = await _open_room_ws(t1)
        viewer_ws = await _open_room_ws(t5)
        try:
            await sender_ws.send(json.dumps({"type": "reaction", "emoji": "deadbeef"}))
            sender_frames = await _drain(sender_ws, duration=1.0)
            viewer_frames = await _drain(viewer_ws, duration=1.0)
        finally:
            await sender_ws.close()
            await viewer_ws.close()
        # No reaction/reject frames of this emoji
        assert not any(f.get("type") == "reaction" and f.get("emoji") == "deadbeef"
                       for f in viewer_frames), "invalid key leaked as broadcast"
        assert not any(f.get("type") == "reaction_rejected" for f in sender_frames), \
            "invalid key must be silently ignored (not rejected)"


# ============================================================
# (B) DM POST /api/messages/reaction
# ============================================================
class TestDmReaction:
    def test_dm_200_and_history_both_sides(self, tokens):
        """Sender posts → both users see kind='emoji' msg with emoji code via /messages/with."""
        t1 = tokens["t1"]
        t2 = tokens["t2"]
        # Ensure unblocked
        requests.delete(f"{BASE_URL}/api/users/{t2['user']['id']}/block",
                        headers=_h(t1), timeout=15)
        requests.delete(f"{BASE_URL}/api/users/{t1['user']['id']}/block",
                        headers=_h(t2), timeout=15)
        # Space from any previous DM reactions
        time.sleep(3.0)
        emoji = "1f970"
        r = requests.post(f"{BASE_URL}/api/messages/reaction",
                          headers=_h(t1),
                          json={"recipient_id": t2["user"]["id"], "emoji": emoji},
                          timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("kind") == "emoji"
        assert body.get("emoji") == emoji

        def _items(resp):
            j = resp.json()
            if isinstance(j, dict):
                return j.get("items") or j.get("messages") or []
            return j if isinstance(j, list) else []

        # Sender history
        s_hist = requests.get(f"{BASE_URL}/api/messages/with/{t2['user']['id']}",
                              headers=_h(t1), timeout=15)
        assert s_hist.status_code == 200
        s_items = _items(s_hist)
        found_s = [m for m in s_items if m.get("kind") == "emoji" and m.get("emoji") == emoji]
        assert found_s, f"sender history missing emoji msg; last={s_items[-3:] if s_items else []}"

        # Recipient history
        r_hist = requests.get(f"{BASE_URL}/api/messages/with/{t1['user']['id']}",
                              headers=_h(t2), timeout=15)
        assert r_hist.status_code == 200
        r_items = _items(r_hist)
        found_r = [m for m in r_items if m.get("kind") == "emoji" and m.get("emoji") == emoji]
        assert found_r, f"recipient history missing emoji msg; last={r_items[-3:] if r_items else []}"

    def test_dm_cooldown_429(self, tokens):
        """Second DM reaction within 2.5s → 429."""
        t1 = tokens["t1"]
        t2 = tokens["t2"]
        time.sleep(3.0)
        r1 = requests.post(f"{BASE_URL}/api/messages/reaction",
                           headers=_h(t1),
                           json={"recipient_id": t2["user"]["id"], "emoji": "1f618"},
                           timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{BASE_URL}/api/messages/reaction",
                           headers=_h(t1),
                           json={"recipient_id": t2["user"]["id"], "emoji": "1f618"},
                           timeout=15)
        assert r2.status_code == 429, f"expected 429, got {r2.status_code}: {r2.text}"

    def test_dm_unknown_key_400(self, tokens):
        t1 = tokens["t1"]
        t2 = tokens["t2"]
        time.sleep(3.0)
        r = requests.post(f"{BASE_URL}/api/messages/reaction",
                          headers=_h(t1),
                          json={"recipient_id": t2["user"]["id"], "emoji": "notakey"},
                          timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_dm_blocked_403(self, tokens):
        """Blocked user cannot react in DM → 403."""
        t1 = tokens["t1"]
        t2 = tokens["t2"]
        # Have t2 block t1
        time.sleep(3.0)
        br = requests.post(f"{BASE_URL}/api/users/{t1['user']['id']}/block",
                           headers=_h(t2), timeout=15)
        assert br.status_code in (201, 200), br.text
        try:
            r = requests.post(f"{BASE_URL}/api/messages/reaction",
                              headers=_h(t1),
                              json={"recipient_id": t2["user"]["id"], "emoji": "1f44d"},
                              timeout=15)
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        finally:
            requests.delete(f"{BASE_URL}/api/users/{t1['user']['id']}/block",
                            headers=_h(t2), timeout=15)
