"""ORIO iteration 17 — Host chair perm + Room lock + Mic invite/change + PK flow."""
import asyncio
import os
import time
import uuid
import pytest
import requests
import websockets

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_fresh():
    tag = uuid.uuid4().hex[:8]
    payload = {
        "email": f"iter17_{tag}@voiceup.app",
        "password": "test1234",
        "username": f"iter17{tag}",
        "nickname": f"Iter17 {tag}",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, r.text
    return r.json()["access_token"], payload["email"]


def _me(token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _get_room(token, room_id):
    r = requests.get(f"{API}/rooms/{room_id}",
                     headers={"Authorization": f"Bearer {token}"}, timeout=15)
    return r


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _create_room(token, name=None):
    name = name or f"TEST iter17 {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/rooms",
                      json={"name": name, "num_seats": 8, "category": "chat"},
                      headers=_hdr(token), timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- shared fixtures ----------
@pytest.fixture(scope="module")
def owner_token():
    # Owner = fresh account so we control ownership deterministically
    tok, _ = _register_fresh()
    return tok


@pytest.fixture(scope="module")
def non_owner_token():
    # Non-owner user (also used later as PK opponent + presence target)
    tok, _ = _register_fresh()
    return tok


@pytest.fixture(scope="module")
def room(owner_token):
    return _create_room(owner_token)


# =====================================================================
# B1 — Host chair permission
# =====================================================================
class TestB1HostChairPermission:
    def test_non_owner_take_seat_0_returns_403_arabic(self, room, non_owner_token):
        rid = room["id"]
        # non-owner must first "join" (bump listeners) then try take seat 0
        rj = requests.post(f"{API}/rooms/{rid}/join", json={}, headers=_hdr(non_owner_token), timeout=15)
        assert rj.status_code == 200, rj.text
        r = requests.post(f"{API}/rooms/{rid}/seats/take",
                          json={"seat_index": 0},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403, r.text
        assert r.json().get("detail") == "هذا المقعد لصاحب الغرفة فقط", r.json()

    def test_owner_holds_seat_0_on_create(self, room, owner_token):
        # After create, seat[0] should be the owner
        rid = room["id"]
        r = _get_room(owner_token, rid)
        assert r.status_code == 200
        seats = r.json()["seats"]
        me = _me(owner_token)
        assert seats[0]["user"] is not None
        assert seats[0]["user"]["id"] == me["id"]

    def test_owner_can_retake_seat_0_after_leaving(self, room, owner_token):
        rid = room["id"]
        # Leave seat 0
        r = requests.post(f"{API}/rooms/{rid}/seats/leave",
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        # Retake
        r = requests.post(f"{API}/rooms/{rid}/seats/take",
                          json={"seat_index": 0},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["seats"][0]["user"]["id"] == _me(owner_token)["id"]


# =====================================================================
# B2 — Room lock endpoints
# =====================================================================
class TestB2RoomLock:
    def test_lock_valid_pin(self, room, owner_token):
        rid = room["id"]
        r = requests.post(f"{API}/rooms/{rid}/lock", json={"pin": "12345"},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_locked"] is True

    def test_lock_non_digit_pin_400(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/lock", json={"pin": "abc12"},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 400

    def test_lock_short_pin_400(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/lock", json={"pin": "1234"},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 400

    def test_lock_non_owner_403(self, room, non_owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/lock", json={"pin": "99999"},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403

    def test_get_room_exposes_is_locked_hides_pin_hash(self, room, owner_token):
        r = _get_room(owner_token, room['id'])
        assert r.status_code == 200
        body = r.json()
        assert body.get("is_locked") is True
        assert "pin_hash" not in body

    def test_unlock_by_owner(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/unlock",
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["is_locked"] is False


# =====================================================================
# B3 — Join with pin body
# =====================================================================
class TestB3JoinPin:
    @pytest.fixture(scope="class")
    def locked_room(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/lock", json={"pin": "55555"},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200
        return room

    def test_join_no_body_403(self, locked_room, non_owner_token):
        r = requests.post(f"{API}/rooms/{locked_room['id']}/join",
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403
        detail = (r.json().get("detail") or "").lower()
        assert "locked" in detail or "5-digit" in detail or "code" in detail

    def test_join_wrong_pin_403(self, locked_room, non_owner_token):
        r = requests.post(f"{API}/rooms/{locked_room['id']}/join",
                          json={"pin": "11111"},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403

    def test_join_correct_pin_200(self, locked_room, non_owner_token):
        r = requests.post(f"{API}/rooms/{locked_room['id']}/join",
                          json={"pin": "55555"},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 200

    def test_owner_bypass_no_pin(self, locked_room, owner_token):
        r = requests.post(f"{API}/rooms/{locked_room['id']}/join",
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200


# =====================================================================
# B4 — GET participants shape
# =====================================================================
class TestB4Participants:
    def test_participants_shape(self, room, owner_token):
        r = requests.get(f"{API}/rooms/{room['id']}/participants",
                         headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"room_id", "count", "participants"}
        assert body["room_id"] == room["id"]
        assert isinstance(body["participants"], list)
        assert isinstance(body["count"], int)


# =====================================================================
# B5 — Mic invite (with WS presence)
# =====================================================================
async def _open_ws(token, room_id):
    ws_url = f"{WS_BASE}/rooms/{room_id}?token={token}"
    ws = await websockets.connect(ws_url, open_timeout=10, ping_interval=None)
    # Wait a moment so server registers presence
    await asyncio.sleep(0.5)
    return ws


class TestB5MicInvite:
    def test_target_not_in_presence_returns_400(self, room, owner_token, non_owner_token):
        # First unlock to be safe & take an empty seat scenario
        requests.post(f"{API}/rooms/{room['id']}/unlock", headers=_hdr(owner_token), timeout=15)
        target_id = _me(non_owner_token)["id"]
        # Ensure no WS is open for non_owner right now
        r = requests.post(f"{API}/rooms/{room['id']}/mic-invite",
                          json={"target_user_id": target_id, "seat_index": 2},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 400, r.text
        assert "not in the room" in (r.json().get("detail") or "").lower()

    def test_invite_present_user_to_empty_seat(self, room, owner_token, non_owner_token):
        target_id = _me(non_owner_token)["id"]

        async def _run():
            ws = await _open_ws(non_owner_token, room["id"])
            try:
                r = requests.post(f"{API}/rooms/{room['id']}/mic-invite",
                                  json={"target_user_id": target_id, "seat_index": 3},
                                  headers=_hdr(owner_token), timeout=15)
                assert r.status_code == 200, r.text
                seats = r.json()["seats"]
                assert seats[3]["user"] is not None
                assert seats[3]["user"]["id"] == target_id
            finally:
                await ws.close()

        asyncio.get_event_loop().run_until_complete(_run())

    def test_invite_non_owner_to_seat_0_403(self, room, owner_token, non_owner_token):
        target_id = _me(non_owner_token)["id"]

        async def _run():
            ws = await _open_ws(non_owner_token, room["id"])
            try:
                # ensure seat 0 is empty
                requests.post(f"{API}/rooms/{room['id']}/seats/leave",
                              headers=_hdr(owner_token), timeout=15)
                r = requests.post(f"{API}/rooms/{room['id']}/mic-invite",
                                  json={"target_user_id": target_id, "seat_index": 0},
                                  headers=_hdr(owner_token), timeout=15)
                assert r.status_code == 403, r.text
                assert r.json()["detail"] == "هذا المقعد لصاحب الغرفة فقط"
            finally:
                await ws.close()
                # restore owner to seat 0
                requests.post(f"{API}/rooms/{room['id']}/seats/take",
                              json={"seat_index": 0}, headers=_hdr(owner_token), timeout=15)

        asyncio.get_event_loop().run_until_complete(_run())

    def test_non_owner_calling_mic_invite_403(self, room, non_owner_token, owner_token):
        target_id = _me(owner_token)["id"]
        r = requests.post(f"{API}/rooms/{room['id']}/mic-invite",
                          json={"target_user_id": target_id, "seat_index": 4},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403


# =====================================================================
# B6 — Mic change seat
# =====================================================================
class TestB6MicChangeSeat:
    def _seat_user(self, room_id, non_owner_token, owner_token, seat_idx):
        """Place non_owner into seat_idx via mic-invite (requires WS presence)."""
        target_id = _me(non_owner_token)["id"]

        async def _run():
            ws = await _open_ws(non_owner_token, room_id)
            try:
                r = requests.post(f"{API}/rooms/{room_id}/mic-invite",
                                  json={"target_user_id": target_id, "seat_index": seat_idx},
                                  headers=_hdr(owner_token), timeout=15)
                assert r.status_code == 200, r.text
            finally:
                await ws.close()

        asyncio.get_event_loop().run_until_complete(_run())

    def test_move_occupied_to_empty(self, room, owner_token, non_owner_token):
        rid = room["id"]
        # Ensure non_owner is on seat 5 (fresh)
        # First free any seat they might occupy
        # Directly place them on seat 5
        self._seat_user(rid, non_owner_token, owner_token, 5)
        # Now move 5 -> 6
        r = requests.post(f"{API}/rooms/{rid}/mic-change-seat",
                          json={"from_index": 5, "to_index": 6},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        seats = r.json()["seats"]
        assert seats[6]["user"] is not None
        assert seats[6]["user"]["id"] == _me(non_owner_token)["id"]
        assert seats[5]["user"] is None

    def test_move_same_index_returns_room_unchanged(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/mic-change-seat",
                          json={"from_index": 6, "to_index": 6},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200

    def test_move_from_empty_seat_400(self, room, owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/mic-change-seat",
                          json={"from_index": 7, "to_index": 2},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 400

    def test_non_mod_403(self, room, non_owner_token):
        r = requests.post(f"{API}/rooms/{room['id']}/mic-change-seat",
                          json={"from_index": 6, "to_index": 7},
                          headers=_hdr(non_owner_token), timeout=15)
        assert r.status_code == 403


# =====================================================================
# B7 — PK flow
# =====================================================================
class TestB7PkFlow:
    def test_pk_full_flow(self, room, owner_token, non_owner_token):
        rid = room["id"]
        owner_id = _me(owner_token)["id"]
        other_id = _me(non_owner_token)["id"]

        # Make sure owner sits at seat 0 and non_owner is on seat 6 (from B6) - verify.
        # If not, re-seat.
        room_now = _get_room(owner_token, rid).json()
        seats = room_now["seats"]
        # owner on 0?
        if not (seats[0].get("user") and seats[0]["user"]["id"] == owner_id):
            requests.post(f"{API}/rooms/{rid}/seats/leave", headers=_hdr(owner_token), timeout=15)
            r = requests.post(f"{API}/rooms/{rid}/seats/take",
                              json={"seat_index": 0}, headers=_hdr(owner_token), timeout=15)
            assert r.status_code == 200
        # non-owner on 6?
        if not any(s.get("user") and s["user"]["id"] == other_id for s in seats):
            async def _run():
                ws = await _open_ws(non_owner_token, rid)
                try:
                    r = requests.post(f"{API}/rooms/{rid}/mic-invite",
                                      json={"target_user_id": other_id, "seat_index": 6},
                                      headers=_hdr(owner_token), timeout=15)
                    assert r.status_code == 200, r.text
                finally:
                    await ws.close()
            asyncio.get_event_loop().run_until_complete(_run())

        # find seat index of non_owner
        seats = _get_room(owner_token, rid).json()["seats"]
        b_idx = next(i for i, s in enumerate(seats) if s.get("user") and s["user"]["id"] == other_id)

        # Start PK: seat_a=0 (owner), seat_b=b_idx
        r = requests.post(f"{API}/rooms/{rid}/pk/start",
                          json={"seat_a": 0, "seat_b": b_idx, "duration_seconds": 300},
                          headers=_hdr(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        pk = r.json()
        assert pk["status"] == "active"
        assert pk["score_a"] == 0
        assert pk["score_b"] == 0

        # Concurrent second start → 409
        r2 = requests.post(f"{API}/rooms/{rid}/pk/start",
                           json={"seat_a": 0, "seat_b": b_idx, "duration_seconds": 300},
                           headers=_hdr(owner_token), timeout=15)
        assert r2.status_code == 409, r2.text

        # GET returns active
        r3 = requests.get(f"{API}/rooms/{rid}/pk", headers=_hdr(owner_token), timeout=15)
        assert r3.status_code == 200
        assert r3.json()["status"] == "active"

        # Non_owner sends rose to owner (seat_a occupant). But non_owner has 500 coins > 10, ok.
        r4 = requests.post(f"{API}/gifts/send",
                           json={"room_id": rid, "recipient_id": owner_id,
                                 "quantity": 1, "gift_id": "rose"},
                           headers=_hdr(non_owner_token), timeout=15)
        assert r4.status_code == 200, r4.text

        # Give the async broadcast a moment (though scoring is synchronous)
        time.sleep(0.3)
        r5 = requests.get(f"{API}/rooms/{rid}/pk", headers=_hdr(owner_token), timeout=15)
        state = r5.json()
        assert state["score_a"] == 10, state
        assert state["score_b"] == 0, state

        # End PK
        r6 = requests.post(f"{API}/rooms/{rid}/pk/end",
                           headers=_hdr(owner_token), timeout=15)
        assert r6.status_code == 200, r6.text
        end = r6.json()
        assert end["status"] == "ended"
        assert end["winner"] in {"a", "b", "tie"}
        assert end["winner"] == "a"
