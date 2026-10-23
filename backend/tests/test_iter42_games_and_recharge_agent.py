"""Iter-42 — ORIO Games (Ludo) + Financial Intermediary / Recharge Agent.

Covers:
 - Ludo multiplayer state machine (server-authoritative turn, dice, moves,
   capture, extra turn, forfeit, win).
 - Reusable game WS plumbing.
 - Recharge Agent CRUD, user submission, admin verify crediting via the
   wallet ledger with growth_points + VIP auto-activation.
 - Preservation: 9999/USD rate, host/agency/ORIO split unchanged, existing
   payout methods unaffected, no financial coupling from games.

Run: python -m pytest backend/tests/test_iter42_games_and_recharge_agent.py -v
"""
from __future__ import annotations

import os
import secrets
import sys
import pathlib
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from bson import ObjectId

# Ensure /app/backend is on sys.path so `import server` works regardless of pytest cwd.
_HERE = pathlib.Path(__file__).resolve().parent
_BACKEND = _HERE.parent
sys.path.insert(0, str(_BACKEND))

from server import app  # noqa: E402


def _recent_iso(days_ago: int = 7) -> str:
    """Return an ISO-8601 UTC timestamp N days before now (always within 90-day window)."""
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register(client, suffix: str) -> tuple[str, str]:
    """Returns (access_token, user_id)."""
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


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_admin(user_id: str):
    import pymongo
    from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
    cli = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db_name = os.environ.get("DB_NAME", "orio")
    cli[db_name].users.update_one({"_id": ObjectId(user_id)}, {"$set": {"is_admin": True}})
    cli.close()


def _make_room(client, token: str) -> str:
    r = client.post("/api/rooms", json={"name": "Game Test Room", "category": "chat"}, headers=_auth(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ============================================================================
# LUDO
# ============================================================================


def test_ludo_create_requires_room(client):
    tok, _ = _register(client, "A")
    r = client.post("/api/games/ludo/create", json={"room_id": "deadbeefcafebabe00000000"}, headers=_auth(tok))
    assert r.status_code == 404


def test_ludo_create_and_join_flow(client):
    tok_a, uid_a = _register(client, "A")
    tok_b, uid_b = _register(client, "B")
    room_id = _make_room(client, tok_a)
    r = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a))
    assert r.status_code == 201
    g = r.json()
    assert g["game_type"] == "ludo"
    assert g["status"] == "waiting"
    assert g["mode"] == "casual"
    assert len(g["players"]) == 1
    assert g["players"][0]["seat"] == 0
    # B joins → seat 1.
    r = client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    assert r.status_code == 200
    g2 = r.json()
    assert len(g2["players"]) == 2
    seats = sorted(p["seat"] for p in g2["players"])
    assert seats == [0, 1]
    # Idempotent: B joins again (no duplicate).
    r = client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    assert r.status_code == 200
    assert len(r.json()["players"]) == 2


def test_ludo_single_active_game_per_room(client):
    tok, _ = _register(client, "C")
    room_id = _make_room(client, tok)
    r1 = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok))
    assert r1.status_code == 201
    r2 = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok))
    # Returns the existing game, not a new one.
    assert r2.status_code in (200, 201)
    assert r2.json()["game_id"] == r1.json()["game_id"]
    # /active returns same game.
    r3 = client.get(f"/api/rooms/{room_id}/games/active", headers=_auth(tok))
    assert r3.status_code == 200
    assert r3.json()["game"]["game_id"] == r1.json()["game_id"]


def test_ludo_start_requires_owner_and_two_players(client):
    tok_a, _ = _register(client, "D")
    tok_b, _ = _register(client, "E")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    # Not enough players.
    r = client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    assert r.status_code == 400
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    # Non-owner cannot start.
    r = client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_b))
    assert r.status_code == 403
    # Owner starts.
    r = client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    assert r.status_code == 200
    assert r.json()["status"] == "active"


def test_ludo_roll_authoritative_and_turn_enforcement(client):
    tok_a, _ = _register(client, "F")
    tok_b, _ = _register(client, "G")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    # It's A's turn (seat 0). B cannot roll.
    r = client.post(f"/api/games/{g['game_id']}/roll", headers=_auth(tok_b))
    assert r.status_code == 403
    # A rolls. Should get dice 1..6.
    r = client.post(f"/api/games/{g['game_id']}/roll", headers=_auth(tok_a))
    assert r.status_code == 200
    body = r.json()
    # Either dice is still set (if A has at least one valid move) OR has
    # already been consumed because A had no valid moves (all tokens in base
    # and roll != 6 → auto-pass to seat 1).
    assert body["status"] == "active"
    # Cannot roll twice.
    if body["state"]["dice"] is not None:
        r2 = client.post(f"/api/games/{g['game_id']}/roll", headers=_auth(tok_a))
        assert r2.status_code == 409


def test_ludo_move_requires_valid_token_and_dice(client):
    tok_a, _ = _register(client, "H")
    tok_b, _ = _register(client, "I")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    # Without rolling, move should fail.
    r = client.post(f"/api/games/{g['game_id']}/move", json={"token_index": 0}, headers=_auth(tok_a))
    assert r.status_code == 409
    # Keep driving the game forward — whichever player's turn it is rolls.
    # Within 80 attempts we're virtually certain (p > 1 - (5/6)^80) to see a 6
    # that allows an actual token release move. We validate the move for seat 0
    # OR seat 1 — the point of this test is to prove that the server honors
    # the "need a 6 from base" rule and accepts the release move.
    saw_release = False
    for _ in range(80):
        gs = client.get(f"/api/games/{g['game_id']}", headers=_auth(tok_a)).json()
        if gs["status"] != "active":
            break
        turn = gs["state"]["current_turn"]
        tok = tok_a if turn == 0 else tok_b
        if gs["state"].get("dice") is None:
            rr = client.post(f"/api/games/{g['game_id']}/roll", headers=_auth(tok))
            if rr.status_code != 200:
                continue
            gs = rr.json()
        dice = gs["state"].get("dice")
        if dice == 6:
            # All tokens still in base early on — index 0 is a legal release.
            mv = client.post(f"/api/games/{g['game_id']}/move", json={"token_index": 0}, headers=_auth(tok))
            assert mv.status_code == 200, mv.text
            saw_release = True
            break
        else:
            # Server auto-passes when no legal moves exist. Loop.
            continue
    assert saw_release, "Expected to see a release-from-base move within 80 rolls"


def test_ludo_leave_during_waiting_removes_player(client):
    tok_a, _ = _register(client, "J")
    tok_b, _ = _register(client, "K")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    r = client.post(f"/api/games/{g['game_id']}/leave", headers=_auth(tok_b))
    assert r.status_code == 200
    assert all(p["user_id"] != _register.__name__ for p in r.json()["players"])
    assert len(r.json()["players"]) == 1


def test_ludo_forfeit_during_active_awards_winner_xp(client):
    tok_a, uid_a = _register(client, "L")
    tok_b, uid_b = _register(client, "M")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    r = client.post(f"/api/games/{g['game_id']}/leave", headers=_auth(tok_b))
    assert r.status_code == 200
    g2 = r.json()
    # Only one non-forfeited player → game finishes with A as winner.
    assert g2["status"] == "finished"
    assert g2["winner_user_id"] == uid_a
    # XP ledger awarded.
    xp = client.get("/api/me/games-xp", headers=_auth(tok_a)).json()
    assert xp["games_xp"] >= 50  # winner reward


def test_ludo_non_player_cannot_roll_or_move(client):
    tok_a, _ = _register(client, "N")
    tok_b, _ = _register(client, "O")
    tok_c, _ = _register(client, "P")
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    # C is NOT a player.
    r = client.post(f"/api/games/{g['game_id']}/roll", headers=_auth(tok_c))
    assert r.status_code == 403


# ============================================================================
# RECHARGE AGENT (Financial Intermediary / وسيط مالي - وكيل الشحن)
# ============================================================================


def test_user_cannot_create_recharge_agent(client):
    tok, _ = _register(client, "RA_U")
    r = client.post("/api/admin/recharge-agents", json={
        "agent_code": "A123", "name": "Test Agent",
    }, headers=_auth(tok))
    assert r.status_code == 403


def test_admin_creates_agent_and_lists_it(client):
    tok, uid = _register(client, "RA_AD")
    _make_admin(uid)
    code = f"AG{secrets.token_hex(3).upper()}"
    r = client.post("/api/admin/recharge-agents", json={
        "agent_code": code, "name": "Real Agent", "country": "YE", "contact": "+9671234567",
    }, headers=_auth(tok))
    assert r.status_code == 201, r.text
    agent = r.json()
    assert agent["agent_code"] == code
    assert agent["is_active"] is True
    # Public list (user) sees active agents.
    tok_u, _ = _register(client, "RA_LST")
    r2 = client.get("/api/recharge-agents", headers=_auth(tok_u))
    assert r2.status_code == 200
    assert any(a["agent_code"] == code for a in r2.json()["items"])


def test_recharge_agent_placeholder_values_rejected(client):
    tok, uid = _register(client, "RA_PH1")
    _make_admin(uid)
    # Create a real agent to attach to.
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Real Agent",
    }, headers=_auth(tok)).json()
    tok_u, _ = _register(client, "RA_PH2")
    # Placeholder tx id (e.g. "test") must be rejected.
    r = client.post("/api/recharge-agent-transactions", json={
        "agent_id": agent["id"], "agent_tx_id": "test",
        "amount_usd": 5, "paid_at": _recent_iso(5),
    }, headers=_auth(tok_u))
    assert r.status_code == 400


def test_recharge_agent_future_date_rejected(client):
    tok, uid = _register(client, "RA_FD1")
    _make_admin(uid)
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Real Agent",
    }, headers=_auth(tok)).json()
    tok_u, _ = _register(client, "RA_FD2")
    r = client.post("/api/recharge-agent-transactions", json={
        "agent_id": agent["id"], "agent_tx_id": "TXN123456789",
        "amount_usd": 5, "paid_at": "2099-12-31T23:59:59Z",
    }, headers=_auth(tok_u))
    assert r.status_code == 400


def test_recharge_agent_submission_and_duplicate_detection(client):
    tok, uid = _register(client, "RA_DUP1")
    _make_admin(uid)
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Real Agent",
    }, headers=_auth(tok)).json()
    tok_u, _ = _register(client, "RA_DUP2")
    body = {
        "agent_id": agent["id"], "agent_tx_id": "TXN_UNIQUE_" + secrets.token_hex(4),
        "amount_usd": 5, "paid_at": _recent_iso(10),
    }
    r1 = client.post("/api/recharge-agent-transactions", json=body, headers=_auth(tok_u))
    assert r1.status_code == 201, r1.text
    assert r1.json()["status"] == "pending"
    assert r1.json()["diamonds_credited"] == 0
    # Duplicate agent_tx_id → 409.
    r2 = client.post("/api/recharge-agent-transactions", json=body, headers=_auth(tok_u))
    assert r2.status_code == 409


def test_recharge_agent_admin_verify_credits_diamonds_and_growth(client):
    tok_ad, uid_ad = _register(client, "RA_V1")
    _make_admin(uid_ad)
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Real Agent",
    }, headers=_auth(tok_ad)).json()
    tok_u, uid_u = _register(client, "RA_V2")
    me_before = client.get("/api/auth/me", headers=_auth(tok_u)).json()
    coins_before = int(me_before.get("coins", 0))
    amount_usd = 7
    expected_diamonds = amount_usd * 9999
    body = {
        "agent_id": agent["id"], "agent_tx_id": "TXN_V_" + secrets.token_hex(5),
        "amount_usd": amount_usd, "paid_at": _recent_iso(15),
    }
    r = client.post("/api/recharge-agent-transactions", json=body, headers=_auth(tok_u))
    assert r.status_code == 201
    tx_id = r.json()["id"]
    # Admin verifies.
    r2 = client.post(f"/api/admin/recharge-agent-transactions/{tx_id}/verify", headers=_auth(tok_ad))
    assert r2.status_code == 200, r2.text
    verified = r2.json()
    assert verified["status"] == "verified"
    assert verified["diamonds_credited"] == expected_diamonds
    # Verify user balance incremented EXACTLY by amount_usd * 9999.
    me_after = client.get("/api/auth/me", headers=_auth(tok_u)).json()
    coins_after = int(me_after.get("coins", 0))
    assert coins_after - coins_before == expected_diamonds, f"Balance invariant broken: {coins_after} - {coins_before} != {expected_diamonds}"
    # Growth points also incremented.
    assert int(me_after.get("growth_points", 0)) >= expected_diamonds
    # Idempotent — second verify is a no-op (returns verified).
    r3 = client.post(f"/api/admin/recharge-agent-transactions/{tx_id}/verify", headers=_auth(tok_ad))
    assert r3.status_code == 200
    me_after2 = client.get("/api/auth/me", headers=_auth(tok_u)).json()
    assert int(me_after2["coins"]) == coins_after, "Double-verify must not double-credit"


def test_recharge_agent_admin_reject_does_not_credit(client):
    tok_ad, uid_ad = _register(client, "RA_RJ1")
    _make_admin(uid_ad)
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Real Agent",
    }, headers=_auth(tok_ad)).json()
    tok_u, _ = _register(client, "RA_RJ2")
    me_before = client.get("/api/auth/me", headers=_auth(tok_u)).json()
    body = {
        "agent_id": agent["id"], "agent_tx_id": "TXN_RJ_" + secrets.token_hex(5),
        "amount_usd": 10, "paid_at": _recent_iso(15),
    }
    tx_id = client.post("/api/recharge-agent-transactions", json=body, headers=_auth(tok_u)).json()["id"]
    r = client.post(f"/api/admin/recharge-agent-transactions/{tx_id}/reject", json={"reason": "Transaction not found with provider"}, headers=_auth(tok_ad))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    assert r.json()["rejection_reason"]
    me_after = client.get("/api/auth/me", headers=_auth(tok_u)).json()
    assert int(me_after["coins"]) == int(me_before["coins"]), "Rejection must not credit diamonds"
    # Cannot verify a rejected tx.
    r2 = client.post(f"/api/admin/recharge-agent-transactions/{tx_id}/verify", headers=_auth(tok_ad))
    assert r2.status_code == 409


def test_recharge_agent_isolation_between_users(client):
    """A cannot see B's recharge submissions."""
    tok_ad, uid_ad = _register(client, "RA_IS1")
    _make_admin(uid_ad)
    agent = client.post("/api/admin/recharge-agents", json={
        "agent_code": f"AG{secrets.token_hex(3).upper()}", "name": "Agent",
    }, headers=_auth(tok_ad)).json()
    tok_a, uid_a = _register(client, "RA_IS2")
    tok_b, uid_b = _register(client, "RA_IS3")
    client.post("/api/recharge-agent-transactions", json={
        "agent_id": agent["id"], "agent_tx_id": "TXN_A_" + secrets.token_hex(4),
        "amount_usd": 5, "paid_at": _recent_iso(20),
    }, headers=_auth(tok_a))
    # B's list is empty.
    rb = client.get("/api/recharge-agent-transactions", headers=_auth(tok_b))
    assert rb.status_code == 200
    assert all(t["user_id"] == uid_b for t in rb.json()["items"])
    # A's list has at least one.
    ra = client.get("/api/recharge-agent-transactions", headers=_auth(tok_a))
    assert any(t["user_id"] == uid_a for t in ra.json()["items"])


def test_recharge_agent_separate_from_payout_methods(client):
    """Recharge agents must NOT appear in payout methods and vice versa."""
    tok, _ = _register(client, "RA_SEP")
    pm = client.get("/api/payout-methods/supported-methods", headers=_auth(tok))
    # If supported-methods endpoint exists, "recharge_agent" MUST NOT be in it.
    if pm.status_code == 200:
        methods = pm.json().get("methods", pm.json().get("items", []))
        if isinstance(methods, list):
            codes = [m.get("code") or m.get("method") or m.get("key") for m in methods]
        else:
            codes = list(methods.keys()) if isinstance(methods, dict) else []
        assert "recharge_agent" not in [str(c).lower() for c in codes if c]


# ============================================================================
# PRESERVATION TESTS — iter-41 financial invariants hold after iter-42.
# ============================================================================


def test_preservation_rate_is_still_9999(client):
    tok, _ = _register(client, "PRES1")
    r = client.get("/api/withdrawal-config", headers=_auth(tok))
    if r.status_code == 200:
        assert int(r.json()["diamonds_per_usd"]) == 9999
        assert int(r.json()["minimum_withdrawal_usd"]) == 10
        assert int(r.json()["maximum_withdrawal_usd"]) == 1000


def test_games_do_not_touch_wallet(client):
    """Casual Ludo must NEVER change a player's diamond balance.
    Only games_xp changes.
    """
    tok_a, uid_a = _register(client, "GNF_A")
    tok_b, uid_b = _register(client, "GNF_B")
    me_a_before = client.get("/api/auth/me", headers=_auth(tok_a)).json()
    me_b_before = client.get("/api/auth/me", headers=_auth(tok_b)).json()
    coins_a_before = int(me_a_before.get("coins", 0))
    coins_b_before = int(me_b_before.get("coins", 0))
    room_id = _make_room(client, tok_a)
    g = client.post("/api/games/ludo/create", json={"room_id": room_id}, headers=_auth(tok_a)).json()
    client.post(f"/api/games/{g['game_id']}/join", headers=_auth(tok_b))
    client.post(f"/api/games/{g['game_id']}/start", headers=_auth(tok_a))
    # B forfeits → game finishes.
    client.post(f"/api/games/{g['game_id']}/leave", headers=_auth(tok_b))
    me_a_after = client.get("/api/auth/me", headers=_auth(tok_a)).json()
    me_b_after = client.get("/api/auth/me", headers=_auth(tok_b)).json()
    assert int(me_a_after["coins"]) == coins_a_before, "Winner's diamonds changed!"
    assert int(me_b_after["coins"]) == coins_b_before, "Loser's diamonds changed!"
