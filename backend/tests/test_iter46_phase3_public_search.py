"""Iter-46 — Phase 3 search endpoint reachability via PUBLIC EXPO_BACKEND_URL.

Validates the search endpoint is correctly routed through k8s ingress and
behaves per spec in production preview.
"""
from __future__ import annotations
import os
import secrets
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://audio-community-9.preview.emergentagent.com",
).rstrip("/")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


def test_public_search_requires_auth():
    r = requests.get(f"{BASE_URL}/api/users/search?q=xx", timeout=20)
    assert r.status_code == 401


def test_public_search_regex_escape_injection(auth):
    r = requests.get(f"{BASE_URL}/api/users/search", params={"q": ".*"},
                     headers=auth, timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json().get("items"), list)


def test_public_search_min_length(auth):
    r = requests.get(f"{BASE_URL}/api/users/search?q=", headers=auth, timeout=20)
    assert r.status_code == 422


def test_public_search_by_nickname_returns_items(auth):
    # 'demo' or 'user' is very likely to match seeded accounts.
    r = requests.get(f"{BASE_URL}/api/users/search", params={"q": "demo"},
                     headers=auth, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)


def test_public_search_strips_sensitive_fields(auth):
    r = requests.get(f"{BASE_URL}/api/users/search", params={"q": "a"},
                     headers=auth, timeout=20)
    assert r.status_code == 200
    for it in r.json().get("items", []):
        for forbidden in ("email", "phone", "password_hash", "access_secret", "_id"):
            assert forbidden not in it, f"{forbidden} leaked in {it}"


def test_public_search_excludes_me(auth):
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth, timeout=20).json()
    uid = me["id"]
    # search by my own nickname shouldn't include me
    r = requests.get(f"{BASE_URL}/api/users/search",
                     params={"q": me.get("nickname", "")[:4] or "demo"},
                     headers=auth, timeout=20)
    assert r.status_code == 200
    ids = [it["id"] for it in r.json().get("items", [])]
    assert uid not in ids


def test_public_demo_login_profile_completed():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200
    tok = r.json()["access_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=20).json()
    assert me.get("profile_completed") is True
    assert me.get("gender_locked") is True


def test_public_rooms_list_loads(auth):
    r = requests.get(f"{BASE_URL}/api/rooms", headers=auth, timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_public_phase2_gender_lock_409(auth):
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth, timeout=20).json()
    current_gender = me.get("gender")
    other = "female" if current_gender == "male" else "male"
    r = requests.patch(f"{BASE_URL}/api/users/me",
                       json={"gender": other}, headers=auth, timeout=20)
    assert r.status_code == 409, f"Expected 409 gender-lock, got {r.status_code}: {r.text}"
