"""
Iter-100 retest — verify two bug fixes from iteration_43:
  (1) GET /api/auth/me returns live `following`/`followers`/`friends` counts
      matching GET /api/me/connections.
  (2) GET /api/users/{id} already returns live counts (regression guard).

Uses demo creds from /app/memory/test_credentials.md.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASS = "demo1234"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS}, timeout=20)
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text[:200]}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No access token in login response: {body}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# --- live-count parity ---------------------------------------------------

def test_auth_me_returns_live_follow_counts(session):
    """Bug (1): /auth/me must now include live following/followers/friends."""
    r_me = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r_me.status_code == 200, r_me.text
    me = r_me.json()
    for key in ("following", "followers", "friends"):
        assert key in me, f"/auth/me missing '{key}'"
        assert isinstance(me[key], int), f"'{key}' must be int, got {type(me[key])}"


def test_auth_me_counts_match_connections_endpoint(session):
    """The /auth/me live counts must equal the counts the user sees on /me/connections."""
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=15).json()

    r_following = session.get(f"{BASE_URL}/api/me/connections", params={"type": "following"}, timeout=15)
    r_followers = session.get(f"{BASE_URL}/api/me/connections", params={"type": "followers"}, timeout=15)
    r_friends = session.get(f"{BASE_URL}/api/me/connections", params={"type": "friends"}, timeout=15)
    assert r_following.status_code == 200
    assert r_followers.status_code == 200
    assert r_friends.status_code == 200

    following_list = r_following.json().get("items", r_following.json()) if isinstance(r_following.json(), dict) else r_following.json()
    followers_list = r_followers.json().get("items", r_followers.json()) if isinstance(r_followers.json(), dict) else r_followers.json()
    friends_list = r_friends.json().get("items", r_friends.json()) if isinstance(r_friends.json(), dict) else r_friends.json()

    assert me["following"] == len(following_list), f"following mismatch: me={me['following']} list={len(following_list)}"
    assert me["followers"] == len(followers_list), f"followers mismatch: me={me['followers']} list={len(followers_list)}"
    assert me["friends"] == len(friends_list), f"friends mismatch: me={me['friends']} list={len(friends_list)}"


def test_auth_me_counts_match_users_by_id(session):
    """/auth/me counts for user X must equal /users/{X} counts (both are live)."""
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
    uid = me.get("id") or me.get("_id")
    assert uid, f"/auth/me returned no user id: {me}"
    r_u = session.get(f"{BASE_URL}/api/users/{uid}", timeout=15)
    assert r_u.status_code == 200, r_u.text
    u = r_u.json()
    assert u["following"] == me["following"]
    assert u["followers"] == me["followers"]
    assert u["friends"] == me["friends"]


def test_users_by_id_live_counts_regression(session):
    """Regression guard for the already-working /users/{id} live counts."""
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
    uid = me.get("id") or me.get("_id")
    r = session.get(f"{BASE_URL}/api/users/{uid}", timeout=15)
    assert r.status_code == 200
    u = r.json()
    for key in ("following", "followers", "friends"):
        assert key in u and isinstance(u[key], int)


def test_other_user_profile_also_returns_live_counts(session):
    """Spot-check: ORIO user (6ab83dce459cd4cf632e6333) returns live counts."""
    r = session.get(f"{BASE_URL}/api/users/6ab83dce459cd4cf632e6333", timeout=15)
    assert r.status_code == 200
    u = r.json()
    for key in ("following", "followers", "friends"):
        assert key in u and isinstance(u[key], int)
    # Sanity: this is the account with an avatar_url (used by the image-viewer UI test).
    assert u.get("avatar_url"), "ORIO user should have an avatar_url for the viewer test"
