"""
Iter-97 backend tests — Cosmetics Store / My Bag / Purchase / Medals / Levels.

Uses demo credentials from /app/memory/test_credentials.md.
Public URL from frontend/.env: EXPO_PUBLIC_BACKEND_URL.
"""
import os
import uuid
import pytest
import requests
import pymongo
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"

CATEGORIES = (
    "frames", "entrance_effects", "room_backgrounds", "entry_badges",
    "voice_waves", "profile_covers", "chat_bubbles",
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"identifier": DEMO_EMAIL, "password": DEMO_PASSWORD},
                      timeout=20)
    if r.status_code != 200:
        # try "email" key
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


# -------------------- GET /api/me/levels --------------------

class TestLevels:
    def test_levels_structure(self, auth):
        r = requests.get(f"{API}/me/levels", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "wealth" in j and "charm" in j
        for sys in ("wealth", "charm"):
            d = j[sys]
            for k in ("level", "points", "current_floor", "next_level", "next_threshold", "max_level"):
                assert k in d, f"{sys} missing {k}"
            assert isinstance(d["level"], int)
            assert isinstance(d["points"], int)


# -------------------- GET /api/me/bag --------------------

class TestBag:
    def test_bag_each_category(self, auth):
        for cat in CATEGORIES:
            r = requests.get(f"{API}/me/bag", params={"category": cat}, headers=auth, timeout=15)
            assert r.status_code == 200, f"{cat}: {r.status_code} {r.text}"
            j = r.json()
            assert j["category"] == cat
            assert isinstance(j["items"], list)

    def test_bag_room_backgrounds_has_premium(self, auth):
        r = requests.get(f"{API}/me/bag", params={"category": "room_backgrounds"}, headers=auth, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        # Premium room backgrounds must be listed in the bag
        assert len(items) > 0, "room_backgrounds bag must list premium backgrounds"
        for it in items:
            assert it.get("category") == "room_backgrounds"

    def test_bag_unknown_category_400(self, auth):
        r = requests.get(f"{API}/me/bag", params={"category": "bogus"}, headers=auth, timeout=15)
        assert r.status_code == 400


# -------------------- GET /api/cosmetics/store --------------------

class TestStore:
    def test_store_each_category_empty_or_list(self, auth):
        for cat in CATEGORIES:
            r = requests.get(f"{API}/cosmetics/store", params={"category": cat}, headers=auth, timeout=15)
            assert r.status_code == 200, f"{cat}: {r.text}"
            j = r.json()
            assert j["category"] == cat
            assert isinstance(j["items"], list)
            for it in j["items"]:
                assert "id" in it and "price" in it and "owned" in it

    def test_store_unknown_category_400(self, auth):
        r = requests.get(f"{API}/cosmetics/store", params={"category": "nope"}, headers=auth, timeout=15)
        assert r.status_code == 400


# -------------------- POST /api/cosmetics/{id}/purchase --------------------

class TestPurchase:
    def test_unknown_item_404(self, auth):
        r = requests.post(f"{API}/cosmetics/__does_not_exist__/purchase", headers=auth, timeout=15)
        assert r.status_code == 404

    def test_full_purchase_flow(self, auth, db):
        """Insert a temporary 1-diamond frame, buy it, verify 409 on re-buy, then cleanup."""
        item_id = f"TEST_iter97_{uuid.uuid4().hex[:8]}"
        db.cosmetic_items.insert_one({
            "id": item_id,
            "category": "frames",
            "name_en": "TEST Iter97 Frame",
            "name_ar": "اختبار",
            "price": 1,
            "active": True,
            "created_at": datetime.now(timezone.utc),
        })
        try:
            # Ensure user has at least 1 diamond
            db.users.update_one({"email": DEMO_EMAIL}, {"$inc": {"diamonds": 5}})

            # Purchase 200
            r = requests.post(f"{API}/cosmetics/{item_id}/purchase", headers=auth, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("ok") is True
            assert "diamonds_remaining" in body

            # Owned flag in store
            r2 = requests.get(f"{API}/cosmetics/store", params={"category": "frames"}, headers=auth, timeout=15)
            assert r2.status_code == 200
            match = [x for x in r2.json()["items"] if x["id"] == item_id]
            assert match and match[0]["owned"] is True

            # Appears in bag
            r3 = requests.get(f"{API}/me/bag", params={"category": "frames"}, headers=auth, timeout=15)
            assert r3.status_code == 200
            assert any(x["id"] == item_id for x in r3.json()["items"])

            # Repurchase → 409
            r4 = requests.post(f"{API}/cosmetics/{item_id}/purchase", headers=auth, timeout=15)
            assert r4.status_code == 409, r4.text
        finally:
            db.cosmetic_items.delete_many({"id": item_id})
            db.user_inventory.delete_many({"item_id": item_id})
            db.wallet_transactions.delete_many({"reference_id": item_id})

    def test_insufficient_diamonds_402(self, auth, db):
        """Insert a very expensive item and ensure user cannot afford."""
        item_id = f"TEST_iter97_expensive_{uuid.uuid4().hex[:8]}"
        db.cosmetic_items.insert_one({
            "id": item_id, "category": "frames",
            "name_en": "TEST Expensive", "name_ar": "غالي",
            "price": 10**12, "active": True,
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = requests.post(f"{API}/cosmetics/{item_id}/purchase", headers=auth, timeout=15)
            assert r.status_code == 402, r.text
        finally:
            db.cosmetic_items.delete_many({"id": item_id})
            db.user_inventory.delete_many({"item_id": item_id})


# -------------------- GET /api/me/medals --------------------

class TestMedals:
    def test_medals_structure(self, auth):
        r = requests.get(f"{API}/me/medals", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "my_badges" in j and "activity_badges" in j
        assert isinstance(j["my_badges"], list)
        assert isinstance(j["activity_badges"], list)
