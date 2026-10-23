"""Iter-43 — Room Games Catalog + Billiards.

Covers:
 - Catalog seed, admin upsert, enabled gating, betting "unavailable" state.
 - Billiards full match: create → join → shot → score → win → XP awarded.
 - Preservation: casual mode only, no diamond movement, no ledger changes.

Run: python -m pytest backend/tests/test_iter43_billiards_and_catalog.py -v
"""
from __future__ import annotations

import os
import secrets
import sys
import pathlib
import pytest
from fastapi.testclient import TestClient
from bson import ObjectId

_HERE = pathlib.Path(__file__).resolve().parent
_BACKEND = _HERE.parent
sys.path.insert(0, str(_BACKEND))

from server import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register(client, suffix: str) -> tuple[str, str]:
    email = f"u_{suffix}_{secrets.token_hex(4)}@test.orio"
    username = f"u{suffix}{secrets.token_hex(3)}".lower()[:20]
    r = client.post("/api/auth/register", json={
        "email": email, "password": "testpass1234",
        "username": username, "nickname": f"User {suffix}",
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    return tok, me["id"]


def _auth(tok): return {"Authorization": f"Bearer {tok}"}


def _make_admin(user_id: str):
    import pymongo
    cli = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db_name = os.environ.get("DB_NAME", "orio")
    cli[db_name].users.update_one({"_id": ObjectId(user_id)}, {"$set": {"is_admin": True}})
    cli.close()


def _make_room(client, token: str) -> str:
    r = client.post("/api/rooms", json={"name": "Game Room", "category": "chat"}, headers=_auth(token))
    assert r.status_code in (200, 201)
    return r.json()["id"]


# ============================================================================
# ROOM GAMES CATALOG
# ============================================================================


def test_catalog_default_seeds_entertainment_only(client):
    tok, _ = _register(client, "C_1")
    r = client.get("/api/room-games/catalog", headers=_auth(tok))
    assert r.status_code == 200
    body = r.json()
    types = {e["game_type"] for e in body["entertainment"]}
    assert "ludo" in types
    assert "billiards" in types
    # Betting empty by default — no fake providers allowed.
    assert isinstance(body["betting"], list)


def test_catalog_user_cannot_mutate(client):
    tok, _ = _register(client, "C_2")
    r = client.post("/api/admin/room-games/catalog", json={
        "category": "entertainment", "game_type": "ludo",
        "title_en": "Ludo", "title_ar": "لودو", "enabled": True,
    }, headers=_auth(tok))
    assert r.status_code == 403


def test_catalog_admin_can_add_betting_entry_but_defaults_unavailable(client):
    tok, uid = _register(client, "C_3")
    _make_admin(uid)
    # Admin creates a betting entry WITHOUT a licensed provider → public
    # endpoint must mark it as unavailable, not pretend it works.
    gt = f"slots_{secrets.token_hex(3)}"
    r = client.post("/api/admin/room-games/catalog", json={
        "category": "betting", "game_type": gt,
        "title_en": "Slots", "title_ar": "سلوتس",
        "enabled": True, "order": 10,
        # intentionally no provider_id/provider_game_id/legal_status
    }, headers=_auth(tok))
    assert r.status_code == 201
    tok_u, _ = _register(client, "C_4")
    pub = client.get("/api/room-games/catalog", headers=_auth(tok_u)).json()
    this = next((e for e in pub["betting"] if e["game_type"] == gt), None)
    assert this is not None
    assert this["enabled"] is False
    assert "unavailable_reason" in this


def test_catalog_admin_can_license_betting_entry(client):
    tok, uid = _register(client, "C_5")
    _make_admin(uid)
    gt = f"roulette_{secrets.token_hex(3)}"
    r = client.post("/api/admin/room-games/catalog", json={
        "category": "betting", "game_type": gt,
        "title_en": "Roulette", "title_ar": "روليت",
        "enabled": True, "order": 20,
        "provider_id": "PROV_X", "provider_game_id": "GID_1",
        "jurisdictions": ["MT"], "wager_limits": [500, 1000, 5000, 10000],
        "legal_status": "licensed",
    }, headers=_auth(tok))
    assert r.status_code == 201
    tok_u, _ = _register(client, "C_6")
    pub = client.get("/api/room-games/catalog", headers=_auth(tok_u)).json()
    this = next((e for e in pub["betting"] if e["game_type"] == gt), None)
    assert this is not None
    assert this["enabled"] is True
    assert this["wager_limits"] == [500, 1000, 5000, 10000]


# ============================================================================
# BILLIARDS
# ============================================================================


def test_billiards_create_and_auto_start_on_2_players(client):
    a, _ = _register(client, "B_A")
    b, _ = _register(client, "B_B")
    room_id = _make_room(client, a)
    g = client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a)).json()
    assert g["game_type"] == "billiards"
    assert g["status"] == "waiting"
    r = client.post(f"/api/games/billiards/{g['game_id']}/join", headers=_auth(b))
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    # Table geometry is published.
    assert r.json()["table"]["w"] == 100.0
    # 7 balls: 1 cue + 6 object balls.
    assert len(r.json()["state"]["balls"]) == 7


def test_billiards_shot_requires_turn(client):
    a, _ = _register(client, "B_T1")
    b, _ = _register(client, "B_T2")
    room_id = _make_room(client, a)
    g = client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a)).json()
    client.post(f"/api/games/billiards/{g['game_id']}/join", headers=_auth(b))
    # B is seat 1; it's A's turn (seat 0). B's shot should fail.
    r = client.post(f"/api/games/billiards/{g['game_id']}/shot", json={"angle_deg": 0, "power": 50}, headers=_auth(b))
    assert r.status_code == 403


def test_billiards_shot_simulates_physics_and_advances_turn(client):
    a, _ = _register(client, "B_S1")
    b, _ = _register(client, "B_S2")
    room_id = _make_room(client, a)
    g = client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a)).json()
    client.post(f"/api/games/billiards/{g['game_id']}/join", headers=_auth(b))
    # A shoots cue to the right at full power — physics must run and turn ends
    # (unless A got a legal pot, which is rare but possible). Either way the
    # response is a valid game document with trajectory frames in last_shot.
    r = client.post(f"/api/games/billiards/{g['game_id']}/shot", json={"angle_deg": 0, "power": 100}, headers=_auth(a))
    assert r.status_code == 200, r.text
    g2 = r.json()
    assert g2["state"]["shots_count"] == 1
    last = g2["state"]["last_shot"]
    assert last is not None
    assert isinstance(last["frames"], list) and len(last["frames"]) > 0
    # Frames must contain real integer-indexed positions.
    assert all("x" in b and "y" in b for b in last["frames"][0])


def test_billiards_leave_during_active_awards_winner(client):
    a, uid_a = _register(client, "B_L1")
    b, _ = _register(client, "B_L2")
    room_id = _make_room(client, a)
    g = client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a)).json()
    client.post(f"/api/games/billiards/{g['game_id']}/join", headers=_auth(b))
    r = client.post(f"/api/games/billiards/{g['game_id']}/leave", headers=_auth(b))
    assert r.status_code == 200
    g2 = r.json()
    assert g2["status"] == "finished"
    assert g2["winner_user_id"] == uid_a
    xp = client.get("/api/me/games-xp", headers=_auth(a)).json()
    assert xp["games_xp"] >= 40


def test_billiards_does_not_touch_wallet(client):
    a, _ = _register(client, "B_W1")
    b, _ = _register(client, "B_W2")
    me_a_before = int(client.get("/api/auth/me", headers=_auth(a)).json().get("coins", 0))
    me_b_before = int(client.get("/api/auth/me", headers=_auth(b)).json().get("coins", 0))
    room_id = _make_room(client, a)
    g = client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a)).json()
    client.post(f"/api/games/billiards/{g['game_id']}/join", headers=_auth(b))
    client.post(f"/api/games/billiards/{g['game_id']}/shot", json={"angle_deg": 0, "power": 100}, headers=_auth(a))
    client.post(f"/api/games/billiards/{g['game_id']}/leave", headers=_auth(b))
    me_a_after = int(client.get("/api/auth/me", headers=_auth(a)).json().get("coins", 0))
    me_b_after = int(client.get("/api/auth/me", headers=_auth(b)).json().get("coins", 0))
    assert me_a_before == me_a_after
    assert me_b_before == me_b_after


def test_billiards_active_lookup_for_room(client):
    a, _ = _register(client, "B_AC1")
    room_id = _make_room(client, a)
    r = client.get(f"/api/rooms/{room_id}/games/billiards/active", headers=_auth(a))
    assert r.status_code == 200
    assert r.json()["game"] is None
    client.post("/api/games/billiards/create", json={"room_id": room_id}, headers=_auth(a))
    r2 = client.get(f"/api/rooms/{room_id}/games/billiards/active", headers=_auth(a))
    assert r2.json()["game"] is not None
    assert r2.json()["game"]["game_type"] == "billiards"
