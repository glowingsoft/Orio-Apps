"""ORIO iteration 19 — Discovery sorts (popular/pk) + following/watched + room_visits."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL_TEST") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# ---------- helpers ----------
def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_fresh(prefix="iter19"):
    tag = uuid.uuid4().hex[:8]
    payload = {
        "email": f"{prefix}_{tag}@voiceup.app",
        "password": "test1234",
        "username": f"{prefix}{tag}",
        "nickname": f"{prefix} {tag}",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, r.text
    j = r.json()
    tok = j["access_token"]
    uid = None
    if isinstance(j.get("user"), dict):
        uid = j["user"].get("id") or j["user"].get("_id")
    if not uid:
        me = requests.get(f"{API}/auth/me", headers=_hdr(tok), timeout=15)
        assert me.status_code == 200, me.text
        mj = me.json()
        uid = mj.get("id") or mj.get("_id") or mj.get("user_id")
    return tok, uid


def _create_room(token, name=None, num_seats=8):
    name = name or f"TEST iter19 {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/rooms",
        json={"name": name, "num_seats": num_seats, "category": "chat"},
        headers=_hdr(token),
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def _bump_listeners(token, rid):
    """Force listeners_count>0 so the room shows in discovery."""
    r = requests.post(f"{API}/rooms/{rid}/join", headers=_hdr(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def owner():
    t, uid = _register_fresh("iter19o")
    return {"token": t, "user_id": uid}


@pytest.fixture(scope="module")
def follower_a():
    t, uid = _register_fresh("iter19a")
    return {"token": t, "user_id": uid}


@pytest.fixture(scope="module")
def follower_b():
    t, uid = _register_fresh("iter19b")
    return {"token": t, "user_id": uid}


# ============================================================
# B1 — Popular sort
# ============================================================
class TestB1Popular:
    def test_popular_orders_by_follow_then_listeners(self, owner, follower_a, follower_b):
        # Two rooms with listeners>0. r_hi gets 2 followers, r_lo gets 0.
        r_hi = _create_room(owner["token"], "TEST iter19 HI")
        r_lo = _create_room(owner["token"], "TEST iter19 LO")
        _bump_listeners(owner["token"], r_hi["id"])
        _bump_listeners(owner["token"], r_lo["id"])

        # add follows to r_hi
        for u in (follower_a, follower_b):
            rf = requests.post(f"{API}/rooms/{r_hi['id']}/follow", headers=_hdr(u["token"]), timeout=15)
            assert rf.status_code == 200

        r = requests.get(f"{API}/rooms?sort=popular", headers=_hdr(owner["token"]), timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        # All returned rooms must have listeners>0
        for room in arr:
            assert room.get("listeners_count", 0) > 0, f"popular returned empty room: {room.get('name')}"
        # r_hi must precede r_lo
        ids = [x["id"] for x in arr]
        assert r_hi["id"] in ids, "r_hi missing from popular list"
        assert r_lo["id"] in ids, "r_lo missing from popular list"
        assert ids.index(r_hi["id"]) < ids.index(r_lo["id"]), \
            f"expected r_hi (2 follows) before r_lo (0 follows) — got {ids}"

    def test_popular_excludes_empty_rooms(self, owner):
        # New room with 0 listeners must NOT appear.
        room = _create_room(owner["token"], "TEST iter19 EMPTY")
        r = requests.get(f"{API}/rooms?sort=popular", headers=_hdr(owner["token"]), timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert room["id"] not in ids, "popular must exclude listeners=0 rooms"


# ============================================================
# B2 — PK sort
# ============================================================
class TestB2Pk:
    def test_pk_reflects_active_matches(self, owner):
        room = _create_room(owner["token"], "TEST iter19 PK")
        _bump_listeners(owner["token"], room["id"])
        rid = room["id"]

        # Baseline: this room not in ?sort=pk
        r0 = requests.get(f"{API}/rooms?sort=pk", headers=_hdr(owner["token"]), timeout=15)
        assert r0.status_code == 200
        assert rid not in [x["id"] for x in r0.json()]

        # Seat owner at seat 0 (host chair) and a second user at seat 1.
        ub_tok, _ub_uid = _register_fresh("iter19pkb")
        # follower_a joins so it can seat
        rj = requests.post(f"{API}/rooms/{rid}/join", headers=_hdr(ub_tok), timeout=15)
        assert rj.status_code == 200
        # owner is auto-seated at seat 0 on room creation. user_b takes seat 1
        s1 = requests.post(
            f"{API}/rooms/{rid}/seats/take",
            json={"seat_index": 1},
            headers=_hdr(ub_tok),
            timeout=15,
        )
        assert s1.status_code == 200, s1.text

        # Start PK between seat 0 and 1
        pk = requests.post(
            f"{API}/rooms/{rid}/pk/start",
            json={"seat_a": 0, "seat_b": 1, "duration_seconds": 60},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert pk.status_code == 200, pk.text

        r1 = requests.get(f"{API}/rooms?sort=pk", headers=_hdr(owner["token"]), timeout=15)
        assert r1.status_code == 200
        assert rid in [x["id"] for x in r1.json()], "pk sort must include room with active PK match"

        # Cleanup PK to avoid polluting later runs
        requests.post(f"{API}/rooms/{rid}/pk/end", headers=_hdr(owner["token"]), timeout=15)


# ============================================================
# B3 — Following rooms
# ============================================================
class TestB3RoomsFollowing:
    def test_following_reflects_follow_and_unfollow(self, owner, follower_a):
        room = _create_room(owner["token"], "TEST iter19 FLW")
        rid = room["id"]

        # Baseline: not followed
        r0 = requests.get(f"{API}/rooms/following", headers=_hdr(follower_a["token"]), timeout=15)
        assert r0.status_code == 200
        assert rid not in [x["id"] for x in r0.json()]

        # Follow
        rf = requests.post(f"{API}/rooms/{rid}/follow", headers=_hdr(follower_a["token"]), timeout=15)
        assert rf.status_code == 200
        r1 = requests.get(f"{API}/rooms/following", headers=_hdr(follower_a["token"]), timeout=15)
        assert r1.status_code == 200
        assert rid in [x["id"] for x in r1.json()], "following should contain the followed room"

        # Unfollow → should disappear
        ru = requests.delete(f"{API}/rooms/{rid}/follow", headers=_hdr(follower_a["token"]), timeout=15)
        assert ru.status_code == 200
        r2 = requests.get(f"{API}/rooms/following", headers=_hdr(follower_a["token"]), timeout=15)
        assert r2.status_code == 200
        assert rid not in [x["id"] for x in r2.json()], "unfollow must remove room from following list"


# ============================================================
# B4 — Watched rooms (room_visits upsert)
# ============================================================
class TestB4RoomsWatched:
    def test_watched_upserts_and_updates_order(self, owner, follower_b):
        r_first = _create_room(owner["token"], "TEST iter19 W1")
        r_second = _create_room(owner["token"], "TEST iter19 W2")

        # follower_b joins r_first, then r_second (newest last)
        rj1 = requests.post(f"{API}/rooms/{r_first['id']}/join", headers=_hdr(follower_b["token"]), timeout=15)
        assert rj1.status_code == 200
        rj2 = requests.post(f"{API}/rooms/{r_second['id']}/join", headers=_hdr(follower_b["token"]), timeout=15)
        assert rj2.status_code == 200

        r = requests.get(f"{API}/rooms/watched", headers=_hdr(follower_b["token"]), timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert r_first["id"] in ids and r_second["id"] in ids, ids
        # newest first — r_second (last joined) precedes r_first
        assert ids.index(r_second["id"]) < ids.index(r_first["id"]), \
            f"watched should be newest-first, got {ids}"

        # Re-join r_first → its visited_at should update; r_first should now precede r_second.
        rj3 = requests.post(f"{API}/rooms/{r_first['id']}/join", headers=_hdr(follower_b["token"]), timeout=15)
        assert rj3.status_code == 200
        r2 = requests.get(f"{API}/rooms/watched", headers=_hdr(follower_b["token"]), timeout=15)
        assert r2.status_code == 200
        ids2 = [x["id"] for x in r2.json()]
        assert ids2.index(r_first["id"]) < ids2.index(r_second["id"]), \
            f"second visit should promote r_first to top, got {ids2}"
        # ensure not duplicated
        assert ids2.count(r_first["id"]) == 1, "watched must not duplicate re-visited rooms"
