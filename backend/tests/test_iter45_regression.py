"""Iter-45 regression — demo user login + withdrawal config + room-games catalog."""
from __future__ import annotations
import os, pathlib, sys
import pytest, requests

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "demo@voiceup.app", "password": "demo1234"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_demo_login_profile_completed(demo_token):
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {demo_token}"}, timeout=15).json()
    assert me.get("profile_completed") is True, f"demo user not migrated: {me}"


def test_withdrawal_config_values(demo_token):
    r = requests.get(f"{BASE_URL}/api/withdrawal/config",
                     headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
    assert r.status_code == 200
    cfg = r.json()
    assert cfg["diamonds_per_usd"] == 9999
    assert cfg["minimum_withdrawal_usd"] == 10
    assert cfg["maximum_withdrawal_usd"] == 1000


def test_room_games_catalog(demo_token):
    r = requests.get(f"{BASE_URL}/api/room-games/catalog",
                     headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
    assert r.status_code == 200
    cat = r.json()
    assert "entertainment" in cat and "betting" in cat
    types = {g["game_type"] for g in cat["entertainment"] + cat["betting"]}
    assert "ludo" in types
    assert "billiards" in types


def test_countries_endpoint_for_eg(demo_token):
    r = requests.get(f"{BASE_URL}/api/countries",
                     headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    eg = next((c for c in rows if c["code"] == "EG"), None)
    assert eg is not None
    assert eg["name"] == "Egypt"
    assert eg.get("flag")


def test_profile_complete_endpoint_through_public_url(demo_token):
    # Just assert the endpoint exists (demo user already completed -> expect 409 or similar).
    r = requests.post(f"{BASE_URL}/api/me/profile/complete",
                      json={"nickname": "demo2", "gender": "male", "age": 25, "country_code": "EG"},
                      headers={"Authorization": f"Bearer {demo_token}"}, timeout=15)
    # Demo user has gender already (likely male). Same gender -> 200; different -> 409.
    assert r.status_code in (200, 409), r.text
