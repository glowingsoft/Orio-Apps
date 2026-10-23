"""
Iter-105 — Posts feeds: popular (likes_count desc) and friends (mutual follows).

Test matrix:
- GET /api/posts  (no feed) → still works (latest).
- GET /api/posts?feed=popular → returns posts across all users sorted by
  likes_count desc then newest.
- GET /api/posts?feed=friends → only shows posts from authors with mutual
  follow (I follow them AND they follow me). Non-mutual authors are filtered.

Creates two temporary TEST_ users around the demo user, wires a mutual
follow + non-mutual follower, creates posts, verifies and cleans up.
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# ---------- helpers ----------
def _login(email: str, password: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register(prefix: str):
    """Create a fresh TEST_ account; returns (token, user_id, email)."""
    tag = uuid.uuid4().hex[:6]
    short = prefix[:6]
    email = f"test_{short}_{tag}@example.com"
    username = f"t_{short}_{tag}"  # <=20 chars
    nickname = f"T {short} {tag}"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestPass!2026", "username": username, "nickname": nickname},
        timeout=20,
    )
    assert r.status_code == 201, f"register failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=20).json()
    return tok, me["id"], email


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _create_post(tok, text):
    r = requests.post(f"{API}/posts", json={"text": text}, headers=_hdr(tok), timeout=20)
    assert r.status_code == 201, f"create post failed: {r.status_code} {r.text}"
    return r.json()["id"]


def _delete_post(tok, pid):
    requests.delete(f"{API}/posts/{pid}", headers=_hdr(tok), timeout=20)


def _follow(tok, uid):
    r = requests.post(f"{API}/users/{uid}/follow", headers=_hdr(tok), timeout=20)
    assert r.status_code in (200, 201), f"follow failed: {r.status_code} {r.text}"


def _unfollow(tok, uid):
    requests.delete(f"{API}/users/{uid}/follow", headers=_hdr(tok), timeout=20)


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def demo_me(demo_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {demo_token}"}, timeout=20)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def world(demo_token, demo_me):
    """Build mutual + non-mutual relationships and posts, then tear everything down."""
    mutual_tok, mutual_id, _ = _register("mutual")
    nonmutual_tok, nonmutual_id, _ = _register("nonmutual")

    demo_id = demo_me["id"]

    # Mutual: demo follows mutual AND mutual follows demo.
    _follow(demo_token, mutual_id)
    _follow(mutual_tok, demo_id)

    # Non-mutual: nonmutual follows demo, but demo does NOT follow back.
    _follow(nonmutual_tok, demo_id)

    # Posts: give the mutual user a verifiable post, the non-mutual too.
    mutual_marker = f"TEST_MUTUAL_{uuid.uuid4().hex[:6]}"
    nonmutual_marker = f"TEST_NONMUTUAL_{uuid.uuid4().hex[:6]}"
    mutual_post = _create_post(mutual_tok, mutual_marker)
    nonmutual_post = _create_post(nonmutual_tok, nonmutual_marker)

    # A demo post to also assert popular sort behavior.
    popular_marker = f"TEST_POPULAR_{uuid.uuid4().hex[:6]}"
    popular_post = _create_post(demo_token, popular_marker)
    # Like it a few times to push it to the top of popular.
    requests.post(f"{API}/posts/{popular_post}/like", headers=_hdr(mutual_tok), timeout=20)
    requests.post(f"{API}/posts/{popular_post}/like", headers=_hdr(nonmutual_tok), timeout=20)

    data = {
        "demo_id": demo_id,
        "mutual_tok": mutual_tok,
        "mutual_id": mutual_id,
        "mutual_post": mutual_post,
        "mutual_marker": mutual_marker,
        "nonmutual_tok": nonmutual_tok,
        "nonmutual_id": nonmutual_id,
        "nonmutual_post": nonmutual_post,
        "nonmutual_marker": nonmutual_marker,
        "popular_post": popular_post,
        "popular_marker": popular_marker,
    }
    yield data

    # ---- Cleanup ----
    _delete_post(mutual_tok, mutual_post)
    _delete_post(nonmutual_tok, nonmutual_post)
    _delete_post(demo_token, popular_post)
    _unfollow(demo_token, mutual_id)
    _unfollow(mutual_tok, demo_id)
    _unfollow(nonmutual_tok, demo_id)
    # best-effort delete of the throwaway users via mongo not available over HTTP;
    # TEST_ prefix guarantees they are easy to purge if needed.


# ---------- tests ----------
class TestPostsFeeds:
    def test_default_feed_still_works(self, demo_token, world):
        r = requests.get(f"{API}/posts", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # should contain at least our 3 markers somewhere
        texts = [p.get("text", "") for p in data]
        assert world["mutual_marker"] in texts
        assert world["nonmutual_marker"] in texts
        assert world["popular_marker"] in texts

    def test_popular_feed_sorted_by_likes_desc(self, demo_token, world):
        r = requests.get(f"{API}/posts?feed=popular", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0

        # likes_count must be monotonically non-increasing.
        counts = [p.get("likes_count", 0) for p in data]
        assert counts == sorted(counts, reverse=True), f"popular feed not sorted desc: {counts[:10]}"

        # The 2-liked popular_post should be present; and among posts with the
        # same max likes_count our popular_post should appear early.
        texts = [p.get("text", "") for p in data]
        assert world["popular_marker"] in texts

    def test_friends_feed_includes_mutual_only(self, demo_token, world):
        r = requests.get(f"{API}/posts?feed=friends", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        texts = [p.get("text", "") for p in data]
        # mutual's post MUST appear
        assert world["mutual_marker"] in texts, f"mutual marker missing from friends feed; got {texts}"
        # non-mutual's post MUST NOT appear
        assert world["nonmutual_marker"] not in texts, "non-mutual post leaked into friends feed"
        # demo's own post should NOT appear in friends either (self is not mutual-follow).
        assert world["popular_marker"] not in texts

    def test_friends_feed_empty_when_no_mutuals(self):
        """A brand-new user with zero mutual follows must receive an empty friends feed."""
        tok, _uid, _ = _register("lonely")
        r = requests.get(f"{API}/posts?feed=friends", headers=_hdr(tok), timeout=20)
        assert r.status_code == 200
        assert r.json() == []
