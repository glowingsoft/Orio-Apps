"""ORIO iter-27 backend regression — Seat 3-action sheet endpoints.

Focus: The owner/mod tap on a mic seat MUST open the 3-action sheet
(Lock, Change Seat, Invite). The corresponding backend endpoints are:
  * POST /api/rooms/{id}/moderate     (action: lock_seat / unlock_seat)
  * POST /api/rooms/{id}/mic-invite   (target_user_id, seat_index)
  * POST /api/rooms/{id}/mic-change-seat (from_index, to_index)

Non-privileged users must be rejected with 403 for all three.
"""
from __future__ import annotations
import os
import time
import uuid
import asyncio
import json
import pytest
import requests
import websockets

BASE_URL = (os.environ.get("EXPO_BACKEND_URL_TEST") or "http://localhost:8001").rstrip("/")
WS_BASE = BASE_URL.replace("http", "ws", 1)

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# --------------------------- helpers ---------------------------
def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_throwaway() -> tuple[str, str]:
    uid_suffix = uuid.uuid4().hex[:8]
    email = f"TEST_iter27_{uid_suffix}@example.com"
    username = f"iter27_{uid_suffix}"
    payload = {
        "email": email,
        "password": "iter27pass123",
        "username": username,
        "nickname": f"Iter27 {uid_suffix}",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10).json()
    return tok, me["id"]


def _get_seed_room(owner_token: str) -> dict:
    r = requests.get(f"{BASE_URL}/api/rooms/mine", headers={"Authorization": f"Bearer {owner_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    rooms = r.json()
    # Return the first 8-seat demo room
    for rm in rooms:
        if rm.get("num_seats") == 8:
            return rm
    assert rooms, "Demo user has no rooms — cannot run iter-27 tests"
    return rooms[0]


async def _ws_join(room_id: str, token: str) -> "websockets.WebSocketClientProtocol":
    url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={token}"
    ws = await websockets.connect(url, open_timeout=10, close_timeout=5)
    return ws


# ---------------------------- fixtures ----------------------------
@pytest.fixture(scope="module")
def owner_token() -> str:
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def owner_room(owner_token: str) -> dict:
    return _get_seed_room(owner_token)


@pytest.fixture(scope="module")
def guest():
    tok, uid = _register_throwaway()
    return {"token": tok, "id": uid}


def _ensure_seat_empty(token: str, rid: str, idx: int) -> None:
    """Free a seat by kicking whoever sits on it (best-effort, tolerant to 400)."""
    requests.post(
        f"{BASE_URL}/api/rooms/{rid}/moderate",
        headers={"Authorization": f"Bearer {token}"},
        json={"action": "unlock_seat", "seat_index": idx},
        timeout=10,
    )
    requests.post(
        f"{BASE_URL}/api/rooms/{rid}/moderate",
        headers={"Authorization": f"Bearer {token}"},
        json={"action": "kick_seat", "seat_index": idx},
        timeout=10,
    )


@pytest.fixture(scope="module", autouse=True)
def _prepare_seats(owner_token, owner_room):
    """Ensure seats 2, 3, 4, 5, 6, 7 are empty and unlocked before running the module."""
    for i in (2, 3, 4, 5, 6, 7):
        _ensure_seat_empty(owner_token, owner_room["id"], i)
    yield


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_token, owner_room):
    """After all tests in this module, restore seats to empty/unlocked."""
    yield
    rid = owner_room["id"]
    # Best-effort: unlock every non-host seat and kick any lingering user
    try:
        room = requests.get(f"{BASE_URL}/api/rooms/{rid}",
                            headers={"Authorization": f"Bearer {owner_token}"}, timeout=10).json()
        for s in room.get("seats", []):
            i = s.get("index", 0)
            if i == 0:
                continue
            if s.get("locked"):
                requests.post(
                    f"{BASE_URL}/api/rooms/{rid}/moderate",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"action": "unlock_seat", "seat_index": i},
                    timeout=10,
                )
            if s.get("user"):
                requests.post(
                    f"{BASE_URL}/api/rooms/{rid}/moderate",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"action": "kick_seat", "seat_index": i},
                    timeout=10,
                )
    except Exception:
        pass


# ---------------------------- LOCK / UNLOCK ----------------------------
class TestLockUnlockSeat:
    """Verifies action 'lock_seat' / 'unlock_seat' — the FIRST row in the sheet."""

    def test_owner_can_lock_seat(self, owner_token, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"action": "lock_seat", "seat_index": 3},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # Verify persistence
        room = r.json()
        seat3 = next(s for s in room["seats"] if s["index"] == 3)
        assert seat3["locked"] is True

    def test_owner_can_unlock_seat(self, owner_token, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"action": "unlock_seat", "seat_index": 3},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        room = r.json()
        seat3 = next(s for s in room["seats"] if s["index"] == 3)
        assert seat3["locked"] is False

    def test_non_owner_lock_forbidden(self, guest, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {guest['token']}"},
            json={"action": "lock_seat", "seat_index": 4},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_invalid_seat_index(self, owner_token, owner_room):
        rid = owner_room["id"]
        # An 8-seat room has seats 0..8 (host + 8). Use index 15 (within
        # pydantic bounds ≤20 but out of the room's seat list).
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"action": "lock_seat", "seat_index": 15},
            timeout=10,
        )
        assert r.status_code == 400


# ---------------------------- INVITE ----------------------------
class TestMicInvite:
    """Verifies POST /rooms/{id}/mic-invite — the THIRD row in the sheet."""

    def test_invite_forbids_non_owner(self, guest, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-invite",
            headers={"Authorization": f"Bearer {guest['token']}"},
            json={"target_user_id": guest["id"], "seat_index": 2},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_invite_target_not_present(self, owner_token, owner_room, guest):
        """Guest is NOT joined via WS => backend must return 400."""
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-invite",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"target_user_id": guest["id"], "seat_index": 2},
            timeout=10,
        )
        assert r.status_code == 400, r.text
        assert "not in the room" in r.text.lower()

    def test_invite_locked_seat(self, owner_token, owner_room):
        rid = owner_room["id"]
        # Lock seat 5
        requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"action": "lock_seat", "seat_index": 5},
            timeout=10,
        )
        # Even bogus target — the locked check comes before the target lookup
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-invite",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"target_user_id": "6ab0000000000000000000aa", "seat_index": 5},
            timeout=10,
        )
        assert r.status_code == 403, r.text
        # cleanup
        requests.post(
            f"{BASE_URL}/api/rooms/{rid}/moderate",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"action": "unlock_seat", "seat_index": 5},
            timeout=10,
        )

    def test_invite_succeeds_when_target_ws_present(self, owner_token, owner_room, guest):
        """Real end-to-end: guest joins the room via WS, owner invites them to seat 2."""
        rid = owner_room["id"]

        async def _run():
            # Guest joins WS presence
            ws = await _ws_join(rid, guest["token"])
            # Give the hub a moment to register presence
            await asyncio.sleep(0.4)
            try:
                r = requests.post(
                    f"{BASE_URL}/api/rooms/{rid}/mic-invite",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"target_user_id": guest["id"], "seat_index": 2},
                    timeout=10,
                )
                assert r.status_code == 200, r.text
                room = r.json()
                seat2 = next(s for s in room["seats"] if s["index"] == 2)
                assert seat2.get("user") and seat2["user"]["id"] == guest["id"]
            finally:
                await ws.close()

        asyncio.run(_run())


# ---------------------------- CHANGE SEAT ----------------------------
class TestMicChangeSeat:
    """Verifies POST /rooms/{id}/mic-change-seat — the SECOND row in the sheet."""

    def test_change_seat_forbids_non_owner(self, guest, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-change-seat",
            headers={"Authorization": f"Bearer {guest['token']}"},
            json={"from_index": 1, "to_index": 6},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_change_seat_source_empty_400(self, owner_token, owner_room):
        rid = owner_room["id"]
        # Assume seat 7 is empty
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-change-seat",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"from_index": 7, "to_index": 6},
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_change_seat_identical_no_op(self, owner_token, owner_room):
        rid = owner_room["id"]
        r = requests.post(
            f"{BASE_URL}/api/rooms/{rid}/mic-change-seat",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"from_index": 3, "to_index": 3},
            timeout=10,
        )
        assert r.status_code == 200, r.text

    def test_full_flow_invite_then_change_seat(self, owner_token, owner_room, guest):
        """Invite guest to seat 4, then owner moves them to seat 6."""
        rid = owner_room["id"]

        async def _run():
            ws = await _ws_join(rid, guest["token"])
            await asyncio.sleep(0.4)
            try:
                # Invite to seat 4
                r = requests.post(
                    f"{BASE_URL}/api/rooms/{rid}/mic-invite",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"target_user_id": guest["id"], "seat_index": 4},
                    timeout=10,
                )
                assert r.status_code == 200, r.text
                # Change seat 4 -> 6
                r2 = requests.post(
                    f"{BASE_URL}/api/rooms/{rid}/mic-change-seat",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"from_index": 4, "to_index": 6},
                    timeout=10,
                )
                assert r2.status_code == 200, r2.text
                room = r2.json()
                seat4 = next(s for s in room["seats"] if s["index"] == 4)
                seat6 = next(s for s in room["seats"] if s["index"] == 6)
                assert seat4.get("user") is None
                assert seat6.get("user") and seat6["user"]["id"] == guest["id"]
            finally:
                await ws.close()

        asyncio.run(_run())


# ---------------------------- Sheet contract sanity ----------------------------
class TestRoomInfoBackendContract:
    """Verifies /rooms/{id} returns the shape needed by /room/{id}/info (Section 1
    tests that iter-27 needs so the info screen still renders after tap → menu → info)."""

    def test_public_room_shape(self, owner_token, owner_room):
        rid = owner_room["id"]
        r = requests.get(f"{BASE_URL}/api/rooms/{rid}",
                         headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        assert r.status_code == 200, r.text
        rm = r.json()
        for key in ("id", "name", "owner_id", "seats", "num_seats", "moderators"):
            assert key in rm, f"missing key {key}"
        # No leaking password_hash / pin_hash
        assert "password_hash" not in rm
        assert "pin_hash" not in rm
