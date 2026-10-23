"""ORIO room-upgrade endpoints (layout / settings / close / chat clear) + WS system events.

Additive change: this suite is idempotent. It registers two fresh users per module,
creates its own rooms, and cleans up state via close/leave — it does not depend on
any pre-existing rooms or accounts and does not modify seeded data.
"""
import asyncio
import json
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
import websockets


# --- BASE_URL: prefer the public preview URL that mobile clients hit ---
def _base_url() -> str:
    # 1) explicit override
    env_url = os.environ.get("EXPO_BACKEND_URL_TEST")
    if env_url:
        return env_url.rstrip("/")
    # 2) frontend .env EXPO_PUBLIC_BACKEND_URL
    fe_env = Path("/app/frontend/.env")
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    return "http://localhost:8001"


BASE_URL = _base_url()
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


# ---------- helpers ----------

def _rand_suffix() -> str:
    return uuid.uuid4().hex[:6]


def _register(session: requests.Session, prefix: str = "u") -> dict:
    """Register a fresh user and return {email, password, token, user_id}."""
    suf = _rand_suffix()
    email = f"TEST_{prefix}_{suf}@orio.app"
    password = "Test12345!"
    # username must be <= 20 chars, [a-zA-Z0-9_]
    uname = f"t_{prefix[:3]}_{suf}"[:20]
    body = {
        "email": email,
        "password": password,
        "username": uname,
        "nickname": f"Tester {prefix} {suf[:4]}",
    }
    r = session.post(f"{BASE_URL}/api/auth/register", json=body, timeout=30)
    assert r.status_code == 201, f"register failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    me = session.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert me.status_code == 200, me.text
    return {"email": email, "password": password, "token": tok, "user": me.json()}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_room(session: requests.Session, token: str,
                 num_seats: int = 8, name: str | None = None) -> dict:
    body = {"name": name or f"TEST_Room_{_rand_suffix()}", "num_seats": num_seats}
    r = session.post(f"{BASE_URL}/api/rooms", json=body,
                     headers=_auth(token), timeout=30)
    assert r.status_code in (200, 201), f"create_room failed: {r.status_code} {r.text}"
    return r.json()


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def owner(api):
    return _register(api, "owner")


@pytest.fixture(scope="module")
def stranger(api):
    return _register(api, "stranger")


# ---------- 1) sanity / Agora regression ----------

class TestSanity:
    def test_api_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200

    def test_rtc_config(self, api):
        r = api.get(f"{BASE_URL}/api/rtc/config")
        assert r.status_code == 200
        data = r.json()
        assert "enabled" in data
        # if enabled, app_id must be present
        if data.get("enabled"):
            assert isinstance(data.get("app_id"), str) and data["app_id"]

    def test_rtc_token(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Rtc")
        r = api.post(f"{BASE_URL}/api/rtc/token",
                     json={"channel": room["id"], "uid": 12345},
                     headers=_auth(owner["token"]))
        # Endpoint should exist. If Agora disabled -> 400 or {"token": null}
        assert r.status_code in (200, 400, 501), r.text
        # cleanup
        api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                 headers=_auth(owner["token"]))


# ---------- 2) GET /api/rooms/{id} shape ----------

class TestRoomShape:
    def test_get_room_has_new_fields(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Shape")
        try:
            r = api.get(f"{BASE_URL}/api/rooms/{room['id']}", headers=_auth(owner["token"]))
            assert r.status_code == 200
            data = r.json()
            assert "owner_id" in data and data["owner_id"] == owner["user"]["id"]
            assert "moderators" in data and isinstance(data["moderators"], list)
            assert "settings" in data and isinstance(data["settings"], dict)
            s = data["settings"]
            assert "entrance_effects" in s
            assert "noise_reduction" in s
            assert "music_control_role" in s
            assert data["num_seats"] == 8
            assert isinstance(data.get("seats"), list) and len(data["seats"]) == 8
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))


# ---------- 3) PATCH /api/rooms/{id}/layout ----------

class TestLayoutEndpoint:
    def test_owner_can_change_to_8_15_20(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Layout")
        try:
            for n in (15, 20, 8):
                r = api.patch(f"{BASE_URL}/api/rooms/{room['id']}/layout",
                              json={"num_seats": n}, headers=_auth(owner["token"]))
                assert r.status_code == 200, f"n={n} → {r.status_code} {r.text}"
                data = r.json()
                assert data["num_seats"] == n
                assert len(data["seats"]) == n
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))

    def test_invalid_values_rejected(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_LayoutBad")
        try:
            for bad in (10, 25, 0, -1, 7):
                r = api.patch(f"{BASE_URL}/api/rooms/{room['id']}/layout",
                              json={"num_seats": bad},
                              headers=_auth(owner["token"]))
                assert r.status_code == 400, f"bad={bad} → {r.status_code} {r.text}"
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))

    def test_non_owner_gets_403(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Layout403")
        try:
            r = api.patch(f"{BASE_URL}/api/rooms/{room['id']}/layout",
                          json={"num_seats": 15},
                          headers=_auth(stranger["token"]))
            assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))

    def test_seat_contents_preserved_and_grow_shrink(self, api, owner):
        """Shrink drops extras; grow appends empty seats. Seat 0 (owner) preserved."""
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_LayoutGrow")
        rid = room["id"]
        try:
            # confirm seat 0 is owner
            g0 = api.get(f"{BASE_URL}/api/rooms/{rid}", headers=_auth(owner["token"])).json()
            assert g0["seats"][0]["user"] is not None
            assert g0["seats"][0]["user"]["id"] == owner["user"]["id"]

            # grow to 20 → seat 0 still owner, seats 8..19 are None
            r = api.patch(f"{BASE_URL}/api/rooms/{rid}/layout",
                          json={"num_seats": 20},
                          headers=_auth(owner["token"]))
            assert r.status_code == 200
            data = r.json()
            assert len(data["seats"]) == 20
            assert data["seats"][0]["user"] and data["seats"][0]["user"]["id"] == owner["user"]["id"]
            for i in range(8, 20):
                assert data["seats"][i]["user"] is None
                assert data["seats"][i]["index"] == i

            # shrink back to 8 → seat 0 still owner
            r = api.patch(f"{BASE_URL}/api/rooms/{rid}/layout",
                          json={"num_seats": 8},
                          headers=_auth(owner["token"]))
            assert r.status_code == 200
            data = r.json()
            assert len(data["seats"]) == 8
            assert data["seats"][0]["user"]["id"] == owner["user"]["id"]

            # move owner to seat 15 → shrink to 8 drops him
            api.post(f"{BASE_URL}/api/rooms/{rid}/seats/leave",
                     headers=_auth(owner["token"]))
            api.patch(f"{BASE_URL}/api/rooms/{rid}/layout",
                      json={"num_seats": 20}, headers=_auth(owner["token"]))
            take = api.post(f"{BASE_URL}/api/rooms/{rid}/seats/take",
                            json={"seat_index": 15},
                            headers=_auth(owner["token"]))
            assert take.status_code == 200, take.text
            assert take.json()["seats"][15]["user"]["id"] == owner["user"]["id"]

            r = api.patch(f"{BASE_URL}/api/rooms/{rid}/layout",
                          json={"num_seats": 8},
                          headers=_auth(owner["token"]))
            assert r.status_code == 200
            data = r.json()
            assert len(data["seats"]) == 8
            # owner no longer on any seat within 0..7
            occupied = [s for s in data["seats"] if s.get("user")]
            assert all(s["user"]["id"] != owner["user"]["id"] for s in occupied), \
                "owner beyond capacity should be dropped"
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))


# ---------- 4) PATCH /api/rooms/{id}/settings ----------

class TestSettingsEndpoint:
    def test_owner_can_toggle(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Settings")
        rid = room["id"]
        try:
            r = api.patch(f"{BASE_URL}/api/rooms/{rid}/settings",
                          json={"entrance_effects": False,
                                "noise_reduction": False,
                                "music_control_role": "mods"},
                          headers=_auth(owner["token"]))
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("ok") is True
            s = data["settings"]
            assert s["entrance_effects"] is False
            assert s["noise_reduction"] is False
            assert s["music_control_role"] == "mods"

            # persistence via GET
            g = api.get(f"{BASE_URL}/api/rooms/{rid}", headers=_auth(owner["token"])).json()
            assert g["settings"]["entrance_effects"] is False
            assert g["settings"]["music_control_role"] == "mods"

            # partial update leaves others alone
            r = api.patch(f"{BASE_URL}/api/rooms/{rid}/settings",
                          json={"entrance_effects": True},
                          headers=_auth(owner["token"]))
            assert r.status_code == 200
            s2 = r.json()["settings"]
            assert s2["entrance_effects"] is True
            assert s2["noise_reduction"] is False  # unchanged
            assert s2["music_control_role"] == "mods"  # unchanged
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

    def test_non_owner_403(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Settings403")
        try:
            r = api.patch(f"{BASE_URL}/api/rooms/{room['id']}/settings",
                          json={"entrance_effects": False},
                          headers=_auth(stranger["token"]))
            assert r.status_code == 403
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))

    def test_bad_role_rejected(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_SettingsBad")
        try:
            r = api.patch(f"{BASE_URL}/api/rooms/{room['id']}/settings",
                          json={"music_control_role": "everyone"},
                          headers=_auth(owner["token"]))
            assert r.status_code == 422, r.text
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))


# ---------- 5) POST /api/rooms/{id}/close ----------

class TestCloseEndpoint:
    def test_owner_can_close(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Close")
        rid = room["id"]
        r = api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # GET reflects is_live=false, listeners=0
        g = api.get(f"{BASE_URL}/api/rooms/{rid}", headers=_auth(owner["token"])).json()
        assert g["is_live"] is False
        assert g["listeners_count"] == 0

    def test_non_owner_403(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Close403")
        try:
            r = api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                         headers=_auth(stranger["token"]))
            assert r.status_code == 403, r.text
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))


# ---------- 6) POST /api/rooms/{id}/chat/clear ----------

class TestChatClearEndpoint:
    def test_owner_can_clear(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_ChatClear")
        rid = room["id"]
        try:
            r = api.post(f"{BASE_URL}/api/rooms/{rid}/chat/clear",
                         headers=_auth(owner["token"]))
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True

            # history should be empty (or at least a list)
            h = api.get(f"{BASE_URL}/api/rooms/{rid}/chat",
                        headers=_auth(owner["token"]))
            assert h.status_code == 200
            data = h.json()
            msgs = data if isinstance(data, list) else data.get("messages", data.get("items", []))
            assert isinstance(msgs, list)
            assert len(msgs) == 0
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

    def test_non_owner_403(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_ChatClear403")
        try:
            r = api.post(f"{BASE_URL}/api/rooms/{room['id']}/chat/clear",
                         headers=_auth(stranger["token"]))
            assert r.status_code == 403
        finally:
            api.post(f"{BASE_URL}/api/rooms/{room['id']}/close",
                     headers=_auth(owner["token"]))


# ---------- 7) Seat actions still work (regression) ----------

class TestSeatRegression:
    def test_take_leave_mute(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_Seats")
        rid = room["id"]
        try:
            # stranger takes seat 3
            r = api.post(f"{BASE_URL}/api/rooms/{rid}/seats/take",
                         json={"seat_index": 3},
                         headers=_auth(stranger["token"]))
            assert r.status_code == 200, r.text
            assert r.json()["seats"][3]["user"]["id"] == stranger["user"]["id"]

            # mute (toggle on)
            r = api.post(f"{BASE_URL}/api/rooms/{rid}/seats/mute",
                         headers=_auth(stranger["token"]))
            assert r.status_code == 200
            assert r.json()["seats"][3]["muted"] is True

            # unmute
            r = api.post(f"{BASE_URL}/api/rooms/{rid}/seats/mute",
                         headers=_auth(stranger["token"]))
            assert r.status_code == 200
            assert r.json()["seats"][3]["muted"] is False

            # leave
            r = api.post(f"{BASE_URL}/api/rooms/{rid}/seats/leave",
                         headers=_auth(stranger["token"]))
            assert r.status_code == 200
            assert r.json()["seats"][3]["user"] is None
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))


# ---------- 8) WebSocket system-event broadcasts ----------

class TestWebSocketSystemEvents:
    """Verify that /seats/take, /seats/leave, /seats/mute, PATCH /layout, /close,
    and /chat/clear each push the correct `type:'system'` / event over WS."""

    async def _collect_events(self, ws_url: str, token: str, room_id: str,
                              action, timeout: float = 6.0) -> list[dict]:
        """Connect, drain initial user_joined event, run `action()`, collect events."""
        events: list[dict] = []
        async with websockets.connect(f"{ws_url}/api/ws/rooms/{room_id}?token={token}") as ws:
            # drain first message so it doesn't confuse timing
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=3)
                events.append(json.loads(first))
            except Exception:
                pass

            # run the action from the main thread (blocking requests call)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, action)

            end = time.time() + timeout
            while time.time() < end:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
                    events.append(json.loads(msg))
                except asyncio.TimeoutError:
                    # Have we seen anything more than just user_joined? If yes, break.
                    if any(e.get("type") in ("system", "room_state", "room_closed",
                                             "chat_cleared") for e in events):
                        # give a bit more grace for follow-ups then break
                        try:
                            more = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            events.append(json.loads(more))
                        except Exception:
                            pass
                        break
                except Exception:
                    break
        return events

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro) \
            if not asyncio.get_event_loop().is_closed() else asyncio.run(coro)

    def test_layout_change_broadcasts_system(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_WS_Layout")
        rid = room["id"]
        try:
            def act():
                api.patch(f"{BASE_URL}/api/rooms/{rid}/layout",
                          json={"num_seats": 15},
                          headers=_auth(owner["token"]))

            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, act))
            systems = [e for e in evts if e.get("type") == "system"]
            kinds = [e.get("kind") for e in systems]
            assert "layout_changed" in kinds, f"missing layout_changed system event: {evts}"
            lc = next(e for e in systems if e.get("kind") == "layout_changed")
            assert lc.get("num_seats") == 15
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

    def test_seat_take_leave_mute_broadcast_system(self, api, owner, stranger):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_WS_Seats")
        rid = room["id"]
        try:
            # --- take ---
            def take_action():
                api.post(f"{BASE_URL}/api/rooms/{rid}/seats/take",
                         json={"seat_index": 4},
                         headers=_auth(stranger["token"]))

            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, take_action))
            kinds = [e.get("kind") for e in evts if e.get("type") == "system"]
            assert "seat_taken" in kinds, f"missing seat_taken: {evts}"

            # --- mute ---
            def mute_action():
                api.post(f"{BASE_URL}/api/rooms/{rid}/seats/mute",
                         headers=_auth(stranger["token"]))

            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, mute_action))
            kinds = [e.get("kind") for e in evts if e.get("type") == "system"]
            assert "muted" in kinds, f"missing muted: {evts}"

            # --- unmute ---
            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, mute_action))
            kinds = [e.get("kind") for e in evts if e.get("type") == "system"]
            assert "unmuted" in kinds, f"missing unmuted: {evts}"

            # --- leave ---
            def leave_action():
                api.post(f"{BASE_URL}/api/rooms/{rid}/seats/leave",
                         headers=_auth(stranger["token"]))

            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, leave_action))
            kinds = [e.get("kind") for e in evts if e.get("type") == "system"]
            assert "seat_left" in kinds, f"missing seat_left: {evts}"
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

    def test_chat_clear_broadcast(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_WS_ChatClear")
        rid = room["id"]
        try:
            def act():
                api.post(f"{BASE_URL}/api/rooms/{rid}/chat/clear",
                         headers=_auth(owner["token"]))

            evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, act))
            types = [e.get("type") for e in evts]
            assert "chat_cleared" in types, f"missing chat_cleared: {evts}"
        finally:
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

    def test_close_broadcast(self, api, owner):
        room = _create_room(api, owner["token"], num_seats=8, name="TEST_WS_Close")
        rid = room["id"]

        def act():
            api.post(f"{BASE_URL}/api/rooms/{rid}/close",
                     headers=_auth(owner["token"]))

        evts = asyncio.run(self._collect_events(WS_BASE, owner["token"], rid, act))
        types = [e.get("type") for e in evts]
        assert "room_closed" in types, f"missing room_closed: {evts}"
