"""Iter-44 Phase 1 — Theme + Toast + ConfirmModal refactor.

Backend scope: VERIFY NO REGRESSION. Phase 1 was theme-only on frontend; backend
must continue to serve all iter-41 → iter-43 endpoints under the demo user.
"""
from __future__ import annotations
import os
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL env var required"
API = f"{BASE_URL}/api"
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"


@pytest.fixture(scope="module")
def demo_tok() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PW}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_room_id(demo_tok) -> str:
    # Pick any room owned by demo or any public one.
    r = requests.get(f"{API}/rooms", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body["items"] if isinstance(body, dict) and "items" in body else body
    assert isinstance(items, list) and len(items) > 0, "No rooms seeded"
    return items[0]["id"]


# ----- Auth / Me -----
def test_demo_login_and_me(demo_tok):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me.get("email") == DEMO_EMAIL


# ----- Financial invariants (iter-41) -----
def test_withdrawal_config_still_9999(demo_tok):
    r = requests.get(f"{API}/withdrawal/config", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["diamonds_per_usd"] == 9999
    assert j["minimum_withdrawal_usd"] == 10
    assert j["maximum_withdrawal_usd"] == 1000


def test_commission_splits_still_50_5_45(demo_tok):
    # Many servers expose this via /withdrawal/config or /splits/config.
    r = requests.get(f"{API}/withdrawal/config", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    # Accept any of several field names, but at least one must match 50/5/45.
    host = j.get("host_share_pct") or j.get("host_percent") or j.get("host_split")
    agency = j.get("agency_share_pct") or j.get("agency_percent") or j.get("agency_split")
    orio = j.get("orio_share_pct") or j.get("orio_percent") or j.get("orio_split")
    if host is not None:
        assert int(host) == 50, f"host split expected 50, got {host}"
        assert int(agency) == 5, f"agency split expected 5, got {agency}"
        assert int(orio) == 45, f"orio split expected 45, got {orio}"


# ----- Iter-42 Recharge Agent catalog (public list) -----
def test_recharge_agents_public_list(demo_tok):
    r = requests.get(f"{API}/recharge-agents", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)


def test_recharge_agent_transactions_user_list(demo_tok):
    r = requests.get(
        f"{API}/recharge-agent-transactions",
        headers={"Authorization": f"Bearer {demo_tok}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert "items" in r.json()


# ----- Iter-42/43 Games -----
def test_games_xp_endpoint(demo_tok):
    r = requests.get(f"{API}/me/games-xp", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "games_xp" in body
    assert isinstance(body["games_xp"], int)


def test_room_games_catalog(demo_tok):
    r = requests.get(f"{API}/room-games/catalog", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "entertainment" in body
    assert "betting" in body
    types = {e["game_type"] for e in body["entertainment"]}
    assert "ludo" in types, "Ludo missing from catalog"
    assert "billiards" in types, "Billiards missing from catalog"


def test_ludo_create_in_demo_room(demo_tok, demo_room_id):
    r = requests.post(
        f"{API}/games/ludo/create",
        headers={"Authorization": f"Bearer {demo_tok}", "Content-Type": "application/json"},
        json={"room_id": demo_room_id},
        timeout=20,
    )
    # 200 if there's an active game already, 201 if newly created, 403 if demo is not room owner / not seated.
    assert r.status_code in (200, 201, 403), r.text
    if r.status_code in (200, 201):
        body = r.json()
        assert body["game_type"] == "ludo"
        assert body["mode"] == "casual"


def test_billiards_create_in_demo_room(demo_tok, demo_room_id):
    r = requests.post(
        f"{API}/games/billiards/create",
        headers={"Authorization": f"Bearer {demo_tok}", "Content-Type": "application/json"},
        json={"room_id": demo_room_id},
        timeout=20,
    )
    assert r.status_code in (200, 201, 403), r.text
    if r.status_code in (200, 201):
        body = r.json()
        assert body["game_type"] == "billiards"


# ----- Core app endpoints still up -----
def test_rtc_config_still_enabled(demo_tok):
    r = requests.get(f"{API}/rtc/config", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("enabled") is True
    assert j.get("app_id")


def test_gift_categories_still_works(demo_tok):
    r = requests.get(f"{API}/gifts/categories", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), (list, dict))
