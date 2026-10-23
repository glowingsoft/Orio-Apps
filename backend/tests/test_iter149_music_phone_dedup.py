"""Iter-149 — Music sheet backend coverage.

Specific coverage for the NEW phone dedup rule (local_uri + owner_id) and
regression of the already-tested internet dedup, MIC_REQUIRED guard, and
remove permissions (owner / mod / adder).
"""
import os
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
PASS = "demo1234"


def _login(email: str, password: str = PASS):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} → {r.status_code} {r.text[:200]}"
    tok = r.json()["access_token"]
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
    return {"token": tok, "id": me.get("id") or me.get("_id"), "me": me}


def _auth(tok): return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def alice():
    return _login("test.1@oriotest.dev")


@pytest.fixture(scope="module")
def bob():
    return _login("test.2@oriotest.dev")


@pytest.fixture(scope="module")
def owner_user(db):
    """orioowner — becomes owner of the test room we create."""
    try:
        return _login("orioowner@gmail.com", "OwnerTest!2026")
    except AssertionError:
        return _login("demo@voiceup.app")


@pytest.fixture(scope="module")
def room(db, owner_user, alice, bob):
    """Create a fresh TEST_ room owned by owner_user. Alice is seated, Bob is not."""
    body = {"name": "TEST_iter149_music", "title": "TEST_iter149_music", "category": "music", "description": "music dedup test"}
    r = requests.post(f"{API}/rooms", json=body, headers=_auth(owner_user["token"]), timeout=15)
    assert r.status_code in (200, 201), r.text
    j = r.json()
    room_id = j.get("id") or j.get("_id") or (j.get("room") or {}).get("id")
    assert room_id, f"no id in {j}"
    # Save original owner_id so permission checks match owner_user
    db.rooms.update_one({"_id": ObjectId(room_id)}, {"$set": {
        "owner_id": owner_user["id"],
        "music": {"queue": [], "index": -1, "playing": False, "mode": "normal", "volume": 80, "dj_id": None},
        "seats": [
            {"index": 0, "user": {"id": owner_user["id"]}, "muted": False, "locked": False},
            {"index": 1, "user": {"id": alice["id"]}, "muted": False, "locked": False},
        ],
    }})
    yield room_id
    db.rooms.delete_one({"_id": ObjectId(room_id)})


# ───────── catalog ─────────
class TestCatalog:
    def test_catalog_has_30_items(self, alice):
        r = requests.get(f"{API}/music/catalog", headers=_auth(alice["token"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 30
        # each item has stable id/title/artist/licensed flag
        ids = {it["id"] for it in items}
        assert len(ids) == 30  # unique ids
        for it in items:
            assert it["id"] and it["title"] and it["artist"]
            assert "licensed" in it


# ───────── Internet dedup (regression) ─────────
class TestInternetDedup:
    def test_add_internet_then_duplicate_is_ignored(self, alice, room):
        cat_id = "enta_omri"
        r1 = requests.post(f"{API}/rooms/{room}/music/add",
                           json={"source": "internet", "title": "x", "catalog_id": cat_id},
                           headers=_auth(alice["token"]), timeout=15)
        assert r1.status_code == 200, r1.text
        q1 = r1.json()["queue"]
        assert any(q.get("catalog_id") == cat_id for q in q1)
        n1 = len([q for q in q1 if q.get("catalog_id") == cat_id])
        # duplicate request → same catalog_id entry count stays 1
        r2 = requests.post(f"{API}/rooms/{room}/music/add",
                           json={"source": "internet", "title": "x", "catalog_id": cat_id},
                           headers=_auth(alice["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        q2 = r2.json()["queue"]
        n2 = len([q for q in q2 if q.get("catalog_id") == cat_id])
        assert n1 == 1 and n2 == 1, f"catalog_id entries 1→1 expected, got {n1}→{n2}"

    def test_add_internet_bad_catalog_id(self, alice, room):
        r = requests.post(f"{API}/rooms/{room}/music/add",
                          json={"source": "internet", "title": "x", "catalog_id": "does_not_exist"},
                          headers=_auth(alice["token"]), timeout=15)
        assert r.status_code == 404


# ───────── Phone dedup (NEW: local_uri + owner_id) ─────────
class TestPhoneDedup:
    def test_phone_same_owner_same_uri_dedup(self, alice, room):
        uri = f"file:///TEST_iter149/song_{alice['id']}.mp3"
        body = {"source": "phone", "title": "TEST_song_1", "local_uri": uri}
        r1 = requests.post(f"{API}/rooms/{room}/music/add", json=body, headers=_auth(alice["token"]), timeout=15)
        assert r1.status_code == 200, r1.text
        q1 = r1.json()["queue"]
        cnt_a1 = len([q for q in q1 if q.get("local_uri") == uri and q.get("owner_id") == alice["id"]])
        assert cnt_a1 == 1
        # same uri, same owner → ignored
        r2 = requests.post(f"{API}/rooms/{room}/music/add", json=body, headers=_auth(alice["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        q2 = r2.json()["queue"]
        cnt_a2 = len([q for q in q2 if q.get("local_uri") == uri and q.get("owner_id") == alice["id"]])
        assert cnt_a2 == 1, "same (local_uri, owner_id) must dedup"

    def test_phone_different_owner_same_uri_allowed(self, alice, bob, room):
        uri = f"file:///TEST_iter149/shared.mp3"
        body = {"source": "phone", "title": "TEST_shared", "local_uri": uri}
        r1 = requests.post(f"{API}/rooms/{room}/music/add", json=body, headers=_auth(alice["token"]), timeout=15)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/rooms/{room}/music/add", json=body, headers=_auth(bob["token"]), timeout=15)
        assert r2.status_code == 200
        q = r2.json()["queue"]
        owners = [q0.get("owner_id") for q0 in q if q0.get("local_uri") == uri]
        assert alice["id"] in owners and bob["id"] in owners, f"different owners should both appear: {owners}"

    def test_phone_missing_local_uri_400(self, alice, room):
        r = requests.post(f"{API}/rooms/{room}/music/add",
                          json={"source": "phone", "title": "x"},
                          headers=_auth(alice["token"]), timeout=15)
        assert r.status_code == 400


# ───────── MIC_REQUIRED guard ─────────
class TestMicRequired:
    def test_play_not_seated_403(self, bob, room):
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "play"},
                          headers=_auth(bob["token"]), timeout=15)
        assert r.status_code == 403, r.text
        assert "MIC_REQUIRED" in r.text

    def test_select_not_seated_403(self, bob, room):
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "select", "index": 0},
                          headers=_auth(bob["token"]), timeout=15)
        assert r.status_code == 403, r.text
        assert "MIC_REQUIRED" in r.text

    def test_next_not_seated_403(self, bob, room):
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "next"},
                          headers=_auth(bob["token"]), timeout=15)
        assert r.status_code == 403, r.text
        assert "MIC_REQUIRED" in r.text

    def test_pause_not_seated_allowed_when_no_dj(self, bob, room, db):
        # Reset dj_id to None so any user may pause
        db.rooms.update_one({"_id": ObjectId(room)}, {"$set": {"music.dj_id": None}})
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "pause"},
                          headers=_auth(bob["token"]), timeout=15)
        # pause isn't in the strict-seat list, so this must succeed
        assert r.status_code == 200, r.text


# ───────── Remove permissions ─────────
class TestRemovePerms:
    def _add_and_index(self, token, room_id, title="TEST_iter149_remove"):
        uri = f"file:///TEST_iter149/{title}.mp3"
        r = requests.post(f"{API}/rooms/{room_id}/music/add",
                          json={"source": "phone", "title": title, "local_uri": uri},
                          headers=_auth(token), timeout=15)
        assert r.status_code == 200, r.text
        q = r.json()["queue"]
        idx = next((i for i, q0 in enumerate(q) if q0.get("local_uri") == uri), None)
        assert idx is not None
        return idx, uri

    def test_adder_can_remove(self, alice, room):
        idx, uri = self._add_and_index(alice["token"], room, title="TEST_rem_adder")
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "remove", "index": idx},
                          headers=_auth(alice["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert not any(q.get("local_uri") == uri for q in r.json()["queue"])

    def test_non_adder_cannot_remove(self, alice, bob, room):
        idx, uri = self._add_and_index(alice["token"], room, title="TEST_rem_nonadder")
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "remove", "index": idx},
                          headers=_auth(bob["token"]), timeout=15)
        assert r.status_code == 403, r.text
        assert "Not allowed" in r.text or "allowed" in r.text.lower()

    def test_owner_can_remove_any(self, alice, owner_user, room):
        idx, uri = self._add_and_index(alice["token"], room, title="TEST_rem_owner")
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "remove", "index": idx},
                          headers=_auth(owner_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert not any(q.get("local_uri") == uri for q in r.json()["queue"])

    def test_moderator_can_remove(self, alice, bob, owner_user, room, db):
        # promote bob to moderator
        db.rooms.update_one({"_id": ObjectId(room)}, {"$addToSet": {"moderators": bob["id"]}})
        idx, uri = self._add_and_index(alice["token"], room, title="TEST_rem_mod")
        r = requests.post(f"{API}/rooms/{room}/music/control",
                          json={"action": "remove", "index": idx},
                          headers=_auth(bob["token"]), timeout=15)
        assert r.status_code == 200, r.text
        db.rooms.update_one({"_id": ObjectId(room)}, {"$pull": {"moderators": bob["id"]}})
