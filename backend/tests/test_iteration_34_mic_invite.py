"""
Iteration 34 — Real mic-invite Accept/Reject flow + mic-change-seat.

Tests the new invitation endpoints against the PUBLIC preview URL:
  POST /api/rooms/{id}/mic-invite         (owner/mod only, 60s TTL)
  POST /api/rooms/{id}/mic-invite/accept
  POST /api/rooms/{id}/mic-invite/reject
  POST /api/rooms/{id}/mic-change-seat    (regression, unchanged)

Also runs the iter-33 regression on follow/block/report/rooms/rtc suite.

Presence is populated only via the WS route /api/ws/rooms/{room_id}?token=...
so the invite tests open a real WS as the target user before inviting.
"""
import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests
import websockets


# ---------- helpers ----------
def _load_public_backend_url() -> str:
    envp = Path("/app/frontend/.env")
    for line in envp.read_text().splitlines():
        m = re.match(r"\s*EXPO_PUBLIC_BACKEND_URL\s*=\s*(.+)", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found in frontend/.env")


BASE_URL = _load_public_backend_url().rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASS = "demo1234"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(s, email, password):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    d = r.json()
    return d.get("access_token") or d.get("token")


def _register(s, email, password, username, nickname="Iter34"):
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "username": username, "nickname": nickname},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return d.get("access_token") or d.get("token")


def _me(s, tok):
    r = s.get(f"{BASE_URL}/api/auth/me", headers=_auth(tok), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def demo_token(s):
    return _login(s, DEMO_EMAIL, DEMO_PASS)


@pytest.fixture(scope="module")
def demo_user(s, demo_token):
    return _me(s, demo_token)


@pytest.fixture(scope="module")
def target_user(s):
    """Fresh user – will be invited to a mic seat."""
    uniq = uuid.uuid4().hex[:8]
    tok = _register(s, f"iter34_t_{uniq}@voiceup.app", "password123", f"iter34t_{uniq}", "Iter34 Target")
    me = _me(s, tok)
    return {"token": tok, "id": me.get("id") or me.get("_id"), "nickname": me.get("nickname")}


@pytest.fixture(scope="module")
def normie_user(s):
    """Fresh user – used to prove non-owner/mod can't invite."""
    uniq = uuid.uuid4().hex[:8]
    tok = _register(s, f"iter34_n_{uniq}@voiceup.app", "password123", f"iter34n_{uniq}", "Iter34 Normie")
    me = _me(s, tok)
    return {"token": tok, "id": me.get("id") or me.get("_id")}


@pytest.fixture(scope="module")
def other_user(s):
    """Fresh user – used to test 'someone else took the seat' race."""
    uniq = uuid.uuid4().hex[:8]
    tok = _register(s, f"iter34_o_{uniq}@voiceup.app", "password123", f"iter34o_{uniq}", "Iter34 Other")
    me = _me(s, tok)
    return {"token": tok, "id": me.get("id") or me.get("_id")}


@pytest.fixture(scope="module")
def room(s, demo_token):
    """Create a fresh 8-seat room owned by demo (matches 'Iter22 8 seats' shape)."""
    r = s.post(
        f"{BASE_URL}/api/rooms",
        json={
            "name": f"Iter34 8 seats {uuid.uuid4().hex[:6]}",
            "description": "iter34 mic-invite test room",
            "category": "general",
            "num_seats": 8,
            "is_private": False,
        },
        headers=_auth(demo_token),
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    return body


def _get_room(s, token, room_id):
    r = s.get(f"{BASE_URL}/api/rooms/{room_id}", headers=_auth(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


async def _ws_connect(room_id, token):
    """Open a WS to /api/ws/rooms/{id}?token=... — returns the connected socket."""
    url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={token}"
    ws = await websockets.connect(url, open_timeout=10, ping_interval=None)
    # Give server a tick to register presence
    try:
        await asyncio.wait_for(ws.recv(), timeout=2.0)
    except Exception:
        pass
    return ws


async def _drain(ws, ms=250):
    """Drain any queued messages so subsequent recv() sees fresh events."""
    end = time.time() + ms / 1000.0
    while time.time() < end:
        try:
            await asyncio.wait_for(ws.recv(), timeout=0.05)
        except Exception:
            return


def _run(coro):
    """Utility to run an async coro from a sync test."""
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.new_event_loop().run_until_complete(coro)


# ==================================================================
# 1. Auth / precondition tests on POST /mic-invite (no live WS)
# ==================================================================
class TestMicInviteAuthAndPreconditions:
    def test_invite_requires_auth(self, s, room, target_user):
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": target_user["id"], "seat_index": 1},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.text

    def test_invite_forbidden_for_normie(self, s, room, target_user, normie_user):
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": target_user["id"], "seat_index": 1},
            headers=_auth(normie_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_invite_target_not_in_presence(self, s, room, demo_token, target_user):
        """Target has never opened a WS → 400 'not in the room'."""
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": target_user["id"], "seat_index": 1},
            headers=_auth(demo_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "not in the room" in r.text.lower() or "not in" in r.text.lower()

    def test_invite_self_400(self, s, room, demo_token, demo_user):
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": demo_user["id"], "seat_index": 1},
            headers=_auth(demo_token),
            timeout=15,
        )
        # 400 for 'cannot invite self' OR 400 for 'already on a seat' (owner is on seat 0).
        assert r.status_code == 400, r.text

    def test_invite_invalid_seat(self, s, room, demo_token, target_user):
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": target_user["id"], "seat_index": 99},
            headers=_auth(demo_token),
            timeout=15,
        )
        # pydantic: seat_index bound is 0..20 → 422; server also rejects out-of-range → 400
        assert r.status_code in (400, 422), r.text

    def test_invite_seat_occupied_returns_409(self, s, room, demo_token, target_user):
        """Seat 0 is owner-occupied → 409."""
        r = s.post(
            f"{BASE_URL}/api/rooms/{room['id']}/mic-invite",
            json={"target_user_id": target_user["id"], "seat_index": 0},
            headers=_auth(demo_token),
            timeout=15,
        )
        assert r.status_code == 409, r.text


# ==================================================================
# 2. FULL flow via live WS: send → seat still empty → accept/reject
# ==================================================================
class TestMicInviteFullFlow:
    """Uses websockets to populate presence for the target user."""

    def test_invite_accept_seats_target(self, s, room, demo_token, target_user):
        room_id = room["id"]

        async def _flow():
            ws = await _ws_connect(room_id, target_user["token"])
            try:
                # Give backend a moment to register presence.
                await asyncio.sleep(0.3)

                # 1) Owner sends invite → response shape check + seat still empty.
                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": target_user["id"], "seat_index": 2},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 200, inv.text
                body = inv.json()
                assert body.get("ok") is True
                assert body.get("seat_index") == 2
                assert body.get("target_user_id") == target_user["id"]
                assert body.get("expires_in_s") == 60

                # Seat 2 must NOT be filled yet (real invitation, no force-seat).
                r = _get_room(s, demo_token, room_id)
                seats = r.get("seats") or []
                assert seats[2].get("user") is None, f"seat 2 was force-filled: {seats[2]}"

                # 2) Target accepts.
                acc = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc.status_code == 200, acc.text

                # Seat 2 is now filled by target — verified via GET.
                r = _get_room(s, demo_token, room_id)
                seats = r.get("seats") or []
                assert seats[2].get("user") is not None, "seat 2 empty after accept"
                assert seats[2]["user"].get("id") == target_user["id"]

                # 3) Idempotency — second accept returns 404.
                acc2 = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc2.status_code == 404, acc2.text
            finally:
                await ws.close()

        _run(_flow())

    def test_invite_reject_leaves_seat_empty(self, s, room, demo_token, target_user):
        room_id = room["id"]

        async def _flow():
            # Vacate seat 2 (target should now be on seat 2 from prior test → move them off).
            # Owner uses mic-change-seat from 2 to 3, then leaves them on 3.
            r = _get_room(s, demo_token, room_id)
            seats = r.get("seats") or []
            # If target still on seat 2, move to seat 3 to clear seat 2 for this test.
            if seats[2].get("user") and seats[2]["user"].get("id") == target_user["id"]:
                mv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-change-seat",
                    json={"from_index": 2, "to_index": 3},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert mv.status_code == 200, mv.text
            # We now need target OFF ALL SEATS for a new invite.
            # Kick them via seat-action (they'll leave).
            r = _get_room(s, demo_token, room_id)
            seats = r.get("seats") or []
            for idx, seat in enumerate(seats):
                if seat.get("user") and seat["user"].get("id") == target_user["id"]:
                    ka = s.post(
                        f"{BASE_URL}/api/rooms/{room_id}/seat-action",
                        json={"seat_index": idx, "action": "kick_seat"},
                        headers=_auth(demo_token),
                        timeout=15,
                    )
                    assert ka.status_code in (200, 201), ka.text
                    break

            ws = await _ws_connect(room_id, target_user["token"])
            try:
                await asyncio.sleep(0.3)
                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": target_user["id"], "seat_index": 4},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 200, inv.text

                # Reject.
                rej = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/reject",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert rej.status_code == 200, rej.text
                assert rej.json().get("ok") is True

                # Seat 4 remains empty.
                r = _get_room(s, demo_token, room_id)
                seats = r.get("seats") or []
                assert seats[4].get("user") is None

                # Idempotent reject.
                rej2 = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/reject",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert rej2.status_code == 200, rej2.text
                assert rej2.json().get("ok") is True

                # Accept without pending → 404.
                acc = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc.status_code == 404, acc.text
            finally:
                await ws.close()

        _run(_flow())

    def test_reject_without_pending_is_idempotent(self, s, room, target_user):
        """Fresh target with no invite → reject still returns 200 {ok:true}."""
        room_id = room["id"]
        r = s.post(
            f"{BASE_URL}/api/rooms/{room_id}/mic-invite/reject",
            headers=_auth(target_user["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ==================================================================
# 3. 'Someone else took the seat' race → 409 on accept + invite cleared
# ==================================================================
class TestMicInviteSeatRace:
    def test_accept_when_seat_taken_returns_409(self, s, room, demo_token, target_user, other_user):
        room_id = room["id"]

        async def _flow():
            # Make sure seat 5 is empty first.
            r = _get_room(s, demo_token, room_id)
            seats = r.get("seats") or []
            assert seats[5].get("user") is None, f"precondition failed: seat 5 taken: {seats[5]}"

            ws_target = await _ws_connect(room_id, target_user["token"])
            ws_other = await _ws_connect(room_id, other_user["token"])
            try:
                await asyncio.sleep(0.3)
                # Invite target to seat 5.
                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": target_user["id"], "seat_index": 5},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 200, inv.text

                # OTHER user grabs seat 5 first (via /rooms/{id}/seats/take).
                grab = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/seats/take",
                    json={"seat_index": 5},
                    headers=_auth(other_user["token"]),
                    timeout=15,
                )
                assert grab.status_code in (200, 201), grab.text

                # Target accepts → 409 seat occupied.
                acc = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc.status_code == 409, acc.text

                # Invite is cleared: a subsequent accept → 404.
                acc2 = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc2.status_code == 404, acc2.text

                # Cleanup: 'other' leaves seat 5.
                s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/seats/leave",
                    headers=_auth(other_user["token"]),
                    timeout=15,
                )
            finally:
                await ws_target.close()
                await ws_other.close()

        _run(_flow())


# ==================================================================
# 4. Target already on a seat → 400 'already on a mic'
# ==================================================================
class TestMicInviteTargetAlreadySeated:
    def test_invite_when_target_already_seated_returns_400(self, s, room, demo_token, other_user):
        room_id = room["id"]

        async def _flow():
            ws = await _ws_connect(room_id, other_user["token"])
            try:
                await asyncio.sleep(0.3)
                # Seat 'other' at index 6 via public /seats/take.
                grab = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/seats/take",
                    json={"seat_index": 6},
                    headers=_auth(other_user["token"]),
                    timeout=15,
                )
                assert grab.status_code in (200, 201), grab.text

                # Now owner tries to invite them to seat 7 → 400.
                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": other_user["id"], "seat_index": 7},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 400, inv.text

                # Cleanup: other leaves seat 6.
                s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/seats/leave",
                    headers=_auth(other_user["token"]),
                    timeout=15,
                )
            finally:
                await ws.close()

        _run(_flow())


# ==================================================================
# 5. mic-change-seat regression (unchanged behavior)
# ==================================================================
class TestMicChangeSeat:
    def test_change_seat_owner_only(self, s, room, demo_token, target_user, normie_user):
        room_id = room["id"]

        async def _flow():
            # Seat the target on seat 1 via invite→accept.
            ws = await _ws_connect(room_id, target_user["token"])
            try:
                await asyncio.sleep(0.3)
                # Ensure seat 1 is empty; if not, move current occupant off.
                r = _get_room(s, demo_token, room_id)
                seats = r.get("seats") or []
                if seats[1].get("user"):
                    # target may still be on seat from previous test — kick them.
                    for idx, seat in enumerate(seats):
                        if seat.get("user") and seat["user"].get("id") == target_user["id"]:
                            s.post(
                                f"{BASE_URL}/api/rooms/{room_id}/seat-action",
                                json={"seat_index": idx, "action": "kick_seat"},
                                headers=_auth(demo_token),
                                timeout=15,
                            )

                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": target_user["id"], "seat_index": 1},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 200, inv.text
                acc = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc.status_code == 200, acc.text

                # normie cannot change seat.
                bad = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-change-seat",
                    json={"from_index": 1, "to_index": 8},
                    headers=_auth(normie_user["token"]),
                    timeout=15,
                )
                assert bad.status_code == 403, bad.text

                # Owner moves 1 → 8 (seat 8 empty).
                mv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-change-seat",
                    json={"from_index": 1, "to_index": 8},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert mv.status_code == 200, mv.text

                r = _get_room(s, demo_token, room_id)
                seats = r.get("seats") or []
                assert seats[1].get("user") is None
                assert seats[8].get("user") is not None
                assert seats[8]["user"].get("id") == target_user["id"]

                # Try moving to occupied → 409 (seat 0 is owner).
                mv2 = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-change-seat",
                    json={"from_index": 8, "to_index": 0},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                # to_index == 0 is host chair (occupied by owner) → 409 (occupied)
                # OR 403 (host chair restricted to owner/mod). Both are acceptable rejections.
                assert mv2.status_code in (403, 409), mv2.text
            finally:
                await ws.close()

        _run(_flow())


# ==================================================================
# 6. Regression: iter-33 follow / block / report suite
# ==================================================================
class TestIter33Regression:
    def test_follow_then_unfollow(self, s, target_user, other_user):
        # cleanup
        s.delete(f"{BASE_URL}/api/users/{other_user['id']}/follow", headers=_auth(target_user["token"]), timeout=15)
        r = s.post(f"{BASE_URL}/api/users/{other_user['id']}/follow", headers=_auth(target_user["token"]), timeout=15)
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"following": True}
        r = s.delete(f"{BASE_URL}/api/users/{other_user['id']}/follow", headers=_auth(target_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json() == {"following": False}

    def test_block_then_unblock(self, s, target_user, other_user):
        r = s.post(f"{BASE_URL}/api/users/{other_user['id']}/block", headers=_auth(target_user["token"]), timeout=15)
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"blocked": True}
        r = s.delete(f"{BASE_URL}/api/users/{other_user['id']}/block", headers=_auth(target_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json() == {"blocked": False}

    def test_report_persists(self, s, target_user, other_user):
        r = s.post(
            f"{BASE_URL}/api/users/{other_user['id']}/report",
            json={"reason": "spam", "details": "iter34 regression"},
            headers=_auth(target_user["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("reported") is True
        assert isinstance(d.get("id"), str) and len(d["id"]) == 24


# ==================================================================
# 7. TTL expiry — after 60s pending accept → 404, reject → 200
#    Marked slow; can be de-selected with `-m "not slow"`.
# ==================================================================
@pytest.mark.slow
class TestMicInviteTTL:
    def test_ttl_expires_after_60s(self, s, room, demo_token, target_user):
        room_id = room["id"]

        async def _flow():
            # Ensure target off all seats before inviting.
            r = _get_room(s, demo_token, room_id)
            seats = r.get("seats") or []
            for idx, seat in enumerate(seats):
                if seat.get("user") and seat["user"].get("id") == target_user["id"]:
                    s.post(
                        f"{BASE_URL}/api/rooms/{room_id}/seat-action",
                        json={"seat_index": idx, "action": "kick_seat"},
                        headers=_auth(demo_token),
                        timeout=15,
                    )
                    break

            ws = await _ws_connect(room_id, target_user["token"])
            try:
                await asyncio.sleep(0.3)
                inv = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
                    json={"target_user_id": target_user["id"], "seat_index": 2},
                    headers=_auth(demo_token),
                    timeout=15,
                )
                assert inv.status_code == 200, inv.text
                # Wait for TTL (60s) + 2s buffer.
                await asyncio.sleep(62)

                # Accept → 404 (expired).
                acc = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/accept",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert acc.status_code == 404, acc.text

                # Reject → 200 idempotent.
                rej = s.post(
                    f"{BASE_URL}/api/rooms/{room_id}/mic-invite/reject",
                    headers=_auth(target_user["token"]),
                    timeout=15,
                )
                assert rej.status_code == 200
                assert rej.json().get("ok") is True
            finally:
                await ws.close()

        _run(_flow())
