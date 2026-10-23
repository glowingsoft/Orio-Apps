"""
Iteration 33 — Block / Unblock / Report endpoints + follow & auth regression.

Uses the PUBLIC preview URL from frontend/.env (EXPO_PUBLIC_BACKEND_URL) so we
test what the mobile client actually hits.
"""
import os
import re
import uuid
import pytest
import requests
from pathlib import Path


# ---------- helpers ----------
def _load_public_backend_url() -> str:
    envp = Path("/app/frontend/.env")
    for line in envp.read_text().splitlines():
        m = re.match(r"\s*EXPO_PUBLIC_BACKEND_URL\s*=\s*(.+)", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found in frontend/.env")


BASE_URL = _load_public_backend_url().rstrip("/")
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASS = "demo1234"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def demo_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS}, timeout=15)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data or "token" in data, f"no token in login body: {data}"
    return data.get("access_token") or data.get("token")


@pytest.fixture(scope="module")
def demo_user(s, demo_token):
    r = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _register(s, email, password, username, nickname="Tester"):
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "username": username, "nickname": nickname},
        timeout=15,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return d.get("access_token") or d.get("token"), d.get("user") or {}


def _me(s, tok):
    r = s.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def user_a(s):
    """Fresh user A — will be the actor for block/report/follow."""
    uniq = uuid.uuid4().hex[:8]
    tok, _u = _register(s, f"iter33_a_{uniq}@voiceup.app", "password123", f"iter33a_{uniq}", "Iter33 A")
    me = _me(s, tok)
    return {"token": tok, "id": me.get("id") or me.get("_id")}


@pytest.fixture(scope="module")
def user_b(s):
    """Fresh user B — target for block/report/follow."""
    uniq = uuid.uuid4().hex[:8]
    tok, _u = _register(s, f"iter33_b_{uniq}@voiceup.app", "password123", f"iter33b_{uniq}", "Iter33 B")
    me = _me(s, tok)
    return {"token": tok, "id": me.get("id") or me.get("_id")}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------
# Regression: auth
# ------------------------------------------------------------------
class TestAuthRegression:
    def test_demo_login_returns_jwt(self, demo_token):
        # JWTs have 3 dot-separated segments.
        assert isinstance(demo_token, str) and demo_token.count(".") == 2

    def test_me_returns_user(self, demo_user):
        assert demo_user.get("email") == DEMO_EMAIL
        # ensure no mongo _id leaks
        assert "_id" not in demo_user


# ------------------------------------------------------------------
# NEW: Block / Unblock endpoints
# ------------------------------------------------------------------
class TestBlockEndpoints:
    def test_block_requires_auth(self, s, user_b):
        r = s.post(f"{BASE_URL}/api/users/{user_b['id']}/block", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_block_self_returns_400(self, s, user_a):
        r = s.post(
            f"{BASE_URL}/api/users/{user_a['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_block_unknown_user_returns_404(self, s, user_a):
        fake = "507f1f77bcf86cd799439011"  # valid ObjectId format, non-existent
        r = s.post(
            f"{BASE_URL}/api/users/{fake}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_block_returns_blocked_true(self, s, user_a, user_b):
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"blocked": True}

    def test_block_is_idempotent(self, s, user_a, user_b):
        # already blocked from previous test — repeat, must still succeed.
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"blocked": True}

    def test_unblock_returns_blocked_false(self, s, user_a, user_b):
        r = s.delete(
            f"{BASE_URL}/api/users/{user_b['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"blocked": False}

    def test_unblock_when_not_blocked_is_idempotent(self, s, user_a, user_b):
        r = s.delete(
            f"{BASE_URL}/api/users/{user_b['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == {"blocked": False}


# ------------------------------------------------------------------
# NEW: Block cascades — must break follows in BOTH directions
# ------------------------------------------------------------------
class TestBlockCascadesFollows:
    def _counts(self, s, uid, token):
        r = s.get(f"{BASE_URL}/api/users/{uid}", headers=_auth(token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        return int(d.get("followers", 0)), int(d.get("following", 0)), bool(d.get("is_following", False))

    def test_block_breaks_bidirectional_follows(self, s, user_a, user_b):
        # A follows B
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/follow",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json().get("following") is True

        # B follows A
        r = s.post(
            f"{BASE_URL}/api/users/{user_a['id']}/follow",
            headers=_auth(user_b["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text

        # Snapshot counts.
        b_followers_before, _, a_is_following_b = self._counts(s, user_b["id"], user_a["token"])
        a_followers_before, _, _ = self._counts(s, user_a["id"], user_b["token"])
        assert a_is_following_b is True, "A→B follow did not register"
        assert b_followers_before >= 1
        assert a_followers_before >= 1

        # A blocks B.
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/block",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"blocked": True}

        # A→B follow gone.
        _, _, a_is_following_b_after = self._counts(s, user_b["id"], user_a["token"])
        assert a_is_following_b_after is False, "A→B follow was NOT broken by block"

        # B's followers decremented.
        b_followers_after, _, _ = self._counts(s, user_b["id"], user_a["token"])
        assert b_followers_after == b_followers_before - 1, (
            f"B.followers should drop by 1: before={b_followers_before} after={b_followers_after}"
        )

        # A's followers decremented (B→A also broken).
        a_followers_after, _, _ = self._counts(s, user_a["id"], user_b["token"])
        assert a_followers_after == a_followers_before - 1, (
            f"A.followers should drop by 1 (B→A broken): before={a_followers_before} after={a_followers_after}"
        )

        # cleanup so later tests start clean
        s.delete(f"{BASE_URL}/api/users/{user_b['id']}/block", headers=_auth(user_a["token"]), timeout=15)


# ------------------------------------------------------------------
# NEW: Report endpoint
# ------------------------------------------------------------------
class TestReportEndpoint:
    def test_report_requires_auth(self, s, user_b):
        r = s.post(f"{BASE_URL}/api/users/{user_b['id']}/report", json={"reason": "spam"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_report_self_returns_400(self, s, user_a):
        r = s.post(
            f"{BASE_URL}/api/users/{user_a['id']}/report",
            json={"reason": "spam", "details": "n/a"},
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 400

    def test_report_unknown_user_returns_404(self, s, user_a):
        fake = "507f1f77bcf86cd799439011"
        r = s.post(
            f"{BASE_URL}/api/users/{fake}/report",
            json={"reason": "spam"},
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 404

    def test_report_success_returns_id(self, s, user_a, user_b):
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/report",
            json={"reason": "harassment", "details": "test details from iter33"},
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data.get("reported") is True
        rid = data.get("id")
        assert isinstance(rid, str) and len(rid) == 24, f"expected mongo id string, got {rid!r}"

    def test_report_accepts_empty_body(self, s, user_a, user_b):
        # reason/details are Optional in the pydantic model.
        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/report",
            json={},
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json().get("reported") is True


# ------------------------------------------------------------------
# Regression: follow / unfollow
# ------------------------------------------------------------------
class TestFollowRegression:
    def test_follow_then_unfollow(self, s, user_a, user_b):
        # ensure clean state
        s.delete(f"{BASE_URL}/api/users/{user_b['id']}/follow", headers=_auth(user_a["token"]), timeout=15)

        r = s.post(
            f"{BASE_URL}/api/users/{user_b['id']}/follow",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text
        assert r.json() == {"following": True}

        # user endpoint reflects is_following
        r = s.get(
            f"{BASE_URL}/api/users/{user_b['id']}",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("is_following") is True

        r = s.delete(
            f"{BASE_URL}/api/users/{user_b['id']}/follow",
            headers=_auth(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json() == {"following": False}

    def test_get_user_includes_is_following(self, s, demo_token, user_b):
        r = s.get(
            f"{BASE_URL}/api/users/{user_b['id']}",
            headers=_auth(demo_token),
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert "is_following" in body
        assert "_id" not in body


# ------------------------------------------------------------------
# Regression: rooms + rtc (iter-32 fixes)
# ------------------------------------------------------------------
class TestRoomsAndRtcRegression:
    def test_rooms_public(self, s, demo_token):
        # /api/rooms requires auth in ORIO backend.
        r = s.get(f"{BASE_URL}/api/rooms", headers=_auth(demo_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Response is either a list or an object with items
        assert isinstance(body, (list, dict))

    def test_rooms_mine_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/rooms/mine", timeout=15)
        assert r.status_code in (401, 403)

    def test_rooms_mine_with_auth(self, s, demo_token):
        r = s.get(f"{BASE_URL}/api/rooms/mine", headers=_auth(demo_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_rooms_managed_with_auth(self, s, demo_token):
        r = s.get(f"{BASE_URL}/api/rooms/managed", headers=_auth(demo_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_rtc_config(self, s):
        r = s.get(f"{BASE_URL}/api/rtc/config", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("enabled") is True
        assert isinstance(body.get("app_id"), str) and len(body["app_id"]) > 0

    def test_rtc_token(self, s, demo_token):
        # POST with {channel, uid}. Channel may or may not map to a room; endpoint
        # still returns a subscriber token in that case.
        r = s.post(
            f"{BASE_URL}/api/rtc/token",
            json={"channel": "orio_test_iter33", "uid": 12345},
            headers=_auth(demo_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("token"), str) and len(body["token"]) > 20
        assert body.get("app_id")
        assert body.get("channel") == "orio_test_iter33"
        assert body.get("uid") == 12345
        assert body.get("role") in ("publisher", "subscriber")
