"""
ORIO Profile endpoint tests — iteration 12
Covers:
  - GET /api/auth/me returns numeric_id + new profile fields
  - PATCH /api/users/me accepts allowed fields (age, gender, bio, nickname, country_code, avatar_url)
  - numeric_id is immutable via PATCH /users/me
  - GET /api/users/by-numeric-id/{nid} — 200 for valid, 400 for bad input, 404 for unknown
  - GET /api/users/{id} — returns friends count + profile fields
"""
import os
import time
import random
import string
import requests
import pytest


BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL_TEST")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://audio-community-9.preview.emergentagent.com"
).rstrip("/")

OWNER_EMAIL = "posts_test@orio.app"
OWNER_PASSWORD = "Test12345!"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def owner_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Owner login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def owner_headers(owner_token) -> dict:
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def owner_me(owner_headers) -> dict:
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=owner_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _rand_suffix(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


@pytest.fixture(scope="session")
def second_user() -> dict:
    """Register a fresh second user for view-only + numeric-id tests."""
    suffix = _rand_suffix()
    payload = {
        "email": f"profile_view_{suffix}@orio.app",
        "password": "Test12345!",
        "username": f"pv_{suffix}",
        "nickname": f"View {suffix}",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    tokens = r.json()
    h = {"Authorization": f"Bearer {tokens['access_token']}", "Content-Type": "application/json"}
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=15).json()
    return {"tokens": tokens, "headers": h, "me": me}


# ---------- Tests: /auth/me ----------
class TestAuthMe:
    def test_me_returns_profile_fields(self, owner_me):
        # Required fields per public_user
        for k in [
            "id", "email", "username", "nickname", "bio", "numeric_id",
            "age", "gender", "friends", "followers", "following",
            "family_id", "family_name", "medals", "cover_url",
            "voice_bio_url", "voice_bio_duration", "created_at",
        ]:
            assert k in owner_me, f"/auth/me missing '{k}'"

    def test_me_numeric_id_is_8_digits(self, owner_me):
        nid = owner_me.get("numeric_id")
        assert isinstance(nid, str), f"numeric_id must be str, got {type(nid)}: {nid}"
        assert nid.isdigit(), f"numeric_id must be digits only: {nid}"
        assert len(nid) == 8, f"numeric_id must be 8 digits, got {len(nid)}: {nid}"

    def test_me_friends_is_int(self, owner_me):
        assert isinstance(owner_me["friends"], int)

    def test_me_owner_seeded_profile_values(self, owner_me):
        # Per problem statement: age=25, gender=male, country_code=AE, bio contains 'Voice chat'
        assert owner_me.get("age") == 25, f"expected age=25, got {owner_me.get('age')}"
        assert owner_me.get("gender") == "male"
        assert owner_me.get("country_code") == "AE"
        # Bio may have been touched by later tests, just assert it exists
        assert isinstance(owner_me.get("bio"), str)


# ---------- Tests: PATCH /users/me ----------
class TestUpdateMe:
    def test_patch_bio_and_readback(self, owner_headers):
        new_bio = f"Voice chat enthusiast — {_rand_suffix()}"
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"bio": new_bio}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["bio"] == new_bio
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=owner_headers, timeout=15).json()
        assert me["bio"] == new_bio
        # Restore original bio
        requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"bio": "Voice chat enthusiast"}, timeout=15,
        )

    def test_patch_age_valid(self, owner_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"age": 30}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["age"] == 30
        # Restore to 25
        requests.patch(f"{BASE_URL}/api/users/me", headers=owner_headers, json={"age": 25}, timeout=15)

    def test_patch_age_out_of_range(self, owner_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"age": 12}, timeout=15,
        )
        assert r.status_code in (400, 422), f"expected validation error, got {r.status_code}"
        r2 = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"age": 121}, timeout=15,
        )
        assert r2.status_code in (400, 422)

    def test_patch_gender(self, owner_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"gender": "female"}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["gender"] == "female"
        # restore
        requests.patch(f"{BASE_URL}/api/users/me", headers=owner_headers, json={"gender": "male"}, timeout=15)

    def test_patch_gender_invalid(self, owner_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"gender": "other"}, timeout=15,
        )
        assert r.status_code in (400, 422)

    def test_patch_country_code_resolves(self, owner_headers):
        # Change to US then back to AE
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"country_code": "US"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["country_code"] == "US"
        assert data.get("country") is not None and len(data["country"]) > 0
        assert data.get("country_flag") is not None and len(data["country_flag"]) > 0
        # Restore
        requests.patch(f"{BASE_URL}/api/users/me", headers=owner_headers, json={"country_code": "AE"}, timeout=15)

    def test_patch_nickname(self, owner_headers, owner_me):
        original = owner_me["nickname"]
        new_nick = f"Owner_{_rand_suffix(4)}"
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"nickname": new_nick}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["nickname"] == new_nick
        # Restore
        requests.patch(f"{BASE_URL}/api/users/me", headers=owner_headers,
                       json={"nickname": original}, timeout=15)

    def test_patch_avatar_url(self, owner_headers, owner_me):
        original = owner_me.get("avatar_url")
        new_url = "https://images.unsplash.com/photo-1500000000000-000000000000?w=200"
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"avatar_url": new_url}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["avatar_url"] == new_url
        # Restore
        if original is not None:
            requests.patch(f"{BASE_URL}/api/users/me", headers=owner_headers,
                           json={"avatar_url": original}, timeout=15)

    def test_patch_numeric_id_is_ignored_immutable(self, owner_headers, owner_me):
        """numeric_id is NOT in UpdateProfileIn — must be silently ignored."""
        original_nid = owner_me["numeric_id"]
        r = requests.patch(
            f"{BASE_URL}/api/users/me", headers=owner_headers,
            json={"numeric_id": "123456789", "bio": owner_me.get("bio") or ""}, timeout=15,
        )
        # Either 200 (extra field ignored) or 422 (extra forbid). Either way, numeric_id must not change.
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=owner_headers, timeout=15).json()
        assert me["numeric_id"] == original_nid, (
            f"numeric_id changed from {original_nid} to {me['numeric_id']} — must be immutable"
        )


# ---------- Tests: GET /users/by-numeric-id/{nid} ----------
class TestByNumericId:
    def test_lookup_valid(self, owner_headers, owner_me, second_user):
        nid = second_user["me"]["numeric_id"]
        assert nid and len(nid) == 8
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/{nid}", headers=owner_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["numeric_id"] == nid
        assert data["id"] == second_user["me"]["id"]
        assert "friends" in data
        assert "is_following" in data

    def test_lookup_owner_own_nid(self, owner_headers, owner_me):
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/{owner_me['numeric_id']}",
            headers=owner_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["id"] == owner_me["id"]

    def test_lookup_non_numeric_400(self, owner_headers):
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/abc123def", headers=owner_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_lookup_too_short_400(self, owner_headers):
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/12345", headers=owner_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400 for len<6, got {r.status_code}"

    def test_lookup_too_long_400(self, owner_headers):
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/1234567890123", headers=owner_headers, timeout=15,
        )
        assert r.status_code == 400, f"expected 400 for len>12, got {r.status_code}"

    def test_lookup_unknown_404(self, owner_headers):
        # Try a numeric id that almost certainly doesn't exist
        r = requests.get(
            f"{BASE_URL}/api/users/by-numeric-id/999999999", headers=owner_headers, timeout=15,
        )
        # Extremely unlikely to collide with any real numeric_id
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/users/by-numeric-id/123456789", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Tests: GET /users/{id} ----------
class TestGetUser:
    def test_get_owner_by_id(self, owner_headers, owner_me):
        r = requests.get(
            f"{BASE_URL}/api/users/{owner_me['id']}", headers=owner_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == owner_me["id"]
        assert data["numeric_id"] == owner_me["numeric_id"]
        assert "age" in data and "gender" in data
        assert "friends" in data and isinstance(data["friends"], int)
        assert "is_following" in data

    def test_get_second_user_by_id(self, owner_headers, second_user):
        r = requests.get(
            f"{BASE_URL}/api/users/{second_user['me']['id']}",
            headers=owner_headers, timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["numeric_id"] == second_user["me"]["numeric_id"]

    def test_get_unknown_user_404(self, owner_headers):
        # Bad ObjectId → 404 per current impl
        r = requests.get(
            f"{BASE_URL}/api/users/000000000000000000000000",
            headers=owner_headers, timeout=15,
        )
        assert r.status_code == 404

    def test_get_bad_id_404(self, owner_headers):
        r = requests.get(f"{BASE_URL}/api/users/not-an-id", headers=owner_headers, timeout=15)
        assert r.status_code == 404


# ---------- Tests: created_at (account age) ----------
class TestAccountAge:
    def test_me_created_at_parseable(self, owner_me):
        import datetime as _dt
        ts = owner_me["created_at"]
        # Ensure ISO format that JS Date can parse
        parsed = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        assert parsed.year >= 2024, f"created_at looks wrong: {ts}"
