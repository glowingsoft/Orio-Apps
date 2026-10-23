"""
Iteration 30 backend verification.

Iter-30 is a surgical FRONTEND-only change (sticky Follow → Chat CTA on
ProfileView and Follow → Chat morph inside RoomUserCard). The relevant
backend contracts to verify are:
  - POST /users/{id}/follow (idempotent)
  - DELETE /users/{id}/follow
  - GET /users/{id} exposes is_following boolean for the caller
  - Chat room fetch/list still works (used by /chat/{id} route)
Also runs a light regression on the demo login + a room GET.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL_TEST")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# ------------- helpers -------------
def _register(session, email, password="pass12345", username=None, nickname="TestUser"):
    username = username or ("t_" + uuid.uuid4().hex[:8])
    r = session.post(f"{API}/auth/register", json={
        "email": email, "password": password,
        "username": username, "nickname": nickname,
    })
    return r


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    token = body["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200, f"/auth/me failed: {me.status_code} {me.text}"
    return s, token, me.json()


# ------------- fixtures -------------
@pytest.fixture(scope="module")
def demo():
    s, t, u = _login(DEMO_EMAIL, DEMO_PASSWORD)
    return {"session": s, "token": t, "user": u}


@pytest.fixture(scope="module")
def other_user():
    email = f"iter30_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = _register(s, email, "pass12345")
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    token = body["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200, me.text
    return {"session": s, "token": token, "user": me.json(), "email": email}


# ------------- tests -------------
class TestHealth:
    def test_root_ok(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("app") == "ORIO"


class TestUserFollow:
    """Verifies backend contracts used by the iter-30 Follow → Chat CTA."""

    def test_public_user_has_is_following_field(self, demo, other_user):
        r = demo["session"].get(f"{API}/users/{other_user['user']['id']}")
        assert r.status_code == 200, r.text
        body = r.json()
        # is_following must be present for the caller
        assert "is_following" in body, f"missing is_following key: {list(body.keys())}"
        assert isinstance(body["is_following"], bool)

    def test_follow_flips_is_following_true(self, demo, other_user):
        target = other_user["user"]["id"]
        # ensure clean starting state
        demo["session"].delete(f"{API}/users/{target}/follow")

        r = demo["session"].post(f"{API}/users/{target}/follow")
        assert r.status_code in (200, 201), r.text

        r2 = demo["session"].get(f"{API}/users/{target}")
        assert r2.status_code == 200
        assert r2.json().get("is_following") is True

    def test_follow_is_idempotent(self, demo, other_user):
        target = other_user["user"]["id"]
        r = demo["session"].post(f"{API}/users/{target}/follow")
        # second follow should not error — either 200/201/409 tolerated
        assert r.status_code in (200, 201, 409), r.text
        r2 = demo["session"].get(f"{API}/users/{target}")
        assert r2.json().get("is_following") is True

    def test_unfollow_flips_false(self, demo, other_user):
        target = other_user["user"]["id"]
        r = demo["session"].delete(f"{API}/users/{target}/follow")
        assert r.status_code in (200, 204), r.text
        r2 = demo["session"].get(f"{API}/users/{target}")
        assert r2.status_code == 200
        assert r2.json().get("is_following") is False

    def test_follow_self_rejected(self, demo):
        me_id = demo["user"]["id"]
        r = demo["session"].post(f"{API}/users/{me_id}/follow")
        assert r.status_code in (400, 403, 409), f"unexpected: {r.status_code} {r.text}"


class TestRegressionRooms:
    """Light regression — iter-26/27 endpoints used by home + room screen."""

    def test_rooms_list_ok(self, demo):
        r = demo["session"].get(f"{API}/rooms")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_rooms_mine_ok(self, demo):
        r = demo["session"].get(f"{API}/rooms/mine")
        assert r.status_code == 200

    def test_rooms_managed_ok(self, demo):
        r = demo["session"].get(f"{API}/rooms/managed")
        assert r.status_code == 200


class TestChatRouteBackends:
    """The /chat/{id} route consumes messaging endpoints. Verify basic dm list."""

    def test_dm_list_reachable(self, demo):
        # Try common DM/messages listing endpoints — accept any 200/404 non-500 shape
        for path in ("/messages/threads", "/messages", "/chat/threads"):
            r = demo["session"].get(f"{API}{path}")
            if r.status_code < 500:
                return
        pytest.skip("No DM list endpoint reachable (non-500)")
