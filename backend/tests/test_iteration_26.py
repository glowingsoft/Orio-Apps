"""
ORIO iter-26 backend tests — focused on the surgical additions/changes.

Under test:
  1. GET  /api/rooms/managed              — rooms current user moderates but does not own
  2. GET  /api/rooms/mine                 — up to 50 rooms (list limit change)
  3. PATCH /api/rooms/{id}/settings       — merged handler (notice/welcome/legacy toggles)
  4. WS   /api/ws/rooms/{id}?token=...     — welcome broadcast now includes user_id + nickname + welcome_msg
  5. WS disconnect auto-vacates any seat the user was on
  6. GET  /api/rooms/{id}                 — public_room exposes notice / welcome_msg / has_room_password
"""

import asyncio
import json
import os
import time
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_BACKEND_URL_TEST") or "http://localhost:8001"
API = BASE_URL.rstrip("/") + "/api"
WS_BASE = (BASE_URL.rstrip("/")
           .replace("https://", "wss://")
           .replace("http://", "ws://")) + "/api"


# ------------------------------- fixtures ---------------------------------

@pytest.fixture(scope="module")
def demo_token() -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"email": "demo@voiceup.app", "password": "demo1234"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_user(demo_headers):
    r = requests.get(f"{API}/auth/me", headers=demo_headers, timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def second_user():
    """Register a throw-away user for non-owner / mod / joiner flows."""
    ts = int(time.time() * 1000)
    email = f"TEST_iter26_{ts}@example.com"
    username = f"iter26_{ts}"[:20]
    payload = {"email": email, "password": "pass1234", "username": username,
               "nickname": f"Iter26 U {ts}"}
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    tok = body["access_token"]
    me = requests.get(f"{API}/auth/me",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
    return {"token": tok, "user": me,
            "headers": {"Authorization": f"Bearer {tok}",
                        "Content-Type": "application/json"}}


@pytest.fixture(scope="module")
def seed_room(demo_headers) -> dict:
    """Grab the first seeded 8-seat room owned by demo (used across the suite)."""
    r = requests.get(f"{API}/rooms", headers=demo_headers, timeout=15)
    assert r.status_code == 200
    rooms = r.json()
    # prefer 8-seat seeded room owned by demo
    demo_id = requests.get(f"{API}/auth/me", headers=demo_headers, timeout=15).json()["id"]
    for rm in rooms:
        if rm.get("owner_id") == demo_id and int(rm.get("num_seats") or 0) == 8:
            return rm
    # fallback: any seeded room owned by demo
    for rm in rooms:
        if rm.get("owner_id") == demo_id:
            return rm
    pytest.skip("No demo-owned seed room found")


# ------------------------- /rooms/mine & /rooms/managed --------------------

class TestRoomsMineAndManaged:
    def test_rooms_mine_returns_owned(self, demo_headers, demo_user):
        r = requests.get(f"{API}/rooms/mine", headers=demo_headers, timeout=15)
        assert r.status_code == 200
        rooms = r.json()
        assert isinstance(rooms, list)
        # all rooms must have owner_id == demo user id
        for rm in rooms:
            assert rm["owner_id"] == demo_user["id"], f"non-owned room leaked: {rm}"
        # limit should be up to 50 (iter-26 raised from 20)
        assert len(rooms) <= 50

    def test_rooms_managed_endpoint_exists(self, demo_headers):
        r = requests.get(f"{API}/rooms/managed", headers=demo_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_rooms_managed_excludes_owned(self, demo_headers, demo_user):
        r = requests.get(f"{API}/rooms/managed", headers=demo_headers, timeout=15)
        assert r.status_code == 200
        rooms = r.json()
        assert isinstance(rooms, list)
        for rm in rooms:
            assert rm["owner_id"] != demo_user["id"]
        assert len(rooms) <= 50

    def test_rooms_managed_second_user_empty_initially(self, second_user):
        r = requests.get(f"{API}/rooms/managed", headers=second_user["headers"], timeout=15)
        assert r.status_code == 200
        # A freshly-registered user has no moderated rooms
        assert r.json() == []

    def test_rooms_mine_requires_auth(self):
        r = requests.get(f"{API}/rooms/mine", timeout=15)
        assert r.status_code in (401, 403)

    def test_rooms_managed_requires_auth(self):
        r = requests.get(f"{API}/rooms/managed", timeout=15)
        assert r.status_code in (401, 403)


# ------------------------- public_room shape ------------------------------

class TestPublicRoomShape:
    def test_get_room_exposes_notice_welcome_password_flag(self, demo_headers, seed_room):
        r = requests.get(f"{API}/rooms/{seed_room['id']}", headers=demo_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "notice" in data
        assert "welcome_msg" in data
        assert "has_room_password" in data
        assert isinstance(data["notice"], str)
        assert isinstance(data["welcome_msg"], str)
        assert isinstance(data["has_room_password"], bool)


# ------------------------- PATCH /rooms/{id}/settings ---------------------

class TestRoomSettingsMerged:
    def test_notice_partial_update(self, demo_headers, seed_room):
        r = requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                           headers=demo_headers,
                           json={"notice": "TEST_iter26 notice"}, timeout=15)
        assert r.status_code == 200, r.text
        # verify via GET
        g = requests.get(f"{API}/rooms/{seed_room['id']}", headers=demo_headers, timeout=15).json()
        assert g["notice"] == "TEST_iter26 notice"

    def test_welcome_msg_partial_update(self, demo_headers, seed_room):
        r = requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                           headers=demo_headers,
                           json={"welcome_msg": "TEST_iter26 welcome"}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/rooms/{seed_room['id']}", headers=demo_headers, timeout=15).json()
        assert g["welcome_msg"] == "TEST_iter26 welcome"

    def test_legacy_entrance_effects_partial(self, demo_headers, seed_room):
        r = requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                           headers=demo_headers,
                           json={"entrance_effects": False}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("settings", {}).get("entrance_effects") is False
        g = requests.get(f"{API}/rooms/{seed_room['id']}", headers=demo_headers, timeout=15).json()
        assert g["settings"]["entrance_effects"] is False
        # restore
        requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                       headers=demo_headers, json={"entrance_effects": True}, timeout=15)

    def test_empty_body_400(self, demo_headers, seed_room):
        r = requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                           headers=demo_headers, json={}, timeout=15)
        assert r.status_code == 400

    def test_non_owner_403(self, second_user, seed_room):
        r = requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                           headers=second_user["headers"],
                           json={"notice": "NOPE"}, timeout=15)
        assert r.status_code == 403


# ------------------------- WS welcome payload -----------------------------

class TestWSWelcomeAndDisconnect:
    async def _login_and_get_uid(self, token, headers):
        me = requests.get(f"{API}/auth/me", headers=headers, timeout=15).json()
        return me["id"]

    def test_ws_welcome_includes_user_id_and_nickname(self, demo_headers, second_user, seed_room):
        # Set welcome_msg
        requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                       headers=demo_headers,
                       json={"welcome_msg": "TEST_iter26_welcome_payload"}, timeout=15)

        async def run():
            url = f"{WS_BASE}/ws/rooms/{seed_room['id']}?token={second_user['token']}"
            got_welcome = None
            try:
                async with websockets.connect(url, open_timeout=10) as ws:
                    end = time.time() + 6
                    while time.time() < end:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.5)
                        except asyncio.TimeoutError:
                            continue
                        try:
                            evt = json.loads(raw)
                        except Exception:
                            continue
                        if evt.get("type") == "system" and evt.get("kind") == "welcome":
                            got_welcome = evt
                            break
            except Exception as e:
                pytest.skip(f"WS unavailable in this environment: {e}")
            return got_welcome

        evt = asyncio.new_event_loop().run_until_complete(run())
        assert evt is not None, "welcome system event not received"
        assert "TEST_iter26_welcome_payload" in evt.get("text", "")
        # iter-26 additions:
        assert evt.get("user_id") == second_user["user"]["id"], f"missing/wrong user_id: {evt}"
        assert evt.get("nickname"), f"missing nickname: {evt}"
        assert evt.get("welcome_msg") == "TEST_iter26_welcome_payload", f"missing welcome_msg: {evt}"

    def test_ws_no_welcome_when_empty(self, demo_headers, second_user, seed_room):
        # Clear welcome_msg
        requests.patch(f"{API}/rooms/{seed_room['id']}/settings",
                       headers=demo_headers, json={"welcome_msg": ""}, timeout=15)

        async def run():
            url = f"{WS_BASE}/ws/rooms/{seed_room['id']}?token={second_user['token']}"
            got_welcome = False
            try:
                async with websockets.connect(url, open_timeout=10) as ws:
                    end = time.time() + 4
                    while time.time() < end:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.2)
                        except asyncio.TimeoutError:
                            continue
                        try:
                            evt = json.loads(raw)
                        except Exception:
                            continue
                        if evt.get("type") == "system" and evt.get("kind") == "welcome":
                            got_welcome = True
                            break
            except Exception as e:
                pytest.skip(f"WS unavailable: {e}")
            return got_welcome

        got = asyncio.new_event_loop().run_until_complete(run())
        assert got is False, "welcome must NOT broadcast when welcome_msg is empty"

    def test_ws_disconnect_auto_vacates_seat(self, demo_headers, second_user, seed_room):
        """Second user sits, then disconnects — seat should be auto-vacated."""
        # Second user takes seat 1 (index 1 to skip host at 0)
        # Try a few indices to find an empty seat
        rid = seed_room["id"]
        room = requests.get(f"{API}/rooms/{rid}", headers=demo_headers, timeout=15).json()
        target_idx = None
        for i, s in enumerate(room.get("seats") or []):
            if i == 0:
                continue  # host chair
            if not s.get("user") and not s.get("locked"):
                target_idx = i
                break
        if target_idx is None:
            pytest.skip("No empty seat available in seed room")

        # sit down via /seats/take
        r = requests.post(f"{API}/rooms/{rid}/seats/take",
                          headers=second_user["headers"],
                          json={"seat_index": target_idx}, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"sit failed: {r.status_code} {r.text}")

        async def run():
            url = f"{WS_BASE}/ws/rooms/{rid}?token={second_user['token']}"
            try:
                async with websockets.connect(url, open_timeout=10) as ws:
                    # burn a couple of events, then disconnect by exiting context
                    end = time.time() + 2
                    while time.time() < end:
                        try:
                            await asyncio.wait_for(ws.recv(), timeout=0.8)
                        except asyncio.TimeoutError:
                            continue
            except Exception as e:
                pytest.skip(f"WS unavailable: {e}")

        asyncio.new_event_loop().run_until_complete(run())
        # Give backend a moment to process disconnect cleanup
        time.sleep(1.5)
        room2 = requests.get(f"{API}/rooms/{rid}", headers=demo_headers, timeout=15).json()
        seat_now = (room2.get("seats") or [])[target_idx]
        assert seat_now.get("user") in (None, {}), (
            f"seat {target_idx} was not auto-vacated on WS disconnect: {seat_now}")
