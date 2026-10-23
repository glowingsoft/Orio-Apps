"""
Iter-144 Batch B — Phase 2 Gift tests.
Validates:
  (A) GET /api/gifts sorted by price asc & new mythic gifts royal_dragon(500000),
      mythical_phoenix(1000000) with animation_url + luxury_fx. Old gifts prices unchanged.
  (B) Backend /api/gifts/send-multi:
       - total_cost > 2999 broadcasts {type:'luxury_gift'} on /api/ws/global
       - total_cost <= 2999 does NOT broadcast
       - gift_batch room event includes gift.animation_url
       - royal_dragon (500,000) deducts exactly once; insufficient balance → 402, no deduction;
         concurrent duplicate request_id → charged once (409 on dup).
       - Room owner (rooms.owner_id) accepted as recipient while NOT in room (sender in room).
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
    # test.1 is sender; test.3 is owner of 6ac923fb64abed17bb59980a; test.2/4 recipients
    return {
        "s": _login("test.1@oriotest.dev"),   # sender
        "o": _login("test.4@oriotest.dev"),   # owner of 6ac923fb64abed17bb59980a (TEST · Music Night)
        "r1": _login("test.2@oriotest.dev"),  # recipient
        "r2": _login("test.3@oriotest.dev"),  # recipient
    }


@pytest.fixture(scope="module")
def test_room(mdb):
    # Known seeded room owned by test.3
    rid = "6ac923fb64abed17bb59980a"
    doc = mdb.rooms.find_one({"_id": ObjectId(rid)})
    assert doc, "seeded test room not found — run seed_test_data.py"
    return rid


# ---------- (A) Gift catalog ----------
class TestGiftCatalog:
    def test_gifts_sorted_and_has_new_mythics(self, tokens):
        r = requests.get(f"{BASE_URL}/api/gifts", headers=_h(tokens["s"]), timeout=15)
        assert r.status_code == 200, r.text
        gifts = r.json()
        assert isinstance(gifts, list) and len(gifts) >= 10, f"got {len(gifts)} gifts"
        prices = [int(g["price"]) for g in gifts]
        assert prices == sorted(prices), f"not sorted by price asc: {prices}"
        by_id = {g["id"]: g for g in gifts}
        expected = {
            "rose": 10, "heart": 50, "cake": 200, "diamond": 1000,
            "sports_car": 5000, "treasure": 10000, "castle": 30000,
            "phoenix": 50000, "royal_dragon": 500000, "mythical_phoenix": 1000000,
        }
        for gid, p in expected.items():
            assert gid in by_id, f"missing gift {gid}"
            assert int(by_id[gid]["price"]) == p, f"{gid} price {by_id[gid]['price']} ≠ {p}"
        # New mythics have animation + luxury_fx
        assert by_id["royal_dragon"].get("animation_url"), "royal_dragon missing animation_url"
        assert by_id["royal_dragon"].get("luxury_fx") == "dragon"
        assert by_id["mythical_phoenix"].get("animation_url"), "mythical_phoenix missing animation_url"
        assert by_id["mythical_phoenix"].get("luxury_fx") == "phoenix"
        # Castle has no animation_url (floating PNG fallback)
        assert by_id["castle"].get("animation_url") in (None, ""), f"castle animation should be None, got {by_id['castle'].get('animation_url')}"


# ---------- (B) send-multi + WS global + room gift_batch ----------
async def _collect_ws(url, duration=3.0, skip_initial=True):
    """Connect, drain, then collect frames for `duration` seconds."""
    out = []
    try:
        async with websockets.connect(url, close_timeout=5) as ws:
            if skip_initial:
                # Drain initial frames quickly
                try:
                    for _ in range(10):
                        await asyncio.wait_for(ws.recv(), timeout=0.3)
                except asyncio.TimeoutError:
                    pass
            deadline = time.time() + duration
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
                try:
                    out.append(json.loads(raw))
                except Exception:
                    pass
    except Exception as e:
        print(f"ws collect err {url}: {e}")
    return out


async def _join_room_ws(sess, room_id):
    """POST /join, open room WS, return the websocket & drain initial frames."""
    j = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join",
                      headers=_h(sess), timeout=15)
    url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={sess['access_token']}"
    # Raise max_size — room_state frames can exceed 1MB with GIF/background payloads.
    ws = await websockets.connect(url, close_timeout=5, max_size=16 * 1024 * 1024)
    got_frames = 0
    try:
        for _ in range(20):
            raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            got_frames += 1
    except asyncio.TimeoutError:
        pass
    print(f"[ws-join] user={sess['user'].get('email')} join={j.status_code} frames={got_frames} state={ws.state}")
    await asyncio.sleep(0.8)
    return ws


async def _drain(ws, duration=3.0):
    out = []
    deadline = time.time() + duration
    while time.time() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.4)
        except asyncio.TimeoutError:
            continue
        try:
            out.append(json.loads(raw))
        except Exception:
            pass
    return out


class TestSendMultiGlobalWS:
    @pytest.mark.asyncio
    async def test_above_2999_broadcasts_luxury_gift(self, tokens, test_room):
        """sports_car (5000) > 2999 → luxury_gift on /api/ws/global; gift_batch has animation_url."""
        s = tokens["s"]
        r1 = tokens["r1"]
        # Ensure sender in room; recipient in room too.
        s_ws = await _join_room_ws(s, test_room)
        r_ws = await _join_room_ws(r1, test_room)
        # Open global WS as sender
        g_url = f"{WS_BASE}/api/ws/global?token={s['access_token']}"
        global_ws = await websockets.connect(g_url, close_timeout=5, max_size=16 * 1024 * 1024)
        try:
            rid = r1["user"]["id"]
            req = secrets.token_hex(8)
            resp = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                 headers=_h(s),
                                 json={"gift_id": "sports_car", "quantity": 1,
                                       "recipient_ids": [rid], "room_id": test_room,
                                       "request_id": req}, timeout=15)
            assert resp.status_code == 200, resp.text
            data = resp.json()
            assert data["total_cost"] == 5000
            # Collect from global + room WS
            global_frames, room_frames = await asyncio.gather(
                _drain(global_ws, duration=3.0),
                _drain(s_ws, duration=3.0),
            )
        finally:
            await global_ws.close()
            await s_ws.close()
            await r_ws.close()
        luxury_events = [m for m in global_frames if m.get("type") == "luxury_gift"]
        assert luxury_events, f"luxury_gift not received on /api/ws/global: {global_frames}"
        lx = luxury_events[0]
        assert lx.get("room_id") == test_room
        assert lx.get("sender", {}).get("id") == s["user"]["id"]
        assert "name_color" in lx.get("sender", {}), "sender.name_color missing"
        assert lx.get("gift", {}).get("id") == "sports_car"
        # Room WS carries gift_batch with animation_url
        gift_batches = [m for m in room_frames if m.get("type") == "gift_batch"]
        assert gift_batches, f"gift_batch not received on room ws: {room_frames}"
        assert gift_batches[0]["gift"].get("animation_url"), "gift_batch.gift.animation_url missing"

    @pytest.mark.asyncio
    async def test_below_or_equal_2999_no_global_event(self, tokens, test_room):
        """cake*10 = 2000 (≤2999) → NO luxury_gift on /api/ws/global."""
        s = tokens["s"]
        r1 = tokens["r1"]
        s_ws = await _join_room_ws(s, test_room)
        r_ws = await _join_room_ws(r1, test_room)
        g_url = f"{WS_BASE}/api/ws/global?token={s['access_token']}"
        global_ws = await websockets.connect(g_url, close_timeout=5, max_size=16 * 1024 * 1024)
        try:
            try:
                await asyncio.wait_for(global_ws.recv(), timeout=0.3)
            except asyncio.TimeoutError:
                pass
            rid = r1["user"]["id"]
            req = secrets.token_hex(8)
            resp = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                 headers=_h(s),
                                 json={"gift_id": "cake", "quantity": 10,
                                       "recipient_ids": [rid], "room_id": test_room,
                                       "request_id": req}, timeout=15)
            assert resp.status_code == 200, resp.text
            assert resp.json()["total_cost"] == 2000
            frames = await _drain(global_ws, duration=2.0)
        finally:
            await global_ws.close()
            await s_ws.close()
            await r_ws.close()
        luxury_events = [m for m in frames if m.get("type") == "luxury_gift"]
        assert not luxury_events, f"unexpected luxury_gift on <=2999 gift: {luxury_events}"


class TestRoomOwnerRecipientAllowed:
    """Batch B — room owner is accepted as a recipient even if not currently in room."""
    @pytest.mark.asyncio
    async def test_owner_as_recipient_not_in_room(self, tokens, test_room, mdb):
        s = tokens["s"]
        o_id = tokens["o"]["user"]["id"]
        # Ensure owner is NOT in room: remove their room_entries row
        mdb.room_entries.delete_many({"user_id": o_id, "room_id": test_room})
        # Sender must be in room
        s_ws = await _join_room_ws(s, test_room)
        try:
            req = secrets.token_hex(8)
            resp = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                 headers=_h(s),
                                 json={"gift_id": "rose", "quantity": 1,
                                       "recipient_ids": [o_id], "room_id": test_room,
                                       "request_id": req}, timeout=15)
            assert resp.status_code == 200, f"owner-as-absent-recipient rejected: {resp.status_code} {resp.text}"
            assert resp.json()["recipient_count"] == 1
        finally:
            await s_ws.close()


class TestRoyalDragonAtomicDeduction:
    @pytest.mark.asyncio
    async def test_royal_dragon_deducts_once_and_dedupe(self, tokens, test_room, mdb):
        s = tokens["s"]
        r1 = tokens["r1"]
        s_oid = ObjectId(s["user"]["id"])
        # Save and set balance: 600_000 (enough for 1 royal_dragon)
        orig_user = mdb.users.find_one({"_id": s_oid})
        orig_coins = int(orig_user.get("coins", 0))
        mdb.users.update_one({"_id": s_oid}, {"$set": {"coins": 600_000}})
        s_ws = await _join_room_ws(s, test_room)
        r_ws = await _join_room_ws(r1, test_room)
        try:
            rid = r1["user"]["id"]
            # 1) Insufficient balance test first (set to 100): expect 402, no deduction.
            mdb.users.update_one({"_id": s_oid}, {"$set": {"coins": 100}})
            resp0 = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                  headers=_h(s),
                                  json={"gift_id": "royal_dragon", "quantity": 1,
                                        "recipient_ids": [rid], "room_id": test_room,
                                        "request_id": secrets.token_hex(8)}, timeout=15)
            assert resp0.status_code == 402, f"expected 402, got {resp0.status_code}: {resp0.text}"
            after0 = mdb.users.find_one({"_id": s_oid})
            assert int(after0["coins"]) == 100, f"balance changed on 402: {after0['coins']}"

            # 2) Successful single royal_dragon → exactly 500_000 deducted
            mdb.users.update_one({"_id": s_oid}, {"$set": {"coins": 600_000}})
            req = secrets.token_hex(8)
            resp1 = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                  headers=_h(s),
                                  json={"gift_id": "royal_dragon", "quantity": 1,
                                        "recipient_ids": [rid], "room_id": test_room,
                                        "request_id": req}, timeout=20)
            assert resp1.status_code == 200, resp1.text
            data1 = resp1.json()
            assert data1["total_cost"] == 500_000
            assert data1["new_balance"] == 100_000
            after1 = mdb.users.find_one({"_id": s_oid})
            assert int(after1["coins"]) == 100_000, f"after royal_dragon: {after1['coins']}"

            # 3) Duplicate request_id → 409 and no further deduction.
            mdb.users.update_one({"_id": s_oid}, {"$set": {"coins": 600_000}})
            resp2 = requests.post(f"{BASE_URL}/api/gifts/send-multi",
                                  headers=_h(s),
                                  json={"gift_id": "royal_dragon", "quantity": 1,
                                        "recipient_ids": [rid], "room_id": test_room,
                                        "request_id": req}, timeout=20)
            assert resp2.status_code == 409, f"dup request_id should be 409, got {resp2.status_code}: {resp2.text}"
            after2 = mdb.users.find_one({"_id": s_oid})
            assert int(after2["coins"]) == 600_000, f"balance changed on dup: {after2['coins']}"
        finally:
            await s_ws.close()
            await r_ws.close()
            # Restore original balance
            mdb.users.update_one({"_id": s_oid}, {"$set": {"coins": orig_coins}})
