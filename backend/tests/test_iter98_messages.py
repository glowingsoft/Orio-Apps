"""Iter-98 — Messages: Friend Requests, System Notifications, Support, Activities.

Focused end-to-end tests against the public preview URL, using real DB writes.
Admin endpoints are exercised by temporarily inserting an admin_approvals doc
for a fresh test user and cleaning it up at the end.
"""
import os
import time
import uuid
import pytest
import requests
import pymongo

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"

session = requests.Session()


# ---------- helpers ----------
def _me(token: str) -> dict:
    r = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, f"/auth/me failed {r.status_code} {r.text}"
    return r.json()


def _login(email: str, password: str) -> dict:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    j = r.json()
    tok = j["access_token"]
    me = _me(tok)
    return {"token": tok, "id": me["id"], "user": me}


def _register_new() -> dict:
    uid = uuid.uuid4().hex[:10]
    payload = {
        "email": f"test_iter98_{uid}@example.com",
        "password": "TestPass!2026",
        "username": f"t98_{uid}",
        "nickname": f"T98 {uid}",
    }
    r = session.post(f"{API}/auth/register", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    j = r.json()
    tok = j["access_token"]
    me = _me(tok)
    return {"token": tok, "id": me["id"], "user": me, "email": payload["email"]}


def _complete_profile(token: str) -> None:
    r = session.post(f"{API}/me/profile/complete",
                     json={"nickname": "T98", "gender": "male", "age": 25},
                     headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code in (200, 201), f"profile complete failed {r.status_code} {r.text}"


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def demo():
    return _login(DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="module")
def mongo():
    cli = pymongo.MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    yield db
    cli.close()


# ============================================================================
# Friend Requests
# ============================================================================
class TestFriendRequests:
    def test_list_endpoint_ok(self, demo):
        r = session.get(f"{API}/friend-requests", headers=H(demo["token"]), timeout=20)
        assert r.status_code == 200
        assert "items" in r.json() and isinstance(r.json()["items"], list)

    def test_follower_creates_request_then_reject(self, demo, mongo):
        follower = _register_new()
        _complete_profile(follower["token"])
        try:
            r = session.post(f"{API}/users/{demo['id']}/follow",
                             headers=H(follower["token"]), timeout=20)
            assert r.status_code in (200, 201), r.text

            r = session.get(f"{API}/friend-requests", headers=H(demo["token"]), timeout=20)
            assert r.status_code == 200
            ids = [it["user"]["id"] for it in r.json()["items"]]
            assert follower["id"] in ids, "follower should appear as a friend request"

            r = session.post(f"{API}/friend-requests/{follower['id']}/reject",
                             headers=H(demo["token"]), timeout=20)
            assert r.status_code == 200
            assert r.json().get("status") == "rejected"

            r = session.get(f"{API}/friend-requests", headers=H(demo["token"]), timeout=20)
            ids = [it["user"]["id"] for it in r.json()["items"]]
            assert follower["id"] not in ids, "rejected request should disappear"
        finally:
            mongo.friend_request_dismissals.delete_many({"user_id": demo["id"], "from_id": follower["id"]})
            mongo.follows.delete_many({"follower_id": follower["id"], "followee_id": demo["id"]})
            mongo.friendships.delete_many({"$or": [{"a_id": follower["id"]}, {"b_id": follower["id"]}]})
            mongo.users.delete_one({"email": follower["email"]})

    def test_follower_creates_request_then_accept(self, demo, mongo):
        follower = _register_new()
        _complete_profile(follower["token"])
        try:
            r = session.post(f"{API}/users/{demo['id']}/follow",
                             headers=H(follower["token"]), timeout=20)
            assert r.status_code in (200, 201)

            r = session.post(f"{API}/friend-requests/{follower['id']}/accept",
                             headers=H(demo["token"]), timeout=20)
            assert r.status_code == 200
            assert r.json().get("status") == "accepted"

            # Verify friendship persisted
            fr = mongo.friendships.find_one({"$or": [
                {"a_id": follower["id"], "b_id": demo["id"]},
                {"a_id": demo["id"], "b_id": follower["id"]},
            ], "status": "accepted"})
            assert fr is not None, "accepted friendship should persist"

            r = session.get(f"{API}/friend-requests", headers=H(demo["token"]), timeout=20)
            ids = [it["user"]["id"] for it in r.json()["items"]]
            assert follower["id"] not in ids, "accepted request should disappear"
        finally:
            mongo.follows.delete_many({"follower_id": follower["id"], "followee_id": demo["id"]})
            mongo.friendships.delete_many({"$or": [{"a_id": follower["id"]}, {"b_id": follower["id"]}]})
            mongo.users.delete_one({"email": follower["email"]})


# ============================================================================
# System Notifications
# ============================================================================
class TestNotifications:
    def test_list_system(self, demo):
        r = session.get(f"{API}/notifications/system", headers=H(demo["token"]), timeout=20)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_report_creates_notification(self, demo, mongo):
        other = _register_new()
        _complete_profile(other["token"])
        try:
            r = session.post(f"{API}/users/{other['id']}/report",
                             json={"reason": "spam", "note": "TEST_iter98 report"},
                             headers=H(demo["token"]), timeout=20)
            assert r.status_code in (200, 201), r.text

            r = session.get(f"{API}/notifications/system", headers=H(demo["token"]), timeout=20)
            kinds = [n.get("kind") for n in r.json()["items"]]
            assert "report_received" in kinds, "report_received notification missing"

            # Cleanup matching notifications and the user report row
            mongo.system_notifications.delete_many({"user_id": demo["id"], "kind": "report_received"})
            mongo.user_reports.delete_many({"reporter_id": demo["id"], "reported_id": other["id"]})
        finally:
            mongo.users.delete_one({"email": other["email"]})


# ============================================================================
# Support (VIP4+)
# ============================================================================
class TestSupport:
    def test_support_meta_demo(self, demo):
        r = session.get(f"{API}/support/messages", headers=H(demo["token"]), timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j.get("min_vip") == 4
        # demo is VIP7 so can send
        assert j.get("can_send") is True

    def test_support_blocks_low_vip(self, mongo):
        low = _register_new()
        _complete_profile(low["token"])
        try:
            r = session.get(f"{API}/support/messages", headers=H(low["token"]), timeout=20)
            assert r.status_code == 200
            assert r.json().get("can_send") is False

            r = session.post(f"{API}/support/messages", json={"text": "hello"},
                             headers=H(low["token"]), timeout=20)
            assert r.status_code == 403, f"expected 403 for VIP<4, got {r.status_code}"
        finally:
            mongo.users.delete_one({"email": low["email"]})

    def test_support_send_allowed_demo(self, demo, mongo):
        text = f"TEST_iter98 ping {uuid.uuid4().hex[:6]}"
        try:
            r = session.post(f"{API}/support/messages", json={"text": text},
                             headers=H(demo["token"]), timeout=20)
            assert r.status_code == 201, r.text
            mid = r.json().get("id")
            assert mid

            r = session.get(f"{API}/support/messages", headers=H(demo["token"]), timeout=20)
            assert any(m.get("text") == text for m in r.json()["items"])
        finally:
            mongo.support_messages.delete_many({"user_id": demo["id"], "text": {"$regex": "^TEST_iter98"}})


# ============================================================================
# Admin endpoints — add temp admin_approvals, then clean up
# ============================================================================
class TestAdminMessages:
    def test_admin_support_threads_and_reply(self, demo, mongo):
        # Create admin user
        admin = _register_new()
        _complete_profile(admin["token"])
        try:
            mongo.admin_approvals.update_one(
                {"email": admin["email"]},
                {"$set": {"email": admin["email"], "enabled": True,
                          "permissions": ["rooms.manage", "reports.resolve"],
                          "created_at": time.time()}},
                upsert=True,
            )

            # Seed one user message from demo so a thread exists
            seed = f"TEST_iter98 thread {uuid.uuid4().hex[:6]}"
            r = session.post(f"{API}/support/messages", json={"text": seed},
                             headers=H(demo["token"]), timeout=20)
            assert r.status_code == 201

            r = session.get(f"{API}/admin/support/threads", headers=H(admin["token"]), timeout=20)
            assert r.status_code == 200, r.text
            user_ids = [t["user"].get("id") for t in r.json()["items"]]
            assert demo["id"] in user_ids

            r = session.get(f"{API}/admin/support/{demo['id']}", headers=H(admin["token"]), timeout=20)
            assert r.status_code == 200
            assert any(m.get("text") == seed for m in r.json()["items"])

            r = session.post(f"{API}/admin/support/{demo['id']}/reply",
                             json={"text": "TEST_iter98 admin reply"},
                             headers=H(admin["token"]), timeout=20)
            assert r.status_code == 201

            # Non-admin should 403
            other = _register_new()
            _complete_profile(other["token"])
            try:
                r = session.get(f"{API}/admin/support/threads",
                                headers=H(other["token"]), timeout=20)
                assert r.status_code == 403
            finally:
                mongo.users.delete_one({"email": other["email"]})
        finally:
            mongo.admin_approvals.delete_many({"email": admin["email"]})
            mongo.support_messages.delete_many({"user_id": demo["id"], "text": {"$regex": "^TEST_iter98"}})
            mongo.users.delete_one({"email": admin["email"]})


# ============================================================================
# Activities / Room Events
# ============================================================================
class TestActivities:
    def test_list_all_and_mine(self, demo):
        for scope in ("all", "mine"):
            for phase in ("ongoing", "upcoming"):
                r = session.get(f"{API}/room-events",
                                params={"scope": scope, "phase": phase},
                                headers=H(demo["token"]), timeout=20)
                assert r.status_code == 200, f"{scope}/{phase} failed: {r.text}"
                assert "items" in r.json()

    def test_apply_requires_live_owned_room(self, demo, mongo):
        r = session.post(f"{API}/room-events/apply",
                         json={"name": "TEST_iter98_apply", "date": "2099-01-01",
                               "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="},
                         headers=H(demo["token"]), timeout=20)
        # demo may or may not have a live owned room — must be either 201 or 400 ROOM_REQUIRED
        assert r.status_code in (201, 400)
        if r.status_code == 400:
            assert "ROOM_REQUIRED" in r.text
        else:
            mongo.room_events.delete_many({"name": "TEST_iter98_apply"})

    def test_apply_rejects_past_dates(self, demo):
        r = session.post(f"{API}/room-events/apply",
                         json={"name": "TEST_iter98", "date": "2020-01-01",
                               "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="},
                         headers=H(demo["token"]), timeout=20)
        assert r.status_code == 400
        assert "DATE_IN_PAST" in r.text

    def test_admin_decision_approves_and_notifies(self, demo, mongo):
        """Full flow: create pending event directly in Mongo for demo, then approve via admin API."""
        admin = _register_new()
        _complete_profile(admin["token"])
        try:
            # Find a room owned by demo (any room, doesn't need to be live for this test)
            room = mongo.rooms.find_one({"owner_id": demo["id"]}, {"_id": 1})
            if not room:
                pytest.skip("demo has no owned room — cannot build an event doc")
            import datetime as _dt
            start = _dt.datetime.utcnow() + _dt.timedelta(days=1)
            ev = mongo.room_events.insert_one({
                "user_id": demo["id"], "room_id": str(room["_id"]),
                "name": "TEST_iter98 Event", "image_url": "data:image/png;base64,xxx",
                "start_at": start, "end_at": start + _dt.timedelta(days=1),
                "status": "pending", "created_at": _dt.datetime.utcnow(),
            })
            evid = str(ev.inserted_id)

            # Non-admin forbidden
            r = session.post(f"{API}/admin/room-events/{evid}/decision",
                             json={"approve": True}, headers=H(demo["token"]), timeout=20)
            assert r.status_code == 403

            # Grant admin
            mongo.admin_approvals.update_one(
                {"email": admin["email"]},
                {"$set": {"email": admin["email"], "enabled": True,
                          "permissions": ["rooms.manage"], "created_at": time.time()}},
                upsert=True,
            )
            r = session.post(f"{API}/admin/room-events/{evid}/decision",
                             json={"approve": True}, headers=H(admin["token"]), timeout=20)
            assert r.status_code == 200, r.text
            assert r.json().get("status") == "approved"

            # Notification exists
            n = mongo.system_notifications.find_one({"user_id": demo["id"], "kind": "activity_approved"})
            assert n is not None, "activity_approved notification missing"

            # Appears under all/upcoming
            r = session.get(f"{API}/room-events",
                            params={"scope": "all", "phase": "upcoming"},
                            headers=H(demo["token"]), timeout=20)
            assert any(it["id"] == evid for it in r.json()["items"])
        finally:
            mongo.admin_approvals.delete_many({"email": admin["email"]})
            mongo.system_notifications.delete_many({"user_id": demo["id"], "kind": "activity_approved",
                                                    "params.name": "TEST_iter98 Event"})
            mongo.room_events.delete_many({"name": "TEST_iter98 Event"})
            mongo.users.delete_one({"email": admin["email"]})
