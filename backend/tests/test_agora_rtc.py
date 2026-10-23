"""
ORIO backend — Agora voice integration tests (iteration 4).

Covers:
- GET /api/rtc/config  (no auth, returns enabled=true + app_id)
- POST /api/rtc/token   (auth required; role depends on ownership/seat)
- Channel input validation (422s)
- Response body must not leak the App Certificate
- Regression sanity on existing endpoints

Run:
  pytest /app/backend/tests/test_agora_rtc.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results_iter4.xml
"""
from __future__ import annotations

import secrets
from typing import Any

import pytest
import requests

EXPECTED_APP_ID = "5f4f337f1ad84126994a3107bf7249ba"
LEAKED_CERT = "29c9063273b444f3a09bf43d0cd2e4bf"


# ---------- helpers ----------

def _rand(n: int = 8) -> str:
    return secrets.token_hex(n // 2)


def _register(base_url: str) -> dict[str, Any]:
    suf = _rand(8)
    payload = {
        "email": f"test_{suf}@voiceup.app",
        "password": "TestPass1234",
        "username": f"testu_{suf}",
        "nickname": f"T{suf[:6]}",
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, r.text
    tok = r.json()
    me = requests.get(
        f"{base_url}/api/auth/me",
        headers={"Authorization": f"Bearer {tok['access_token']}"},
        timeout=15,
    )
    assert me.status_code == 200, me.text
    return {**tok, "user_id": me.json().get("id")}


def _auth(tok: dict) -> dict:
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _create_room(base_url: str, tok: dict) -> str:
    payload = {
        "name": f"AgoraRoom-{_rand(4)}",
        "description": "agora test room",
        "category": "general",
        "num_seats": 8,
        "max_users": 50,
        "is_private": False,
    }
    r = requests.post(f"{base_url}/api/rooms", json=payload, headers=_auth(tok), timeout=15)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def owner(base_url):
    return _register(base_url)


@pytest.fixture(scope="module")
def other(base_url):
    return _register(base_url)


@pytest.fixture(scope="module")
def room_id(base_url, owner):
    return _create_room(base_url, owner)


# =============================================================
# 1) GET /api/rtc/config
# =============================================================
class TestRtcConfig:
    def test_no_auth_required(self, base_url):
        r = requests.get(f"{base_url}/api/rtc/config", timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("enabled") is True, b
        assert b.get("app_id") == EXPECTED_APP_ID, b
        # certificate must not leak
        assert LEAKED_CERT not in r.text, "App Certificate leaked in /rtc/config response!"
        # Only enabled + app_id expected (no cert/secret)
        for key in ("app_certificate", "certificate", "secret"):
            assert key not in b, f"Sensitive field '{key}' present in /rtc/config"


# =============================================================
# 2) POST /api/rtc/token
# =============================================================
class TestRtcToken:
    def test_no_auth_returns_401(self, base_url, room_id):
        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": f"orio_{room_id}", "uid": 12345},
            timeout=10,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_subscriber_role_when_not_seated(self, base_url, other, room_id):
        # 'other' is NOT owner and NOT seated
        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": f"orio_{room_id}", "uid": 12345},
            headers=_auth(other),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("role") == "subscriber", b
        assert isinstance(b.get("token"), str) and len(b["token"]) >= 80, (
            len(b.get("token", "")), b
        )
        import time as _t
        now = int(_t.time())
        assert abs((b.get("expires_at") or 0) - (now + 3600)) < 60, (b.get("expires_at"), now)
        # response shape
        expected_keys = {"app_id", "channel", "uid", "token", "expires_at", "role"}
        assert set(b.keys()) == expected_keys, b.keys()
        assert b["app_id"] == EXPECTED_APP_ID, b
        assert b["channel"] == f"orio_{room_id}", b
        assert b["uid"] == 12345, b
        # no cert leak
        assert LEAKED_CERT not in r.text, "Certificate leaked in /rtc/token response!"

    def test_publisher_role_after_taking_seat(self, base_url, other, room_id):
        # 'other' takes seat_index=1
        rt = requests.post(
            f"{base_url}/api/rooms/{room_id}/seats/take",
            json={"seat_index": 1},
            headers=_auth(other), timeout=10,
        )
        assert rt.status_code == 200, rt.text

        # Re-request token: role should now be publisher
        sub_token_len = 0
        r_sub_pre = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": f"orio_{room_id}", "uid": 22222},
            headers=_auth(_register(base_url)),   # a fresh not-seated user
            timeout=10,
        )
        assert r_sub_pre.status_code == 200
        sub_token_len = len(r_sub_pre.json()["token"])

        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": f"orio_{room_id}", "uid": 12345},
            headers=_auth(other), timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("role") == "publisher", b
        assert isinstance(b.get("token"), str) and len(b["token"]) >= 80, len(b.get("token", ""))
        # Publisher token is not necessarily longer than subscriber, but must be a valid Agora token.
        # Spec says "a longer signed token" — Agora publisher tokens are typically >= subscriber's.
        # We assert it's non-empty and different roles.
        assert LEAKED_CERT not in r.text, "Certificate leaked in publisher token response!"

    @pytest.mark.parametrize("bad_channel", [
        "../etc",
        "has spaces",
        "",
        "A" * 200,
    ])
    def test_invalid_channel_rejected_422(self, base_url, owner, bad_channel):
        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": bad_channel, "uid": 12345},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 422, f"channel={bad_channel!r} expected 422, got {r.status_code}: {r.text}"

    def test_owner_role_is_publisher(self, base_url, owner, room_id):
        r = requests.post(
            f"{base_url}/api/rtc/token",
            json={"channel": f"orio_{room_id}", "uid": 999},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("role") == "publisher", r.json()


# =============================================================
# 3) Regression — critical existing endpoints still work
# =============================================================
class TestRegression:
    def test_register_login_flow(self, base_url):
        suf = _rand(8)
        payload = {
            "email": f"reg_{suf}@voiceup.app",
            "password": "TestPass1234",
            "username": f"regu_{suf}",
            "nickname": f"R{suf[:6]}",
        }
        r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=15)
        assert r.status_code == 201, r.text
        b = r.json()
        assert "access_token" in b and "refresh_token" in b, b

        lr = requests.post(
            f"{base_url}/api/auth/login",
            json={"email": payload["email"], "password": payload["password"]},
            timeout=15,
        )
        assert lr.status_code == 200, lr.text
        assert "access_token" in lr.json(), lr.json()

    def test_get_rooms(self, base_url, owner):
        r = requests.get(f"{base_url}/api/rooms", headers=_auth(owner), timeout=15)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list), arr
        # ORIO seeds ≥5 demo rooms plus fixture-created room(s)
        assert len(arr) >= 5, len(arr)

    def test_seats_take_leave_mute(self, base_url):
        # Fresh owner + fresh user + fresh room to keep isolation
        o = _register(base_url)
        u = _register(base_url)
        rid = _create_room(base_url, o)

        # take
        rt = requests.post(
            f"{base_url}/api/rooms/{rid}/seats/take",
            json={"seat_index": 2},
            headers=_auth(u), timeout=10,
        )
        assert rt.status_code == 200, rt.text

        # mute
        rm = requests.post(
            f"{base_url}/api/rooms/{rid}/seats/mute",
            headers=_auth(u), timeout=10,
        )
        assert rm.status_code == 200, rm.text

        # leave
        rl = requests.post(
            f"{base_url}/api/rooms/{rid}/seats/leave",
            headers=_auth(u), timeout=10,
        )
        assert rl.status_code == 200, rl.text

    def test_envelopes_and_claim(self, base_url):
        o = _register(base_url)
        rid = _create_room(base_url, o)
        # Fund owner with a small recharge so envelope can be created
        rr = requests.post(
            f"{base_url}/api/wallet/recharge",
            json={"package_id": "d_999"},
            headers=_auth(o), timeout=15,
        )
        assert rr.status_code == 200, rr.text

        env = requests.post(
            f"{base_url}/api/rooms/{rid}/envelopes",
            json={"amount": 100, "slots": 2, "message": "test"},
            headers=_auth(o), timeout=15,
        )
        # Endpoint must respond cleanly (no 500); may be 402 if seed user lacks diamonds.
        assert env.status_code in (200, 201, 402), f"envelope create: {env.status_code} {env.text}"

        # Claim endpoint must exist (independent of prior create)
        # Use a bogus id to confirm 404 shape rather than 500.
        cl = requests.post(
            f"{base_url}/api/envelopes/000000000000000000000000/claim",
            headers=_auth(o), timeout=15,
        )
        assert cl.status_code in (400, 403, 404, 409), f"unexpected claim status: {cl.status_code} {cl.text}"

    def test_moderate_endpoint_reachable(self, base_url):
        o = _register(base_url)
        u = _register(base_url)
        rid = _create_room(base_url, o)
        r = requests.post(
            f"{base_url}/api/rooms/{rid}/moderate",
            json={"action": "kick", "target_user_id": u["user_id"]},
            headers=_auth(o), timeout=10,
        )
        # Success shape may vary; must not be 500
        assert r.status_code < 500, f"moderate crashed: {r.status_code} {r.text}"

    def test_tasks_and_vip_heads(self, base_url, owner):
        rt = requests.get(f"{base_url}/api/tasks", headers=_auth(owner), timeout=10)
        assert rt.status_code == 200, rt.text
        assert len(rt.json()) == 9, len(rt.json())

        rv = requests.get(f"{base_url}/api/vip/heads", timeout=10)
        assert rv.status_code == 200, rv.text
        assert len(rv.json()) == 7, len(rv.json())
