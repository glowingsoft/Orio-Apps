"""
ORIO backend regression tests — new endpoints only.

Covers:
- /api/rtc/config, /api/rtc/token
- /api/auth/google/session (invalid path)
- Blue Envelopes: create, list, claim (dup / self)
- Room Moderation: mute/unmute/lock/kick/unauthorized
- Post Comments: create + list
- Room chat REST fallback
- WebSocket room: ping/pong, chat echo, auth failure

Run:
  pytest /app/backend/tests/test_orio_new_endpoints.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results.xml
"""

from __future__ import annotations

import json
import secrets
import time
import uuid
from typing import Any, Optional

import pytest
import requests
import websockets


# ---------- helpers ----------

def _rand_suffix(n: int = 8) -> str:
    return secrets.token_hex(n // 2)


def _register(base_url: str) -> dict[str, Any]:
    """Register a fresh user; return dict(access_token, refresh_token, email, username, user_id)."""
    suf = _rand_suffix(8)
    email = f"test_{suf}@voiceup.app"
    username = f"testu_{suf}"
    payload = {
        "email": email,
        "password": "TestPass1234",
        "username": username,
        "nickname": f"T{suf[:6]}",
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, f"register failed: {r.status_code} {r.text}"
    tok = r.json()
    # get user_id via /auth/me
    me = requests.get(
        f"{base_url}/api/auth/me",
        headers={"Authorization": f"Bearer {tok['access_token']}"},
        timeout=15,
    )
    assert me.status_code == 200, me.text
    return {
        **tok,
        "email": email,
        "username": username,
        "user_id": me.json().get("id"),
        "me": me.json(),
    }


def _auth(tok: dict) -> dict:
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _create_room(base_url: str, tok: dict, name: str = "OrioTestRoom") -> str:
    payload = {
        "name": f"{name}-{_rand_suffix(4)}",
        "description": "test room",
        "category": "general",
        "num_seats": 8,
        "max_users": 50,
        "is_private": False,
    }
    r = requests.post(f"{base_url}/api/rooms", json=payload, headers=_auth(tok), timeout=15)
    assert r.status_code == 201, f"create_room failed: {r.status_code} {r.text}"
    room = r.json()
    assert "id" in room, room
    return room["id"]


# ---------- session-scoped users / room ----------

@pytest.fixture(scope="module")
def sender(base_url):
    """Fresh user1 (room owner + envelope sender). Starts with 10 diamonds."""
    return _register(base_url)


@pytest.fixture(scope="module")
def receiver(base_url):
    """Fresh user2 (envelope claimer). Starts with 10 diamonds."""
    return _register(base_url)


@pytest.fixture(scope="module")
def outsider(base_url):
    """Fresh user3 (non-owner, non-mod) used for moderation 403 check."""
    return _register(base_url)


@pytest.fixture(scope="module")
def room_id(base_url, sender):
    return _create_room(base_url, sender)


# =============================================================
# 1) GET /api/rtc/config
# =============================================================
class TestRtcConfig:
    def test_rtc_config_returns_status(self, base_url):
        """Agora config: enabled when APP_ID env is set, disabled otherwise."""
        t0 = time.perf_counter()
        r = requests.get(f"{base_url}/api/rtc/config", timeout=15)
        dt = (time.perf_counter() - t0) * 1000
        print(f"[rtc/config] {r.status_code} in {dt:.0f}ms body={r.text}")
        assert r.status_code == 200
        body = r.json()
        assert "enabled" in body and "app_id" in body, body
        if body.get("enabled"):
            assert body.get("app_id"), body
        else:
            assert body.get("app_id") in (None, ""), body


# =============================================================
# 2) POST /api/rtc/token — 200 with token when configured, 503 otherwise
# =============================================================
class TestRtcToken:
    def test_rtc_token_shape(self, base_url, sender):
        cfg = requests.get(f"{base_url}/api/rtc/config", timeout=15).json()
        t0 = time.perf_counter()
        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": "orio_test", "uid": 1234},
            headers=_auth(sender),
            timeout=15,
        )
        dt = (time.perf_counter() - t0) * 1000
        print(f"[rtc/token] {r.status_code} in {dt:.0f}ms body={r.text[:200]}")
        if cfg.get("enabled"):
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("token"), body
        else:
            assert r.status_code == 503, f"expected 503 when disabled, got {r.status_code}: {r.text}"


# =============================================================
# 3) POST /api/auth/google/session with invalid session
# =============================================================
class TestGoogleSession:
    def test_invalid_session_returns_401(self, base_url):
        t0 = time.perf_counter()
        r = requests.post(
            f"{base_url}/api/auth/google/session",
            json={"session_id": "invalid_" + _rand_suffix(24)},
            timeout=20,
        )
        dt = (time.perf_counter() - t0) * 1000
        print(f"[auth/google/session] {r.status_code} in {dt:.0f}ms body={r.text[:200]}")
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"
        body = r.json()
        assert "Invalid or expired Google session" in json.dumps(body), body


# =============================================================
# 4-8) Blue Envelopes end-to-end
# =============================================================
class TestEnvelopes:
    env_id: Optional[str] = None
    claim_amount: int = 0

    def test_4_create_envelope(self, base_url, sender, room_id):
        # sender should currently have 10 diamonds (fresh account)
        me = requests.get(f"{base_url}/api/auth/me", headers=_auth(sender), timeout=15).json()
        assert me.get("diamonds") == 10, me
        t0 = time.perf_counter()
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/envelopes",
            json={"amount": 10, "slots": 2, "message": "Test"},
            headers=_auth(sender),
            timeout=15,
        )
        dt = (time.perf_counter() - t0) * 1000
        print(f"[envelopes create] {r.status_code} in {dt:.0f}ms body={r.text[:200]}")
        assert r.status_code == 201, f"expected 201, got {r.status_code}: {r.text}"
        body = r.json()
        assert "env_id" in body and body.get("amount") == 10 and body.get("slots") == 2, body
        TestEnvelopes.env_id = body["env_id"]

        # verify diamonds decreased by 10
        me2 = requests.get(f"{base_url}/api/auth/me", headers=_auth(sender), timeout=15).json()
        assert me2.get("diamonds") == 0, f"expected 0, got {me2.get('diamonds')}"

    def test_5_list_envelopes(self, base_url, sender, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/envelopes",
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[envelopes list] {r.status_code} body={r.text[:300]}")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        found = next((e for e in arr if e["env_id"] == TestEnvelopes.env_id), None)
        assert found is not None, arr
        assert found.get("claimed_by_me") is False, found

    def test_6_claim_by_receiver(self, base_url, receiver):
        me_before = requests.get(f"{base_url}/api/auth/me", headers=_auth(receiver), timeout=15).json()
        before = int(me_before.get("diamonds", 0))
        t0 = time.perf_counter()
        r = requests.post(
            f"{base_url}/api/envelopes/{TestEnvelopes.env_id}/claim",
            headers=_auth(receiver),
            timeout=15,
        )
        dt = (time.perf_counter() - t0) * 1000
        print(f"[envelope claim r2] {r.status_code} in {dt:.0f}ms body={r.text[:200]}")
        assert r.status_code == 200, r.text
        got = r.json()
        assert got.get("ok") is True and 1 <= int(got.get("amount", 0)) <= 10, got
        TestEnvelopes.claim_amount = int(got["amount"])

        me_after = requests.get(f"{base_url}/api/auth/me", headers=_auth(receiver), timeout=15).json()
        assert int(me_after.get("diamonds", 0)) == before + TestEnvelopes.claim_amount, (
            f"before={before} after={me_after.get('diamonds')} amount={TestEnvelopes.claim_amount}"
        )

    def test_7_claim_again_by_same_user_conflict(self, base_url, receiver):
        r = requests.post(
            f"{base_url}/api/envelopes/{TestEnvelopes.env_id}/claim",
            headers=_auth(receiver),
            timeout=15,
        )
        print(f"[envelope claim dup] {r.status_code} body={r.text[:200]}")
        assert r.status_code == 409, r.text
        assert "Already claimed" in json.dumps(r.json())

    def test_8_claim_own_envelope_forbidden(self, base_url, sender):
        r = requests.post(
            f"{base_url}/api/envelopes/{TestEnvelopes.env_id}/claim",
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[envelope claim self] {r.status_code} body={r.text[:200]}")
        assert r.status_code == 400, r.text
        assert "cannot claim your own envelope" in json.dumps(r.json()).lower()


# =============================================================
# 9) Room Moderation
# =============================================================
class TestModeration:
    def test_9a_mute_seat(self, base_url, sender, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/moderate",
            json={"action": "mute_seat", "seat_index": 0},
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[moderate mute] {r.status_code} body={r.text[:300]}")
        assert r.status_code == 200, r.text
        seats = r.json().get("seats", [])
        assert seats[0].get("muted") is True, seats[0]

    def test_9b_unmute_seat(self, base_url, sender, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/moderate",
            json={"action": "unmute_seat", "seat_index": 0},
            headers=_auth(sender),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        seats = r.json().get("seats", [])
        assert seats[0].get("muted") is False

    def test_9c_lock_seat(self, base_url, sender, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/moderate",
            json={"action": "lock_seat", "seat_index": 1},
            headers=_auth(sender),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        seats = r.json().get("seats", [])
        assert seats[1].get("locked") is True, seats[1]

    def test_9d_kick_owner_forbidden(self, base_url, sender, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/moderate",
            json={"action": "kick_seat", "seat_index": 0},
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[moderate kick owner] {r.status_code} body={r.text[:200]}")
        assert r.status_code == 403, r.text
        assert "Cannot kick the owner" in json.dumps(r.json())

    def test_9e_non_owner_forbidden(self, base_url, outsider, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/moderate",
            json={"action": "mute_seat", "seat_index": 0},
            headers=_auth(outsider),
            timeout=15,
        )
        print(f"[moderate non-owner] {r.status_code} body={r.text[:200]}")
        assert r.status_code == 403, r.text
        assert "Only owner or moderator" in json.dumps(r.json())


# =============================================================
# 10-11) Post Comments
# =============================================================
class TestPostComments:
    post_id: Optional[str] = None
    comment_text: str = f"unit-test-comment-{uuid.uuid4().hex[:6]}"

    def test_10_create_post_and_comment(self, base_url, sender):
        rp = requests.post(
            f"{base_url}/api/posts",
            json={"text": "orio test post " + _rand_suffix(4)},
            headers=_auth(sender),
            timeout=15,
        )
        assert rp.status_code == 201, rp.text
        post = rp.json()
        assert "id" in post, post
        TestPostComments.post_id = post["id"]

        rc = requests.post(
            f"{base_url}/api/posts/{TestPostComments.post_id}/comments",
            json={"text": TestPostComments.comment_text},
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[post comment create] {rc.status_code} body={rc.text[:300]}")
        assert rc.status_code == 201, rc.text
        body = rc.json()
        assert body.get("text") == TestPostComments.comment_text
        assert body.get("post_id") == TestPostComments.post_id

    def test_11_list_comments(self, base_url, sender):
        r = requests.get(
            f"{base_url}/api/posts/{TestPostComments.post_id}/comments",
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[post comment list] {r.status_code} body={r.text[:300]}")
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        assert any(c.get("text") == TestPostComments.comment_text for c in arr), arr


# =============================================================
# 12) Room chat REST fallback (empty)
# =============================================================
class TestRoomChatHistory:
    def test_room_chat_empty(self, base_url, sender, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/chat",
            headers=_auth(sender),
            timeout=15,
        )
        print(f"[rooms chat] {r.status_code} body={r.text[:200]}")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        # Should be empty prior to any WS chat
        assert r.json() == [], r.json()


# =============================================================
# 13) WebSocket smoke test (ping+chat)
# =============================================================
@pytest.mark.asyncio
async def test_13_ws_ping_and_chat(ws_base, base_url, sender, room_id):
    url = f"{ws_base}/api/ws/rooms/{room_id}?token={sender['access_token']}"
    print(f"[ws connect] {url[:80]}...")
    async with websockets.connect(url, open_timeout=15, close_timeout=5) as ws:
        # server pushes user_joined first; drain any non-pong frames
        got_pong = False
        got_chat_echo = False

        await ws.send(json.dumps({"type": "ping"}))
        # ping/pong
        for _ in range(6):
            raw = await asyncio_wait(ws, 5)
            msg = json.loads(raw)
            print(f"[ws recv] {msg}")
            if msg.get("type") == "pong":
                got_pong = True
                break
        assert got_pong, "did not receive pong"

        await ws.send(json.dumps({"type": "chat", "text": "hello WS"}))
        for _ in range(6):
            raw = await asyncio_wait(ws, 5)
            msg = json.loads(raw)
            print(f"[ws recv] {msg}")
            if msg.get("type") == "chat" and msg.get("text") == "hello WS":
                assert msg.get("user", {}).get("id") == sender["user_id"], msg
                got_chat_echo = True
                break
        assert got_chat_echo, "did not receive chat broadcast echo"


async def asyncio_wait(ws, timeout):
    import asyncio
    return await asyncio.wait_for(ws.recv(), timeout=timeout)


# =============================================================
# 14) WebSocket auth failure -> close 4401 (or handshake rejection)
# =============================================================
@pytest.mark.asyncio
async def test_14_ws_auth_failure(ws_base, room_id):
    # Case A: invalid token
    url_bad = f"{ws_base}/api/ws/rooms/{room_id}?token=invalid.token.value"
    closed_code: Optional[int] = None
    handshake_rejected = False
    try:
        async with websockets.connect(url_bad, open_timeout=10, close_timeout=5) as ws:
            try:
                # Server should close 4401 immediately after accepting-and-closing (or during)
                await asyncio_wait(ws, 5)
            except Exception:
                pass
            closed_code = getattr(ws, "close_code", None)
    except websockets.exceptions.InvalidStatus as e:
        handshake_rejected = True
        print(f"[ws bad-token] handshake rejected with status={e}")
    except websockets.exceptions.InvalidStatusCode as e:  # older API
        handshake_rejected = True
        print(f"[ws bad-token] handshake rejected code={e.status_code}")
    except websockets.exceptions.ConnectionClosed as e:
        closed_code = e.code
        print(f"[ws bad-token] closed code={e.code}")

    print(f"[ws bad-token] closed_code={closed_code} handshake_rejected={handshake_rejected}")
    assert handshake_rejected or closed_code == 4401, (
        f"expected 4401 close or handshake rejection, got code={closed_code}"
    )

    # Case B: missing token (FastAPI rejects with 403 pre-accept)
    url_missing = f"{ws_base}/api/ws/rooms/{room_id}"
    handshake_rejected_b = False
    closed_code_b: Optional[int] = None
    try:
        async with websockets.connect(url_missing, open_timeout=10, close_timeout=5):
            pass
    except websockets.exceptions.InvalidStatus:
        handshake_rejected_b = True
    except websockets.exceptions.InvalidStatusCode:
        handshake_rejected_b = True
    except websockets.exceptions.ConnectionClosed as e:
        closed_code_b = e.code

    print(f"[ws no-token] handshake_rejected={handshake_rejected_b} closed_code={closed_code_b}")
    assert handshake_rejected_b or closed_code_b in (4401, 1006), (
        f"expected handshake rejection or 4401, got code={closed_code_b}"
    )
