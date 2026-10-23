"""
Iter-137 — Private call <-> voice-room exclusivity.

Verifies:
  - POST /api/calls/start: 409 CALLER_IN_ROOM when caller is in a voice room ws.
  - POST /api/calls/start: 409 CALLEE_IN_ROOM when callee is in a voice room ws.
  - POST /api/calls/start: 200 when neither is in a room.
  - Entering /api/ws/rooms/{id} while a user has a ringing/accepted call
    ends it with status=ended, end_reason=joined_room.
  - GET /api/calls/current returns {call: null, last: {end_reason: "joined_room"}}
    for the other user within 15s.
  - POST /calls/{id}/end as callee during ringing → caller sees last.status "rejected".
  - Duplicate POST /calls/start while a call is active → 409 CALL_BUSY.
"""
import asyncio
import os
import time
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

# test.3 is caller, test.4 is callee (DM thread already exists)
CALLER_EMAIL = "test.3@oriotest.dev"
CALLEE_EMAIL = "test.4@oriotest.dev"
PWD = "demo1234"
# TEST room id (visible only to test accounts, seeded by seed_test_data.py)
# We'll resolve it dynamically from the rooms list for the caller.


def _login(email: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PWD}, timeout=10)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    j = r.json()
    tok = j["access_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert me.status_code == 200, f"/auth/me failed: {me.status_code} {me.text}"
    uid = me.json().get("id") or me.json().get("_id") or me.json().get("user", {}).get("id")
    return {"access_token": tok, "user": {"id": uid}}


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _end_any_active(tok: str, uid: str):
    """Cleanup — hang up any lingering call for this user."""
    cur = requests.get(f"{BASE_URL}/api/calls/current", headers=_auth(tok), timeout=10).json()
    c = cur.get("call")
    if c:
        requests.post(f"{BASE_URL}/api/calls/{c['id']}/end", headers=_auth(tok), timeout=10)


def _find_test_room(tok: str) -> str:
    """Return any TEST room id (seeded for test accounts)."""
    r = requests.get(f"{BASE_URL}/api/rooms", headers=_auth(tok), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    rooms = body if isinstance(body, list) else (body.get("items") or [])
    for room in rooms:
        name = (room.get("name") or "")
        if name.startswith("TEST "):
            return room.get("id") or str(room.get("_id"))
    # Fallback: just take the first room
    assert rooms, "No rooms available"
    return rooms[0].get("id") or str(rooms[0].get("_id"))


@pytest.fixture(scope="module")
def auth():
    a = _login(CALLER_EMAIL)
    b = _login(CALLEE_EMAIL)
    tok_a = a["access_token"]; tok_b = b["access_token"]
    uid_a = a["user"]["id"]; uid_b = b["user"]["id"]
    # Ensure clean slate
    _end_any_active(tok_a, uid_a); _end_any_active(tok_b, uid_b)
    yield {"tok_a": tok_a, "tok_b": tok_b, "uid_a": uid_a, "uid_b": uid_b}
    _end_any_active(tok_a, uid_a); _end_any_active(tok_b, uid_b)


class TestCallsRoomGuard:
    def test_1_start_ok_when_neither_in_room(self, auth):
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        r = requests.post(f"{BASE_URL}/api/calls/start",
                          headers=_auth(auth["tok_a"]),
                          json={"callee_id": auth["uid_b"]}, timeout=10)
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        data = r.json()
        assert data.get("call", {}).get("status") == "ringing"
        assert data.get("call", {}).get("direction") == "outgoing"
        assert "channel" in (data.get("rtc") or {})
        # cleanup
        cid = data["call"]["id"]
        requests.post(f"{BASE_URL}/api/calls/{cid}/end", headers=_auth(auth["tok_a"]), timeout=10)

    def test_2_duplicate_start_is_call_busy(self, auth):
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        r1 = requests.post(f"{BASE_URL}/api/calls/start",
                           headers=_auth(auth["tok_a"]),
                           json={"callee_id": auth["uid_b"]}, timeout=10)
        assert r1.status_code == 200, r1.text
        cid = r1.json()["call"]["id"]
        r2 = requests.post(f"{BASE_URL}/api/calls/start",
                           headers=_auth(auth["tok_a"]),
                           json={"callee_id": auth["uid_b"]}, timeout=10)
        assert r2.status_code == 409
        assert "CALL_BUSY" in r2.text
        requests.post(f"{BASE_URL}/api/calls/{cid}/end", headers=_auth(auth["tok_a"]), timeout=10)

    def test_3_reject_sets_last_rejected_for_caller(self, auth):
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        r = requests.post(f"{BASE_URL}/api/calls/start",
                         headers=_auth(auth["tok_a"]),
                         json={"callee_id": auth["uid_b"]}, timeout=10)
        assert r.status_code == 200, r.text
        cid = r.json()["call"]["id"]
        # Callee rejects
        rj = requests.post(f"{BASE_URL}/api/calls/{cid}/end",
                           headers=_auth(auth["tok_b"]), timeout=10)
        assert rj.status_code == 200
        # Caller's /current → last.status rejected
        cur = requests.get(f"{BASE_URL}/api/calls/current",
                           headers=_auth(auth["tok_a"]), timeout=10).json()
        assert cur.get("call") is None
        assert cur.get("last", {}).get("status") == "rejected"

    def test_4_caller_in_room_blocks_start(self, auth):
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        room_id = _find_test_room(auth["tok_a"])
        ws_uri = f"{WS_URL}/api/ws/rooms/{room_id}?token={auth['tok_a']}"

        async def runner():
            async with websockets.connect(ws_uri) as ws:
                # wait for the connect handshake to register in presence
                await asyncio.sleep(1.5)
                r = requests.post(f"{BASE_URL}/api/calls/start",
                                  headers=_auth(auth["tok_a"]),
                                  json={"callee_id": auth["uid_b"]}, timeout=10)
                return r

        r = asyncio.get_event_loop().run_until_complete(runner()) if False else asyncio.run(runner())
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"
        assert "CALLER_IN_ROOM" in r.text

    def test_5_callee_in_room_blocks_start(self, auth):
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        room_id = _find_test_room(auth["tok_b"])
        ws_uri = f"{WS_URL}/api/ws/rooms/{room_id}?token={auth['tok_b']}"

        async def runner():
            async with websockets.connect(ws_uri) as ws:
                await asyncio.sleep(1.5)
                r = requests.post(f"{BASE_URL}/api/calls/start",
                                  headers=_auth(auth["tok_a"]),
                                  json={"callee_id": auth["uid_b"]}, timeout=10)
                return r

        r = asyncio.run(runner())
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"
        assert "CALLEE_IN_ROOM" in r.text

    def test_6_entering_room_ends_ringing_call_joined_room(self, auth):
        """Caller starts a call, THEN caller enters a room → call ends joined_room."""
        _end_any_active(auth["tok_a"], auth["uid_a"])
        _end_any_active(auth["tok_b"], auth["uid_b"])
        # Start the call first (neither in a room)
        s = requests.post(f"{BASE_URL}/api/calls/start",
                          headers=_auth(auth["tok_a"]),
                          json={"callee_id": auth["uid_b"]}, timeout=10)
        assert s.status_code == 200, s.text
        room_id = _find_test_room(auth["tok_a"])
        ws_uri = f"{WS_URL}/api/ws/rooms/{room_id}?token={auth['tok_a']}"

        async def runner():
            async with websockets.connect(ws_uri) as ws:
                await asyncio.sleep(1.5)
                # Callee queries current → call should be null, last=joined_room
                cur = requests.get(f"{BASE_URL}/api/calls/current",
                                   headers=_auth(auth["tok_b"]), timeout=10).json()
                return cur

        cur = asyncio.run(runner())
        assert cur.get("call") is None, f"expected call None, got {cur}"
        assert cur.get("last", {}).get("end_reason") == "joined_room", f"got {cur}"
