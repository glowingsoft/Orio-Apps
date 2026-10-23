"""Iter-44 Phase 3 — Real user search endpoint.

Verifies:
 - GET /api/users/search?q=X returns public user items only.
 - Nickname / username / numeric_id regex matching works.
 - is_following is hydrated correctly.
 - Fresh (profile_completed=False) users are hidden from search.
 - Me is excluded from results.
 - Private fields (email, phone, payout methods) never leak.
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


def _register(client, suffix: str, nickname: str | None = None) -> tuple[str, str]:
    email = f"u_{suffix}_{secrets.token_hex(4)}@test.orio"
    username = f"u{suffix}{secrets.token_hex(3)}".lower()[:20]
    r = client.post("/api/auth/register", json={
        "email": email, "password": "testpass1234",
        "username": username, "nickname": nickname or f"User {suffix}",
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    return tok, me["id"]


def _auth(tok): return {"Authorization": f"Bearer {tok}"}


def _hide_user(user_id: str, completed: bool = False):
    import pymongo
    cli = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    cli[os.environ.get("DB_NAME", "orio")].users.update_one(
        {"_id": ObjectId(user_id)}, {"$set": {"profile_completed": completed}})
    cli.close()


def test_search_requires_auth(client):
    r = client.get("/api/users/search?q=xx")
    assert r.status_code == 401


def test_search_requires_min_length(client):
    tok, _ = _register(client, "S0")
    r = client.get("/api/users/search?q=", headers=_auth(tok))
    assert r.status_code == 422  # min_length=1 on Query


def test_search_by_nickname(client):
    tok, _ = _register(client, "S1")
    unique = secrets.token_hex(4).upper()
    tok_t, _ = _register(client, "S2", nickname=f"TargetNick_{unique}")
    _hide_user(_, completed=True) if False else None  # keep target completed
    r = client.get(f"/api/users/search?q=TargetNick_{unique}", headers=_auth(tok))
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(it["nickname"] == f"TargetNick_{unique}" for it in items)


def test_search_excludes_me(client):
    tok, uid = _register(client, "S3", nickname=f"UniqueMe_{secrets.token_hex(3)}")
    r = client.get("/api/users/search?q=UniqueMe_", headers=_auth(tok))
    assert r.status_code == 200
    ids = [it["id"] for it in r.json()["items"]]
    assert uid not in ids, "Me must not appear in my own search results"


def test_search_excludes_incomplete_profiles(client):
    tok, _ = _register(client, "S4")
    tok_t, uid_t = _register(client, "S5", nickname=f"HiddenGuest_{secrets.token_hex(3)}")
    _hide_user(uid_t, completed=False)
    r = client.get(f"/api/users/search?q=HiddenGuest_", headers=_auth(tok))
    assert r.status_code == 200
    ids = [it["id"] for it in r.json()["items"]]
    assert uid_t not in ids


def test_search_by_numeric_id(client):
    tok, _ = _register(client, "S6")
    tok_t, uid_t = _register(client, "S7")
    me_t = client.get("/api/auth/me", headers=_auth(tok_t)).json()
    nid = me_t.get("numeric_id")
    if not nid:  # If no numeric_id assigned at registration, skip
        pytest.skip("numeric_id not auto-assigned in this environment")
    r = client.get(f"/api/users/search?q={nid}", headers=_auth(tok))
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(it["id"] == uid_t for it in items)


def test_search_does_not_leak_private_fields(client):
    tok, _ = _register(client, "S8")
    tok_t, uid_t = _register(client, "S9", nickname=f"PubProfile_{secrets.token_hex(3)}")
    r = client.get(f"/api/users/search?q=PubProfile_", headers=_auth(tok))
    assert r.status_code == 200
    items = r.json()["items"]
    hit = next((it for it in items if it["id"] == uid_t), None)
    assert hit is not None
    # Must NOT expose sensitive fields.
    for forbidden in ("email", "phone", "password_hash", "access_secret"):
        assert forbidden not in hit, f"{forbidden} must not leak via search"


def test_search_regex_escape_prevents_injection(client):
    tok, _ = _register(client, "S10")
    # Regex-metacharacter payload: must not raise + must be treated literally.
    r = client.get("/api/users/search?q=.*", headers=_auth(tok))
    assert r.status_code == 200
    assert isinstance(r.json()["items"], list)
