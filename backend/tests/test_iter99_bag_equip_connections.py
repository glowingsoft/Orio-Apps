"""
Iter-99 backend tests — Bag Equip / Unequip (store items + room backgrounds)
and /api/me/connections lists + live counts on /api/users/{id}.
"""
import os
import uuid
import pytest
import requests
import pymongo
from datetime import datetime, timezone

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://audio-community-9.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# -------------------- fixtures --------------------

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"identifier": DEMO_EMAIL, "password": DEMO_PASSWORD},
                      timeout=20)
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/login",
                          json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
                          timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok, f"no token in {j}"
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def db():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "voiceup")
    client = pymongo.MongoClient(mongo_url)
    return client[db_name]


@pytest.fixture(scope="module")
def me(auth):
    r = requests.get(f"{API}/auth/me", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# -------------------- Room background equip/unequip --------------------

class TestRoomBackgroundEquip:
    def test_bag_room_backgrounds_shape(self, auth):
        r = requests.get(f"{API}/me/bag", params={"category": "room_backgrounds"},
                         headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["category"] == "room_backgrounds"
        items = j["items"]
        assert len(items) > 0
        # Each item must have equipped + can_wear + source
        for it in items:
            assert "equipped" in it
            assert "can_wear" in it
            assert "source" in it

    def test_equip_car_lamborghini_then_unequip(self, auth, db, me):
        # Record original state (restore in teardown)
        uid = me["id"]
        room_before = db.rooms.find_one(
            {"owner_id": uid, "is_deleted": {"$ne": True}},
            {"background_preset_id": 1, "background_url": 1},
        )
        assert room_before is not None, "demo user must own a room"
        orig_preset = room_before.get("background_preset_id")
        orig_url = room_before.get("background_url")

        try:
            # 1) Equip the Lamborghini room background via source=room
            r = requests.post(f"{API}/me/bag/equip",
                              json={"category": "room_backgrounds",
                                    "item_id": "car_lamborghini",
                                    "source": "room"},
                              headers=auth, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("ok") is True
            assert body.get("equipped") is True

            # 2) Bag now shows that item equipped=true
            r2 = requests.get(f"{API}/me/bag",
                              params={"category": "room_backgrounds"},
                              headers=auth, timeout=15)
            assert r2.status_code == 200
            items = r2.json()["items"]
            lambo = next((i for i in items if i["id"] == "car_lamborghini"), None)
            assert lambo is not None, "car_lamborghini missing from bag"
            assert lambo["equipped"] is True, f"not equipped: {lambo}"

            # DB check: room now has preset car_lamborghini
            room_mid = db.rooms.find_one({"owner_id": uid, "is_deleted": {"$ne": True}},
                                         {"background_preset_id": 1})
            assert room_mid.get("background_preset_id") == "car_lamborghini"

            # 3) Unequip -> reverts to orio_welcome
            r3 = requests.post(f"{API}/me/bag/unequip",
                               json={"category": "room_backgrounds",
                                     "item_id": "car_lamborghini",
                                     "source": "room"},
                               headers=auth, timeout=15)
            assert r3.status_code == 200, r3.text
            assert r3.json().get("equipped") is False

            room_after = db.rooms.find_one({"owner_id": uid, "is_deleted": {"$ne": True}},
                                           {"background_preset_id": 1})
            assert room_after.get("background_preset_id") == "orio_welcome"
        finally:
            # Restore original room preset exactly (even if None)
            set_doc = {}
            if orig_preset is not None:
                set_doc["background_preset_id"] = orig_preset
            if orig_url is not None:
                set_doc["background_url"] = orig_url
            unset_doc = {}
            if orig_preset is None:
                unset_doc["background_preset_id"] = ""
            if orig_url is None:
                unset_doc["background_url"] = ""
            update = {}
            if set_doc:
                update["$set"] = set_doc
            if unset_doc:
                update["$unset"] = unset_doc
            if update:
                db.rooms.update_one({"_id": room_before["_id"]}, update)


# -------------------- Store item equip (frames) --------------------

class TestStoreItemEquip:
    def test_full_frame_equip_unequip(self, auth, db, me):
        item_id = f"TEST_f_{uuid.uuid4().hex[:8]}"
        db.cosmetic_items.insert_one({
            "id": item_id,
            "category": "frames",
            "name_en": "T",
            "name_ar": "T",
            "price": 1,
            "active": True,
            "created_at": datetime.now(timezone.utc),
        })
        uid_oid = db.users.find_one({"email": DEMO_EMAIL})["_id"]
        try:
            # ensure user has 1+ diamond
            db.users.update_one({"email": DEMO_EMAIL}, {"$inc": {"diamonds": 5}})

            # Equip of UNOWNED item => 403
            r0 = requests.post(f"{API}/me/bag/equip",
                               json={"category": "frames", "item_id": item_id,
                                     "source": "store"},
                               headers=auth, timeout=15)
            assert r0.status_code == 403, f"expected 403 for unowned, got {r0.status_code} {r0.text}"

            # Purchase
            r1 = requests.post(f"{API}/cosmetics/{item_id}/purchase",
                               headers=auth, timeout=15)
            assert r1.status_code == 200, r1.text

            # Equip
            r2 = requests.post(f"{API}/me/bag/equip",
                               json={"category": "frames", "item_id": item_id,
                                     "source": "store"},
                               headers=auth, timeout=15)
            assert r2.status_code == 200, r2.text
            assert r2.json().get("equipped") is True

            # DB: users.equipped.frames == item_id
            u = db.users.find_one({"_id": uid_oid}, {"equipped": 1})
            assert (u.get("equipped") or {}).get("frames") == item_id

            # Bag shows equipped=true
            r3 = requests.get(f"{API}/me/bag", params={"category": "frames"},
                              headers=auth, timeout=15)
            assert r3.status_code == 200
            frame = next((i for i in r3.json()["items"] if i["id"] == item_id), None)
            assert frame and frame["equipped"] is True

            # Unequip
            r4 = requests.post(f"{API}/me/bag/unequip",
                               json={"category": "frames", "item_id": item_id,
                                     "source": "store"},
                               headers=auth, timeout=15)
            assert r4.status_code == 200
            assert r4.json().get("equipped") is False

            u2 = db.users.find_one({"_id": uid_oid}, {"equipped": 1})
            assert "frames" not in (u2.get("equipped") or {})
        finally:
            # Refund 1 diamond, delete item, inventory, wallet tx
            db.cosmetic_items.delete_many({"id": item_id})
            db.user_inventory.delete_many({"item_id": item_id})
            db.wallet_transactions.delete_many({"reference_id": item_id})
            db.users.update_one({"email": DEMO_EMAIL}, {"$unset": {"equipped.frames": ""}})
            # Rollback the +5 diamond grant - subtract 5 (we added 5 earlier; purchase deducted 1 already handled by delete tx)
            db.users.update_one({"email": DEMO_EMAIL}, {"$inc": {"diamonds": -5 + 1}})


# -------------------- /api/me/connections --------------------

class TestConnections:
    def test_connections_friends_shape(self, auth):
        r = requests.get(f"{API}/me/connections", params={"type": "friends"},
                         headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["type"] == "friends"
        assert isinstance(j["items"], list)
        assert "counts" in j
        for k in ("friends", "following", "followers"):
            assert k in j["counts"]
            assert isinstance(j["counts"][k], int)

    def test_connections_following_shape(self, auth):
        r = requests.get(f"{API}/me/connections", params={"type": "following"},
                         headers=auth, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["type"] == "following"
        assert isinstance(j["items"], list)
        for it in j["items"]:
            assert "id" in it
            assert "is_following" in it

    def test_connections_followers_shape(self, auth):
        r = requests.get(f"{API}/me/connections", params={"type": "followers"},
                         headers=auth, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["type"] == "followers"
        assert isinstance(j["items"], list)


# -------------------- /api/users/{id} live counts --------------------

class TestUserLiveCounts:
    def test_user_endpoint_has_live_counts(self, auth, me):
        r = requests.get(f"{API}/users/{me['id']}", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "following" in j and "followers" in j
        assert isinstance(j["following"], int)
        assert isinstance(j["followers"], int)
