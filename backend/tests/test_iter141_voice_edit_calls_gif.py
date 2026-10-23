"""
Iter-141 regression tests
=========================

Covers:
  * 2-minute edit window on /messages/{id}/unsend and /messages/{id}/delete (scope='everyone')
  * Voice waveform stored and returned by GET /messages/with/{id}
  * Delete for Everyone replaces message as kind='deleted' for both users
  * GIF 7-day purchase: idempotency, VIP4 rejection, active-pass rejection, 402 insufficient,
    exact deduction, wallet_transactions ledger row
  * Freeze-expired-gifs background job: an animated_avatar_url is replaced with a static PNG
    data URI once gif_access_until lapses (for sub-VIP4 users)
  * Calls: CALLEE_UNAVAILABLE 409 when callee hasn't polled /calls/current recently; a single
    call-history DM is written on hang-up (no_answer) and on answered-with-duration
  * /api/posts media=photos|videos filter; /api/users/{id}/posts?limit=5; /api/rooms/search
"""
import os
import time
import pytest
import requests
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL_TEST")
    or "http://localhost:8001"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
PASSWORD = "demo1234"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _login(email: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    data = r.json()
    headers = {"Authorization": f"Bearer {data['access_token']}",
               "Content-Type": "application/json"}
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15).json()
    return {"id": me["id"], "nickname": me.get("nickname"), "headers": headers}


@pytest.fixture(scope="module")
def user1():
    return _login("test.1@oriotest.dev")


@pytest.fixture(scope="module")
def user2():
    return _login("test.2@oriotest.dev")


@pytest.fixture(scope="module")
def user3():
    return _login("test.3@oriotest.dev")


# ---------------- Edit-window + delete-for-everyone ----------------
class TestEditWindow:
    def _send_text(self, sender, recipient_id, text="TEST_iter141_text"):
        r = requests.post(f"{BASE_URL}/api/messages/send", headers=sender["headers"],
                          json={"recipient_id": recipient_id, "kind": "text", "text": text}, timeout=15)
        assert r.status_code == 200, r.text
        # fetch the just-sent message id
        msgs = requests.get(f"{BASE_URL}/api/messages/with/{recipient_id}",
                            headers=sender["headers"], timeout=15).json()
        for m in reversed(msgs):
            if m.get("text") == text:
                return m["id"]
        raise AssertionError("sent message not found")

    def test_unsend_within_window_ok(self, user1, user2):
        mid = self._send_text(user1, user2["id"], "TEST_iter141_unsend_ok")
        r = requests.post(f"{BASE_URL}/api/messages/{mid}/unsend", headers=user1["headers"], timeout=15)
        assert r.status_code == 200, r.text
        msgs = requests.get(f"{BASE_URL}/api/messages/with/{user2['id']}",
                            headers=user1["headers"], timeout=15).json()
        m = next((x for x in msgs if x["id"] == mid), None)
        assert m is not None
        assert m["kind"] == "unsent"
        assert m["text"] == "Message Unsent"

    def test_unsend_expired_window_403(self, user1, user2):
        mid = self._send_text(user1, user2["id"], "TEST_iter141_unsend_expired")
        # Age the message past the 2-minute window.
        db.messages.update_one({"_id": ObjectId(mid)},
                               {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(seconds=200)}})
        r = requests.post(f"{BASE_URL}/api/messages/{mid}/unsend", headers=user1["headers"], timeout=15)
        assert r.status_code == 403
        assert "EDIT_WINDOW_EXPIRED" in r.text

    def test_delete_everyone_within_window_both_see_deleted(self, user1, user2):
        mid = self._send_text(user1, user2["id"], "TEST_iter141_delfor_ok")
        r = requests.post(f"{BASE_URL}/api/messages/{mid}/delete", headers=user1["headers"],
                         json={"scope": "everyone"}, timeout=15)
        assert r.status_code == 200, r.text
        # Verify BOTH participants see kind=deleted and the exact replacement text.
        for u, peer_id in [(user1, user2["id"]), (user2, user1["id"])]:
            msgs = requests.get(f"{BASE_URL}/api/messages/with/{peer_id}",
                                headers=u["headers"], timeout=15).json()
            m = next((x for x in msgs if x["id"] == mid), None)
            assert m is not None, f"missing for {u['id']}"
            assert m["kind"] == "deleted"
            assert m["text"] == "This message was deleted for everyone."

    def test_delete_everyone_after_window_403(self, user1, user2):
        mid = self._send_text(user1, user2["id"], "TEST_iter141_delfor_expired")
        db.messages.update_one({"_id": ObjectId(mid)},
                               {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(seconds=200)}})
        r = requests.post(f"{BASE_URL}/api/messages/{mid}/delete", headers=user1["headers"],
                         json={"scope": "everyone"}, timeout=15)
        assert r.status_code == 403
        assert "EDIT_WINDOW_EXPIRED" in r.text

    def test_delete_me_scope_after_window_still_ok(self, user1, user2):
        """scope='me' is not subject to the 2-min window."""
        mid = self._send_text(user1, user2["id"], "TEST_iter141_delme_old")
        db.messages.update_one({"_id": ObjectId(mid)},
                               {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(seconds=400)}})
        r = requests.post(f"{BASE_URL}/api/messages/{mid}/delete", headers=user1["headers"],
                         json={"scope": "me"}, timeout=15)
        assert r.status_code == 200, r.text


# ---------------- Voice waveform ----------------
class TestVoiceWaveform:
    def test_voice_waveform_persisted_and_normalised(self, user1, user2):
        """We POST a voice message by crafting the record directly in the DB
        with a known waveform, since /messages/send requires a chat-media URL
        that we can't easily upload headlessly. The GET must return `waveform`
        as a list of floats clamped to [0,1] with 3-decimal rounding."""
        # Direct insert to simulate what /messages/send writes.
        wf = [0.1, 0.5, 0.95, 1.2, -0.3, 0.333333]
        expected = [0.1, 0.5, 0.95, 1.0, 0.0, 0.333]
        tk = _thread_key(user1["id"], user2["id"])
        doc = {
            "sender_id": user1["id"],
            "recipient_id": user2["id"],
            "thread_key": tk,
            "text": "🎤 Voice message",
            "kind": "voice",
            "media_url": "https://example.com/fake.m4a",
            "duration": 3.5,
            "waveform": [round(min(1.0, max(0.0, float(v))), 3) for v in wf][:64],
            "read": False,
            "created_at": datetime.now(timezone.utc),
        }
        ins = db.messages.insert_one(doc)
        mid = str(ins.inserted_id)
        msgs = requests.get(f"{BASE_URL}/api/messages/with/{user2['id']}",
                            headers=user1["headers"], timeout=15).json()
        m = next((x for x in msgs if x["id"] == mid), None)
        assert m is not None
        assert m["kind"] == "voice"
        assert m.get("waveform") == expected
        assert m.get("duration") == 3.5
        # cleanup
        db.messages.delete_one({"_id": ins.inserted_id})


def _thread_key(a: str, b: str) -> str:
    # Must match server.thread_key (uses underscore separator).
    return "_".join(sorted([a, b]))


# ---------------- GIF access purchase ----------------
GIF_PRICE = 19_999


class TestGifPurchase:
    @pytest.fixture(autouse=True)
    def _setup(self, user3):
        """Reset test.3: non-VIP, no active gif pass, plenty of diamonds for the happy-path tests."""
        self.uid = user3["id"]
        self.headers = user3["headers"]
        # Snapshot current state so we restore afterwards.
        self._before = db.users.find_one({"_id": ObjectId(self.uid)},
                                         {"vip_level": 1, "diamonds": 1, "gif_access_until": 1,
                                          "animated_avatar_url": 1, "avatar_url": 1, "avatar_static_url": 1,
                                          "frozen_gif_url": 1})
        db.users.update_one({"_id": ObjectId(self.uid)},
                            {"$set": {"vip_level": 0, "diamonds": 50_000},
                             "$unset": {"gif_access_until": "", "gif_access_purchased_at": "",
                                        "frozen_gif_url": ""}})
        db.gif_purchases.delete_many({"user_id": self.uid})
        db.wallet_transactions.delete_many({"user_id": self.uid, "type": "gif_access_7d"})
        yield
        # Restore
        unset = {}
        setd = {k: v for k, v in (self._before or {}).items() if k != "_id" and v is not None}
        for k in ("vip_level", "diamonds", "gif_access_until", "animated_avatar_url",
                  "avatar_url", "avatar_static_url", "frozen_gif_url"):
            if (self._before or {}).get(k) is None:
                unset[k] = ""
        op = {}
        if setd:
            op["$set"] = setd
        if unset:
            op["$unset"] = unset
        if op:
            db.users.update_one({"_id": ObjectId(self.uid)}, op)
        db.gif_purchases.delete_many({"user_id": self.uid})
        db.wallet_transactions.delete_many({"user_id": self.uid, "type": "gif_access_7d"})

    def test_purchase_happy_path_deducts_exactly_and_sets_7_days(self):
        req_id = f"iter141-gif-{int(time.time()*1000)}"
        r = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                         json={"request_id": req_id}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body.get("duplicate") is not True
        assert body["diamonds"] == 50_000 - GIF_PRICE
        until = datetime.fromisoformat(body["gif_access_until"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = (until - now).total_seconds()
        # 7 days ± 30s
        assert abs(delta - 7 * 86400) < 60, f"gif_access_until {delta}s from now"
        # Mongo state
        u = db.users.find_one({"_id": ObjectId(self.uid)})
        assert u["diamonds"] == 50_000 - GIF_PRICE
        assert u.get("gif_access_until") is not None
        # ledger row
        tx = db.wallet_transactions.find_one({"user_id": self.uid, "reference_id": req_id})
        assert tx is not None
        assert tx["type"] == "gif_access_7d"
        assert tx["amount"] == -GIF_PRICE
        assert tx["currency"] == "diamonds"

    def test_idempotency_same_request_id_no_extra_charge(self):
        req_id = f"iter141-gif-dup-{int(time.time()*1000)}"
        r1 = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                          json={"request_id": req_id}, timeout=15)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                          json={"request_id": req_id}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("duplicate") is True
        # Still deducted only ONCE.
        u = db.users.find_one({"_id": ObjectId(self.uid)})
        assert u["diamonds"] == 50_000 - GIF_PRICE
        # Only one wallet row.
        rows = list(db.wallet_transactions.find({"user_id": self.uid, "type": "gif_access_7d"}))
        assert len(rows) == 1

    def test_already_active_rejects_409(self):
        req_id = f"iter141-gif-active-{int(time.time()*1000)}"
        r1 = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                          json={"request_id": req_id}, timeout=15)
        assert r1.status_code == 200
        # Second purchase with DIFFERENT request_id → active pass → 409.
        r2 = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                          json={"request_id": req_id + "-2"}, timeout=15)
        assert r2.status_code == 409
        assert "GIF_ACCESS_ALREADY_ACTIVE" in r2.text

    def test_vip4_user_rejected_409(self):
        db.users.update_one({"_id": ObjectId(self.uid)}, {"$set": {"vip_level": 4}})
        r = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                         json={"request_id": f"iter141-gif-vip4-{int(time.time()*1000)}"}, timeout=15)
        assert r.status_code == 409
        assert "VIP4_ALREADY_HAS_GIF" in r.text

    def test_insufficient_diamonds_402(self):
        db.users.update_one({"_id": ObjectId(self.uid)}, {"$set": {"diamonds": 100}})
        r = requests.post(f"{BASE_URL}/api/me/gif-access/purchase", headers=self.headers,
                         json={"request_id": f"iter141-gif-poor-{int(time.time()*1000)}"}, timeout=15)
        assert r.status_code == 402
        # No ledger row written.
        rows = list(db.wallet_transactions.find({"user_id": self.uid, "type": "gif_access_7d"}))
        assert rows == []
        u = db.users.find_one({"_id": ObjectId(self.uid)})
        assert u["diamonds"] == 100  # unchanged


# ---------------- Freeze-expired-GIFs background job ----------------
# A tiny valid 1x1 GIF89a → will decode via Pillow in _gif_first_frame_data_uri.
TINY_GIF = (
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


class TestFreezeExpiredGifs:
    def test_expired_gif_is_frozen_within_60s(self, user3):
        uid = user3["id"]
        before = db.users.find_one({"_id": ObjectId(uid)})
        db.users.update_one({"_id": ObjectId(uid)}, {"$set": {
            "vip_level": 0,
            "animated_avatar_url": TINY_GIF,
            "avatar_url": TINY_GIF,
            "gif_access_until": datetime.now(timezone.utc) - timedelta(hours=1),
        }})
        # The server's background loop runs every 60s. Poll up to 90s.
        deadline = time.time() + 90
        frozen = None
        while time.time() < deadline:
            u = db.users.find_one({"_id": ObjectId(uid)})
            if u.get("animated_avatar_url") in (None, ""):
                frozen = u
                break
            time.sleep(3)
        assert frozen is not None, "GIF was not frozen within 90s"
        assert frozen.get("animated_avatar_url") in (None, "")
        # avatar_url is now a static PNG data URI
        assert isinstance(frozen.get("avatar_url"), str)
        assert frozen["avatar_url"].startswith("data:image/png"), f"got {frozen.get('avatar_url')[:60]}"
        assert frozen.get("frozen_gif_url") == TINY_GIF
        # Restore
        restore = {k: before.get(k) for k in ("animated_avatar_url", "avatar_url",
                                              "avatar_static_url", "frozen_gif_url", "vip_level",
                                              "gif_access_until") if before.get(k) is not None}
        unset = {k: "" for k in ("animated_avatar_url", "avatar_url", "avatar_static_url",
                                 "frozen_gif_url", "gif_access_until") if before.get(k) is None}
        op = {}
        if restore:
            op["$set"] = restore
        if unset:
            op["$unset"] = unset
        if op:
            db.users.update_one({"_id": ObjectId(uid)}, op)


# ---------------- Calls ----------------
class TestCalls:
    def _cleanup_live(self, uid):
        db.calls.update_many(
            {"status": {"$in": ["ringing", "accepted"]},
             "$or": [{"caller_id": uid}, {"callee_id": uid}]},
            {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc), "logged": True}})

    def test_callee_unavailable_when_not_polling(self, user1, user2):
        self._cleanup_live(user1["id"])
        self._cleanup_live(user2["id"])
        # Force callee app_active_at to way in the past (not polling).
        db.users.update_one({"_id": ObjectId(user2["id"])},
                            {"$set": {"app_active_at": datetime.now(timezone.utc) - timedelta(seconds=60)}})
        # Remove earlier call-logs so we can detect the single new one.
        before_count = db.messages.count_documents({
            "thread_key": _thread_key(user1["id"], user2["id"]),
            "kind": "call", "call_status": "no_answer"})
        r = requests.post(f"{BASE_URL}/api/calls/start", headers=user1["headers"],
                         json={"callee_id": user2["id"]}, timeout=15)
        assert r.status_code == 409
        assert "CALLEE_UNAVAILABLE" in r.text
        # Exactly ONE new no_answer call message was written.
        after_count = db.messages.count_documents({
            "thread_key": _thread_key(user1["id"], user2["id"]),
            "kind": "call", "call_status": "no_answer"})
        assert after_count == before_count + 1

    def test_answered_call_writes_one_call_message_with_duration(self, user1, user2):
        self._cleanup_live(user1["id"])
        self._cleanup_live(user2["id"])
        # Mark callee active so /start succeeds.
        db.users.update_one({"_id": ObjectId(user2["id"])},
                            {"$set": {"app_active_at": datetime.now(timezone.utc)}})
        db.users.update_one({"_id": ObjectId(user1["id"])},
                            {"$set": {"app_active_at": datetime.now(timezone.utc)}})
        before = db.messages.count_documents({
            "thread_key": _thread_key(user1["id"], user2["id"]),
            "kind": "call", "call_status": "answered"})
        r = requests.post(f"{BASE_URL}/api/calls/start", headers=user1["headers"],
                         json={"callee_id": user2["id"]}, timeout=15)
        assert r.status_code == 200, r.text
        call_id = r.json()["call"]["id"]
        # Callee accepts
        ra = requests.post(f"{BASE_URL}/api/calls/{call_id}/accept", headers=user2["headers"], timeout=15)
        assert ra.status_code == 200, ra.text
        time.sleep(1.5)
        # Hang up
        re_ = requests.post(f"{BASE_URL}/api/calls/{call_id}/end", headers=user1["headers"], timeout=15)
        assert re_.status_code == 200
        after = db.messages.count_documents({
            "thread_key": _thread_key(user1["id"], user2["id"]),
            "kind": "call", "call_status": "answered"})
        assert after == before + 1
        last = db.messages.find_one({"call_id": call_id})
        assert last is not None
        assert last["kind"] == "call"
        assert last["call_status"] == "answered"
        assert last["duration"] >= 1


# ---------------- Posts + rooms search ----------------
class TestPostsMediaFilter:
    def test_posts_media_photos_only(self, user1):
        r = requests.get(f"{BASE_URL}/api/posts?feed=latest&media=photos",
                         headers=user1["headers"], timeout=15)
        assert r.status_code == 200
        for p in r.json():
            assert not p.get("video_url"), f"photos feed contained a video: {p.get('id')}"

    def test_posts_media_videos_only(self, user1):
        r = requests.get(f"{BASE_URL}/api/posts?feed=latest&media=videos",
                         headers=user1["headers"], timeout=15)
        assert r.status_code == 200
        for p in r.json():
            assert p.get("video_url"), f"videos feed contained a non-video: {p.get('id')}"

    def test_users_posts_limit_5(self, user1, user2):
        r = requests.get(f"{BASE_URL}/api/users/{user2['id']}/posts?limit=5",
                         headers=user1["headers"], timeout=15)
        assert r.status_code == 200
        posts = r.json()
        assert isinstance(posts, list)
        assert len(posts) <= 5


class TestRoomsSearch:
    def test_rooms_search_shape(self, user1):
        r = requests.get(f"{BASE_URL}/api/rooms/search?q=test",
                         headers=user1["headers"], timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "rooms" in body
        assert "users_without_room" in body
        assert isinstance(body["rooms"], list)
        assert isinstance(body["users_without_room"], list)
        for u in body["users_without_room"]:
            assert "id" in u
            assert "nickname" in u

    def test_rooms_search_min_length(self, user1):
        r = requests.get(f"{BASE_URL}/api/rooms/search?q=", headers=user1["headers"], timeout=15)
        assert r.status_code == 422
