"""ORIO iteration 18 — Follow / Membership / Moderators / Bans / Recommended sort."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_fresh():
    tag = uuid.uuid4().hex[:8]
    payload = {
        "email": f"iter18_{tag}@voiceup.app",
        "password": "test1234",
        "username": f"iter18{tag}",
        "nickname": f"Iter18 {tag}",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, r.text
    j = r.json()
    tok = j["access_token"]
    # Fall back to /auth/me for canonical id
    uid = None
    if isinstance(j.get("user"), dict):
        uid = j["user"].get("id") or j["user"].get("_id")
    if not uid:
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert me.status_code == 200, me.text
        mj = me.json()
        uid = mj.get("id") or mj.get("_id") or mj.get("user_id")
    return tok, uid


def _me(token):
    r = requests.get(f"{API}/auth/me", headers=_hdr(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _create_room(token, name=None, num_seats=8):
    name = name or f"TEST iter18 {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/rooms",
        json={"name": name, "num_seats": num_seats, "category": "chat"},
        headers=_hdr(token),
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- session fixtures ----------
@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def owner():
    token, uid = _register_fresh()
    return {"token": token, "user_id": uid}


@pytest.fixture(scope="module")
def user_b():
    token, uid = _register_fresh()
    return {"token": token, "user_id": uid}


@pytest.fixture(scope="module")
def user_c():
    token, uid = _register_fresh()
    return {"token": token, "user_id": uid}


@pytest.fixture(scope="module")
def owned_room(owner):
    return _create_room(owner["token"])


# ============================================================
# B1 — Follow idempotency
# ============================================================
class TestB1Follow:
    def test_follow_idempotent_and_unfollow(self, user_b, owned_room):
        rid = owned_room["id"]
        # Follow twice
        r1 = requests.post(f"{API}/rooms/{rid}/follow", headers=_hdr(user_b["token"]), timeout=15)
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert j1["following"] is True
        assert j1["follow_count"] == 1

        r2 = requests.post(f"{API}/rooms/{rid}/follow", headers=_hdr(user_b["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["follow_count"] == 1, "double-follow must NOT double-count"

        # Unfollow
        r3 = requests.delete(f"{API}/rooms/{rid}/follow", headers=_hdr(user_b["token"]), timeout=15)
        assert r3.status_code == 200
        assert r3.json()["follow_count"] == 0
        assert r3.json()["following"] is False


# ============================================================
# B2 — Follow status schema
# ============================================================
class TestB2FollowStatus:
    def test_status_shape(self, user_b, owned_room):
        rid = owned_room["id"]
        r = requests.get(f"{API}/rooms/{rid}/follow-status", headers=_hdr(user_b["token"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        for k in ("is_following", "is_member", "has_pending_request", "follow_count", "member_count"):
            assert k in j, f"missing key {k}"
        assert isinstance(j["is_following"], bool)
        assert isinstance(j["is_member"], bool)
        assert isinstance(j["has_pending_request"], bool)
        assert isinstance(j["follow_count"], int)
        assert isinstance(j["member_count"], int)


# ============================================================
# B3 — Membership flow
# ============================================================
class TestB3Membership:
    def test_request_without_follow_400(self, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.post(f"{API}/rooms/{rid}/membership/request", headers=_hdr(user_c["token"]), timeout=15)
        assert r.status_code == 400, r.text

    def test_request_after_follow_ok(self, user_c, owned_room):
        rid = owned_room["id"]
        rf = requests.post(f"{API}/rooms/{rid}/follow", headers=_hdr(user_c["token"]), timeout=15)
        assert rf.status_code == 200
        r = requests.post(f"{API}/rooms/{rid}/membership/request", headers=_hdr(user_c["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"

    def test_duplicate_pending_409(self, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.post(f"{API}/rooms/{rid}/membership/request", headers=_hdr(user_c["token"]), timeout=15)
        assert r.status_code == 409, r.text

    def test_pending_visible_to_owner(self, owner, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.get(f"{API}/rooms/{rid}/membership/pending", headers=_hdr(owner["token"]), timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert any(x["user_id"] == user_c["user_id"] for x in arr), arr

    def test_pending_forbidden_for_non_owner(self, user_b, owned_room):
        rid = owned_room["id"]
        r = requests.get(f"{API}/rooms/{rid}/membership/pending", headers=_hdr(user_b["token"]), timeout=15)
        assert r.status_code == 403

    def test_non_owner_review_forbidden(self, user_b, user_c, owned_room):
        rid = owned_room["id"]
        # Fetch request id as owner would not help — use user_b to attempt review with any id
        r = requests.post(
            f"{API}/rooms/{rid}/membership/review",
            json={"request_id": "507f1f77bcf86cd799439011", "action": "approve"},
            headers=_hdr(user_b["token"]),
            timeout=15,
        )
        assert r.status_code == 403

    def test_owner_approves_creates_member(self, owner, user_c, owned_room):
        rid = owned_room["id"]
        # get pending id
        rp = requests.get(f"{API}/rooms/{rid}/membership/pending", headers=_hdr(owner["token"]), timeout=15)
        req_id = next(x["id"] for x in rp.json() if x["user_id"] == user_c["user_id"])
        r = requests.post(
            f"{API}/rooms/{rid}/membership/review",
            json={"request_id": req_id, "action": "approve"},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        # Verify member appears
        rm = requests.get(f"{API}/rooms/{rid}/members", headers=_hdr(owner["token"]), timeout=15)
        assert rm.status_code == 200
        assert any(x["user_id"] == user_c["user_id"] for x in rm.json())

    def test_reject_does_not_add_member(self, owner, owned_room):
        # New user follows and requests, owner rejects, member list must not include them
        rid = owned_room["id"]
        tok, uid = _register_fresh()
        requests.post(f"{API}/rooms/{rid}/follow", headers=_hdr(tok), timeout=15)
        rq = requests.post(f"{API}/rooms/{rid}/membership/request", headers=_hdr(tok), timeout=15)
        assert rq.status_code == 200
        rp = requests.get(f"{API}/rooms/{rid}/membership/pending", headers=_hdr(owner["token"]), timeout=15)
        req_id = next(x["id"] for x in rp.json() if x["user_id"] == uid)
        r = requests.post(
            f"{API}/rooms/{rid}/membership/review",
            json={"request_id": req_id, "action": "reject"},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        rm = requests.get(f"{API}/rooms/{rid}/members", headers=_hdr(owner["token"]), timeout=15)
        assert not any(x["user_id"] == uid for x in rm.json())


# ============================================================
# B4 — Moderators
# ============================================================
class TestB4Moderators:
    def test_add_non_member_400(self, owner, user_b, owned_room):
        # user_b is following but never approved → not a member
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/moderators/add",
            json={"user_id": user_b["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_add_after_approval_ok(self, owner, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/moderators/add",
            json={"user_id": user_c["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Verify listed
        rm = requests.get(f"{API}/rooms/{rid}/moderators", headers=_hdr(owner["token"]), timeout=15)
        assert rm.status_code == 200
        assert any(x["user_id"] == user_c["user_id"] for x in rm.json())

    def test_non_owner_add_forbidden(self, user_b, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/moderators/add",
            json={"user_id": user_c["user_id"]},
            headers=_hdr(user_b["token"]),
            timeout=15,
        )
        assert r.status_code == 403

    def test_owner_remove_ok(self, owner, user_c, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/moderators/remove",
            json={"user_id": user_c["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        rm = requests.get(f"{API}/rooms/{rid}/moderators", headers=_hdr(owner["token"]), timeout=15)
        assert not any(x["user_id"] == user_c["user_id"] for x in rm.json())


# ============================================================
# B5 — Bans
# ============================================================
class TestB5Bans:
    def test_ban_owner_forbidden(self, owner, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/bans/add",
            json={"user_id": owner["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_owner_bans_valid_user(self, owner, user_b, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/bans/add",
            json={"user_id": user_b["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        rb = requests.get(f"{API}/rooms/{rid}/bans", headers=_hdr(owner["token"]), timeout=15)
        assert any(x["user_id"] == user_b["user_id"] for x in rb.json())

    def test_banned_user_join_forbidden(self, user_b, owned_room):
        rid = owned_room["id"]
        r = requests.post(f"{API}/rooms/{rid}/join", headers=_hdr(user_b["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_unban_removes_row(self, owner, user_b, owned_room):
        rid = owned_room["id"]
        r = requests.post(
            f"{API}/rooms/{rid}/bans/remove",
            json={"user_id": user_b["user_id"]},
            headers=_hdr(owner["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        rb = requests.get(f"{API}/rooms/{rid}/bans", headers=_hdr(owner["token"]), timeout=15)
        assert not any(x["user_id"] == user_b["user_id"] for x in rb.json())


# ============================================================
# B6 — Room persistence after leave
# ============================================================
class TestB6RoomPersistence:
    def test_room_survives_leave(self, owner):
        # Create fresh room
        room = _create_room(owner["token"], name=f"TEST iter18 persist {uuid.uuid4().hex[:6]}")
        rid = room["id"]
        # Leave (owner)
        rl = requests.post(f"{API}/rooms/{rid}/leave", headers=_hdr(owner["token"]), timeout=15)
        assert rl.status_code in (200, 204), rl.text
        # Room must still be fetchable and not deleted
        rg = requests.get(f"{API}/rooms/{rid}", headers=_hdr(owner["token"]), timeout=15)
        assert rg.status_code == 200, rg.text
        j = rg.json()
        assert j.get("is_deleted") is False or j.get("is_deleted") is None
        assert "listeners_count" in j or "listeners" in j


# ============================================================
# B7 — Recommended sort excludes empty rooms
# ============================================================
class TestB7RecommendedSort:
    def test_recommended_excludes_empty_rooms(self, demo_token, owner):
        # Create a fresh empty room (listeners_count should be 0).
        room = _create_room(owner["token"], name=f"TEST iter18 empty {uuid.uuid4().hex[:6]}")
        rid = room["id"]
        # Owner leaves so listeners_count → 0
        requests.post(f"{API}/rooms/{rid}/leave", headers=_hdr(owner["token"]), timeout=15)
        # Fetch recommended list
        r = requests.get(f"{API}/rooms?sort=recommended", headers=_hdr(demo_token), timeout=15)
        assert r.status_code == 200, r.text
        rooms = r.json()
        assert isinstance(rooms, list)
        # None of them should be our empty room
        assert not any(x.get("id") == rid for x in rooms), "empty room must NOT appear in recommended"
        # All returned rooms must have listeners > 0
        for rm in rooms:
            lc = rm.get("listeners_count", rm.get("listeners", 0))
            assert lc and lc > 0, f"recommended returned empty room {rm.get('id')} with listeners={lc}"

    def test_public_room_exposes_iter18_fields(self, demo_token, owned_room):
        rid = owned_room["id"]
        r = requests.get(f"{API}/rooms/{rid}", headers=_hdr(demo_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        for k in ("is_deleted", "follow_count", "member_count", "background_url"):
            assert k in j, f"public_room missing {k}"
