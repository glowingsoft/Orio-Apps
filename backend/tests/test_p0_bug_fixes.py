"""
P0 bug-fix verification tests for ORIO iteration.

Covers:
- 8-digit numeric_id (fresh registration + backfilled fixture user)
- GET /users/by-numeric-id/{nid}
- PATCH /users/me age validation (13..99)
- Fresh-user account age (created_at recent enough to render Day-1)
"""
import os
import random
import string
import time
import pytest
import requests

BASE = (os.environ.get("EXPO_BACKEND_URL_TEST") or os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")

FIXTURE_EMAIL = "posts_test@orio.app"
FIXTURE_PASSWORD = "Test12345!"


def _rand(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


@pytest.fixture(scope="module")
def fixture_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fixture_headers(fixture_token):
    return {"Authorization": f"Bearer {fixture_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def fresh_user():
    """Register a brand-new user for account-age / freshly-issued numeric_id tests."""
    email = f"p0_{_rand(8)}@orio.app"
    username = f"p0{_rand(6)}"
    payload = {
        "email": email,
        "password": "Test12345!",
        "username": username,
        "nickname": f"P0 {username}",
    }
    r = requests.post(f"{BASE}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"no token in register body: {body}"
    return {"email": email, "token": token, "headers": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}


# ---------- 8-digit numeric_id ----------
class TestNumericId8Digit:
    def test_fixture_user_has_8_digit_numeric_id(self, fixture_headers):
        r = requests.get(f"{BASE}/api/auth/me", headers=fixture_headers, timeout=15)
        assert r.status_code == 200
        me = r.json()
        nid = me.get("numeric_id")
        assert isinstance(nid, str), f"numeric_id not string: {nid!r}"
        assert nid.isdigit(), f"numeric_id not digits: {nid!r}"
        assert len(nid) == 8, f"expected 8-digit, got {len(nid)}: {nid!r} — backfill did not migrate"

    def test_fresh_user_gets_8_digit_numeric_id(self, fresh_user):
        r = requests.get(f"{BASE}/api/auth/me", headers=fresh_user["headers"], timeout=15)
        assert r.status_code == 200
        nid = r.json().get("numeric_id")
        assert nid and nid.isdigit() and len(nid) == 8, f"fresh user numeric_id bad: {nid!r}"

    def test_lookup_by_numeric_id_roundtrip(self, fixture_headers):
        r = requests.get(f"{BASE}/api/auth/me", headers=fixture_headers, timeout=15)
        me = r.json()
        nid = me["numeric_id"]
        r2 = requests.get(f"{BASE}/api/users/by-numeric-id/{nid}", headers=fixture_headers, timeout=15)
        assert r2.status_code == 200, f"by-numeric-id failed: {r2.status_code} {r2.text}"
        u = r2.json()
        assert u.get("numeric_id") == nid
        assert u.get("id") == me.get("id")


# ---------- Age validation 13..99 ----------
class TestAgeValidation:
    def test_age_99_ok(self, fixture_headers):
        r = requests.patch(f"{BASE}/api/users/me", headers=fixture_headers, json={"age": 99}, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("age") == 99

    def test_age_100_rejected(self, fixture_headers):
        r = requests.patch(f"{BASE}/api/users/me", headers=fixture_headers, json={"age": 100}, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"

    def test_age_13_ok(self, fixture_headers):
        r = requests.patch(f"{BASE}/api/users/me", headers=fixture_headers, json={"age": 13}, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("age") == 13

    def test_age_12_rejected(self, fixture_headers):
        r = requests.patch(f"{BASE}/api/users/me", headers=fixture_headers, json={"age": 12}, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"

    def test_restore_fixture_age(self, fixture_headers):
        r = requests.patch(f"{BASE}/api/users/me", headers=fixture_headers, json={"age": 25}, timeout=15)
        assert r.status_code == 200


# ---------- Account age / created_at Day-1 ----------
class TestAccountAgeDay1:
    def test_fresh_user_created_at_recent(self, fresh_user):
        """
        The frontend computes accountAgeDays with a Math.max(1, ...) clamp so day-1 renders.
        Ensure the server returns a well-formed created_at string within the last minute,
        which is the input the client relies on.
        """
        r = requests.get(f"{BASE}/api/auth/me", headers=fresh_user["headers"], timeout=15)
        assert r.status_code == 200
        me = r.json()
        created_at = me.get("created_at")
        assert isinstance(created_at, str) and len(created_at) >= 19, f"bad created_at: {created_at!r}"
        # Parse & assert recency (< 5 minutes for slow CI)
        from datetime import datetime, timezone
        # Support both '...Z' and '+00:00' offsets
        s = created_at.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            pytest.fail(f"created_at not ISO-8601: {created_at!r}")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = (datetime.now(timezone.utc) - dt).total_seconds()
        assert 0 <= delta < 300, f"created_at not recent: delta={delta}s value={created_at}"
