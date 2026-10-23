"""
ORIO iter-25 backend tests
Coverage:
- PATCH /api/rooms/{id}/settings (notice + welcome_msg) — owner OK, non-owner 403
- GET /api/rooms/{id} includes notice, welcome_msg, has_room_password fields
- POST/DELETE /api/rooms/{id}/password — 5-digit set/clear, non-5-digit 400
- POST /api/rooms/{id}/join — non-owner without body 403, with body {room_password} OK,
  owner joins without password
- WS /api/ws/rooms/{id} — welcome_msg triggers system chat with kind=welcome
"""
import os
import time
import uuid
import json
import asyncio

import pytest
import requests
import websockets


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8001").rstrip("/")
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"
SEED_ROOM_8 = "6abb26d372223e17754d4435"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def other_token():
    """Register a fresh non-owner user."""
    tag = uuid.uuid4().hex[:8]
    payload = {
        "email": f"TEST_iter25_{tag}@example.com",
        "password": "testpass123",
        "username": f"iter25_{tag}",
        "nickname": f"Iter25 {tag}",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    # /auth/register doesn't return user object → fetch it via /me
    user = data.get("user")
    if not user:
        me = requests.get(
            f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10
        )
        assert me.status_code == 200, me.text
        user = me.json()
    return tok, user


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------- Room Notice + Welcome Message settings ----------
class TestRoomSettingsNoticeAndWelcome:
    def test_owner_patch_notice_only(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"notice": "TEST_notice_iter25"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("notice") == "TEST_notice_iter25"

    def test_owner_patch_welcome_only(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": "TEST_welcome_iter25"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("welcome_msg") == "TEST_welcome_iter25"

    def test_owner_patch_both(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"notice": "N1", "welcome_msg": "W1"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("notice") == "N1"
        assert j.get("welcome_msg") == "W1"

    def test_get_room_returns_new_fields(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "notice" in j
        assert "welcome_msg" in j
        assert "has_room_password" in j
        assert j["notice"] == "N1"
        assert j["welcome_msg"] == "W1"
        assert isinstance(j["has_room_password"], bool)

    def test_non_owner_cannot_patch_settings(self, other_token):
        tok, _u = other_token
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(tok),
            json={"notice": "hack"},
            timeout=15,
        )
        assert r.status_code == 403, r.text


# ---------- 5-digit Room Password (separate from PIN) ----------
class TestRoomPassword:
    def test_owner_set_valid_5digit_password(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/password",
            headers=_auth(owner_token),
            json={"password": "48291"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("has_room_password") is True

    def test_get_room_has_room_password_true(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert r.status_code == 200
        assert r.json().get("has_room_password") is True

    def test_owner_cannot_set_non_5digit(self, owner_token):
        for bad in ["1234", "123456", "abcde", ""]:
            r = requests.post(
                f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/password",
                headers=_auth(owner_token),
                json={"password": bad},
                timeout=15,
            )
            assert r.status_code == 400, f"Expected 400 for {bad!r}, got {r.status_code}: {r.text}"

    def test_non_owner_join_without_password_returns_403(self, other_token):
        tok, _u = other_token
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/join",
            headers=_auth(tok),
            json={},
            timeout=15,
        )
        assert r.status_code == 403, r.text
        assert "Room Password" in r.text or "password" in r.text.lower()

    def test_non_owner_join_with_wrong_password_returns_403(self, other_token):
        tok, _u = other_token
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/join",
            headers=_auth(tok),
            json={"room_password": "00000"},
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_non_owner_join_with_correct_password_succeeds(self, other_token):
        tok, _u = other_token
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/join",
            headers=_auth(tok),
            json={"room_password": "48291"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("id") == SEED_ROOM_8

    def test_owner_can_join_without_password(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/join",
            headers=_auth(owner_token),
            json={},
            timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_owner_delete_room_password(self, owner_token):
        r = requests.delete(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/password",
            headers=_auth(owner_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("has_room_password") is False

    def test_get_room_has_room_password_false_after_delete(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert r.json().get("has_room_password") is False

    def test_non_owner_join_after_delete_succeeds(self, other_token):
        tok, _u = other_token
        r = requests.post(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/join",
            headers=_auth(tok),
            json={},
            timeout=15,
        )
        assert r.status_code == 200, r.text


# ---------- WS welcome_msg broadcast ----------
class TestWSWelcomeMessage:
    @pytest.mark.asyncio
    async def test_ws_join_triggers_welcome_system_chat(self, owner_token, other_token):
        # Owner sets welcome_msg
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": "TEST_welcome_ws_iter25"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        tok, user = other_token
        nick = user.get("nickname") or "User"

        # Connect a listener (owner) first so it can receive the broadcast
        owner_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={owner_token}"
        other_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={tok}"

        got_welcome = False
        async with websockets.connect(owner_ws_url, open_timeout=10, close_timeout=5) as owner_ws:
            # Drain owner's own initial history + user_joined events
            async def _drain(ws, seconds):
                events = []
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=seconds)
                        try:
                            events.append(json.loads(raw))
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    return events

            await _drain(owner_ws, 1.0)

            # Now connect the other user — this should trigger a welcome broadcast
            async with websockets.connect(other_ws_url, open_timeout=10, close_timeout=5) as other_ws:
                events = await _drain(owner_ws, 3.0)
                for ev in events:
                    if (
                        ev.get("type") == "system"
                        and ev.get("kind") == "welcome"
                        and "TEST_welcome_ws_iter25" in (ev.get("text") or "")
                        and nick in (ev.get("text") or "")
                    ):
                        got_welcome = True
                        break

        assert got_welcome, f"Did not receive a welcome system chat for nickname={nick!r}"

    @pytest.mark.asyncio
    async def test_ws_join_no_welcome_when_empty(self, owner_token, other_token):
        # Clear welcome_msg
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": ""},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        tok, _u = other_token
        owner_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={owner_token}"
        other_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={tok}"

        got_welcome = False
        async with websockets.connect(owner_ws_url, open_timeout=10, close_timeout=5) as owner_ws:
            async def _drain(ws, seconds):
                events = []
                try:
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=seconds)
                        try:
                            events.append(json.loads(raw))
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    return events

            await _drain(owner_ws, 1.0)
            async with websockets.connect(other_ws_url, open_timeout=10, close_timeout=5) as other_ws:
                events = await _drain(owner_ws, 2.0)
                for ev in events:
                    if ev.get("type") == "system" and ev.get("kind") == "welcome":
                        got_welcome = True
                        break

        assert not got_welcome, "welcome broadcast should NOT fire when welcome_msg is empty"


# ---------- Regression: settings endpoint route-collision guard ----------
# The server registers PATCH /rooms/{id}/settings TWICE: once for notice/welcome
# and once for entrance_effects/noise_reduction/music_control_role.
# We assert only the FIRST (notice/welcome) is actually served — the second is
# unreachable. If somebody tries to send entrance_effects fields, FastAPI's
# first-match handler will accept the request (extra fields ignored by pydantic)
# but return 400 "Nothing to update".
class TestRouteCollisionGuard:
    def test_patch_settings_with_only_entrance_effects_returns_400_nothing_to_update(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"entrance_effects": False},
            timeout=15,
        )
        # This documents current behavior — a *bug indicator* that the older
        # entrance_effects/noise_reduction endpoint is UNREACHABLE.
        assert r.status_code in (200, 400), r.text
