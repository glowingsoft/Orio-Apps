"""
ORIO iter-25 RETEST — two targeted fixes from main agent
1) Merged PATCH /api/rooms/{id}/settings now accepts partial updates for
   notice / welcome_msg / entrance_effects / noise_reduction / music_control_role.
2) Only ONE handler registered for that route (previous duplicate removed).
3) WS 'welcome' event still emits only when welcome_msg is non-empty
   (frontend renderer fix is out-of-scope for this pytest suite; covered by
   playwright script separately).
"""
import os
import uuid
import asyncio
import json

import pytest
import requests
import websockets


BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
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
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def other_token():
    tag = uuid.uuid4().hex[:8]
    payload = {
        "email": f"TEST_iter25rt_{tag}@example.com",
        "password": "testpass123",
        "username": f"iter25rt_{tag}",
        "nickname": f"IterRT {tag}",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    tok = data.get("access_token") or data.get("token")
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


# ---------- 1. Merged PATCH accepts partial updates for each key ----------
class TestMergedRoomSettings:
    def test_partial_notice(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"notice": "RT_notice"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("notice") == "RT_notice"

        # persistence via GET
        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert g.status_code == 200
        assert g.json().get("notice") == "RT_notice"

    def test_partial_welcome_msg(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": "Enjoy the party!"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("welcome_msg") == "Enjoy the party!"

        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert g.json().get("welcome_msg") == "Enjoy the party!"

    def test_partial_entrance_effects_true(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"entrance_effects": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        # Merged handler returns nested settings dict when legacy toggles change
        assert "settings" in j and j["settings"].get("entrance_effects") is True

        # GET reflects it under .settings
        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert g.status_code == 200
        s = g.json().get("settings") or {}
        assert s.get("entrance_effects") is True

    def test_partial_entrance_effects_false(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"entrance_effects": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["settings"].get("entrance_effects") is False

        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert (g.json().get("settings") or {}).get("entrance_effects") is False

    def test_partial_noise_reduction_false(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"noise_reduction": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["settings"].get("noise_reduction") is False

        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert (g.json().get("settings") or {}).get("noise_reduction") is False

    def test_partial_music_control_role_mods(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"music_control_role": "mods"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["settings"].get("music_control_role") == "mods"

        g = requests.get(f"{BASE_URL}/api/rooms/{SEED_ROOM_8}", headers=_auth(owner_token), timeout=15)
        assert (g.json().get("settings") or {}).get("music_control_role") == "mods"

    def test_reset_settings_back_to_defaults(self, owner_token):
        # Restore
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={
                "entrance_effects": True,
                "noise_reduction": True,
                "music_control_role": "owner",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        s = r.json().get("settings") or {}
        assert s.get("entrance_effects") is True
        assert s.get("noise_reduction") is True
        assert s.get("music_control_role") == "owner"

    def test_empty_body_returns_400(self, owner_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_non_owner_403(self, other_token):
        tok, _u = other_token
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(tok),
            json={"entrance_effects": False},
            timeout=15,
        )
        assert r.status_code == 403, r.text


# ---------- 2. Only one handler for PATCH /rooms/{id}/settings ----------
class TestRouteRegistration:
    def test_source_has_single_patch_settings_decorator(self):
        # Static scan of backend/server.py — ensure duplicate registration is gone.
        import re
        src_path = "/app/backend/server.py"
        with open(src_path, "r", encoding="utf-8") as f:
            src = f.read()
        # Match decorator with either single or double quotes
        pat = re.compile(r"""@api\.patch\(\s*["']/rooms/\{room_id\}/settings["']""")
        matches = pat.findall(src)
        assert len(matches) == 1, (
            f"Expected exactly ONE @api.patch('/rooms/{{room_id}}/settings') "
            f"decorator, found {len(matches)}"
        )


# ---------- 3. WS welcome event still works (regression) ----------
class TestWSWelcomeRegression:
    @pytest.mark.asyncio
    async def test_welcome_broadcast_when_set(self, owner_token, other_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": "Enjoy the party!"},
            timeout=15,
        )
        assert r.status_code == 200

        tok, user = other_token
        nick = user.get("nickname") or "User"

        owner_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={owner_token}"
        other_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={tok}"

        got = None
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
            async with websockets.connect(other_ws_url, open_timeout=10, close_timeout=5) as _ow:
                events = await _drain(owner_ws, 3.0)
                for ev in events:
                    if (
                        ev.get("type") == "system"
                        and ev.get("kind") == "welcome"
                        and "Enjoy the party!" in (ev.get("text") or "")
                        and nick in (ev.get("text") or "")
                    ):
                        got = ev
                        break
        assert got is not None, "welcome broadcast not received"
        # Text pattern the joiner will see: "{nickname} 👋 {welcome_msg}"
        assert got["text"].endswith("Enjoy the party!"), got["text"]

    @pytest.mark.asyncio
    async def test_no_welcome_when_empty(self, owner_token, other_token):
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{SEED_ROOM_8}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": ""},
            timeout=15,
        )
        assert r.status_code == 200

        tok, _u = other_token
        owner_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={owner_token}"
        other_ws_url = f"{WS_BASE}/api/ws/rooms/{SEED_ROOM_8}?token={tok}"

        seen = False
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
            async with websockets.connect(other_ws_url, open_timeout=10, close_timeout=5) as _ow:
                events = await _drain(owner_ws, 2.0)
                for ev in events:
                    if ev.get("type") == "system" and ev.get("kind") == "welcome":
                        seen = True
                        break
        assert not seen, "welcome broadcast should NOT fire when welcome_msg is empty"
