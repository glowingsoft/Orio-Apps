"""Iter-131 — VIP entrance rewards (bag + equip + VIP_EXPIRED + static media).

Covers:
  * GET /api/me/bag?category=entrance_effects for demo (VIP7) — both VIP rewards
    appear first with source=vip, effect_key, expired=false, equipped reflects
    users.equipped.entrance_effects.
  * POST /api/me/bag/equip and /api/me/bag/unequip toggle the equipped flag.
  * VIP_EXPIRED path: temporarily set vip_expires_at in the past for a non-demo
    user that is VIP6+ (or create a VIP6 test user if none), confirm the bag
    item becomes expired=true + can_wear=false and equip returns 403.
    Always restore the user to its original state at the end.
  * A VIP<6 user receives no VIP entrance items.
  * /api/static/entrances/<file> returns 200 for the four files; path traversal
    attempts return 404.
"""
import os
from datetime import datetime, timedelta, timezone

import pymongo
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASS = "demo1234"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")


@pytest.fixture(scope="module")
def mongo():
    cli = pymongo.MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_token() -> str:
    return _login(DEMO_EMAIL, DEMO_PASS)


@pytest.fixture(scope="module")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


# -------------------- bag listing + equip / unequip --------------------
class TestEntranceBagDemoUser:
    def test_bag_contains_both_vip_items_first(self, demo_headers):
        r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                         headers=demo_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["category"] == "entrance_effects"
        items = data["items"]
        assert len(items) >= 2
        ids = [it["id"] for it in items[:2]]
        assert ids == ["vip6_ice_bear", "vip7_golden_leopard"], f"wrong order: {ids}"
        for it in items[:2]:
            assert it["source"] == "vip"
            assert it["effect_key"] in ("ice_bear", "golden_leopard")
            assert it["expired"] is False
            assert it["can_wear"] is True

    def test_equip_unequip_toggle(self, demo_headers, mongo):
        orig = (mongo.users.find_one({"email": DEMO_EMAIL}) or {}).get("equipped", {}) or {}
        orig_entrance = orig.get("entrance_effects")
        try:
            # equip golden leopard
            r = requests.post(f"{API}/me/bag/equip",
                              json={"category": "entrance_effects",
                                    "item_id": "vip7_golden_leopard", "source": "vip"},
                              headers=demo_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("equipped") is True
            # verify via bag
            r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                             headers=demo_headers, timeout=15).json()
            leo = next(x for x in r["items"] if x["id"] == "vip7_golden_leopard")
            bear = next(x for x in r["items"] if x["id"] == "vip6_ice_bear")
            assert leo["equipped"] is True
            assert bear["equipped"] is False
            # unequip
            r = requests.post(f"{API}/me/bag/unequip",
                              json={"category": "entrance_effects",
                                    "item_id": "vip7_golden_leopard", "source": "vip"},
                              headers=demo_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("equipped") is False
            # verify
            r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                             headers=demo_headers, timeout=15).json()
            leo = next(x for x in r["items"] if x["id"] == "vip7_golden_leopard")
            assert leo["equipped"] is False
        finally:
            # Restore to vip7_golden_leopard equipped per agent-to-agent note.
            requests.post(f"{API}/me/bag/equip",
                          json={"category": "entrance_effects",
                                "item_id": "vip7_golden_leopard", "source": "vip"},
                          headers=demo_headers, timeout=15)
            # If the DB had a different original, honour it
            if orig_entrance and orig_entrance != "vip7_golden_leopard":
                mongo.users.update_one({"email": DEMO_EMAIL},
                                       {"$set": {"equipped.entrance_effects": orig_entrance}})


# -------------------- expiry path --------------------
class TestVipExpired:
    def test_expired_hides_can_wear_and_blocks_equip(self, mongo):
        """Pick (or create) a VIP6+ non-demo user, snapshot, flip expiry back, test, restore."""
        candidates = list(mongo.users.find(
            {"vip_level": {"$gte": 6}, "email": {"$ne": DEMO_EMAIL}},
            {"email": 1, "vip_level": 1, "vip_expires_at": 1, "equipped": 1}).limit(1))
        created_user_email = None
        if candidates:
            u = candidates[0]
            email = u["email"]
            # Need a password to log in — try common dev password; otherwise create a user.
        else:
            u = None
            email = None

        test_pw = "demo1234"
        if not u:
            # Register a VIP6 user via API, then raise its vip_level in Mongo.
            email = "test.vip.expired@oriotest.dev"
            mongo.users.delete_many({"email": email})
            r = requests.post(f"{API}/auth/register", json={
                "email": email, "password": test_pw,
                "username": "testvipexp", "nickname": "testvipexp",
            }, timeout=15)
            assert r.status_code in (200, 201), r.text
            created_user_email = email
            mongo.users.update_one({"email": email},
                                   {"$set": {"vip_level": 6,
                                             "vip_expires_at": datetime.now(timezone.utc) + timedelta(days=30)}})
            u = mongo.users.find_one({"email": email})
            orig_level = 6
            orig_expiry = u.get("vip_expires_at")
        else:
            orig_level = u.get("vip_level")
            orig_expiry = u.get("vip_expires_at")

        # Attempt login — if we can't log in as an existing user, create our own.
        try:
            r = requests.post(f"{API}/auth/login",
                              json={"email": email, "password": test_pw}, timeout=15)
            if r.status_code != 200:
                # fall back to creating our own user
                email = "test.vip.expired@oriotest.dev"
                mongo.users.delete_many({"email": email})
                r = requests.post(f"{API}/auth/register", json={
                    "email": email, "password": test_pw,
                    "username": "testvipexp", "nickname": "testvipexp",
                }, timeout=15)
                assert r.status_code in (200, 201), r.text
                created_user_email = email
                mongo.users.update_one({"email": email},
                                       {"$set": {"vip_level": 6,
                                                 "vip_expires_at": datetime.now(timezone.utc) + timedelta(days=30)}})
                orig_level = 6
                orig_expiry = mongo.users.find_one({"email": email}).get("vip_expires_at")
                r = requests.post(f"{API}/auth/login",
                                  json={"email": email, "password": test_pw}, timeout=15)
            assert r.status_code == 200, r.text
            tok = r.json()["access_token"]
            hdr = {"Authorization": f"Bearer {tok}"}

            # Prime bag (so inventory row exists) while still active.
            r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                             headers=hdr, timeout=15)
            assert r.status_code == 200, r.text
            items = {it["id"]: it for it in r.json()["items"] if it.get("source") == "vip"}
            assert "vip6_ice_bear" in items
            assert items["vip6_ice_bear"]["expired"] is False
            assert items["vip6_ice_bear"]["can_wear"] is True

            # Flip to expired.
            mongo.users.update_one(
                {"email": email},
                {"$set": {"vip_expires_at": datetime.now(timezone.utc) - timedelta(days=1)}},
            )

            r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                             headers=hdr, timeout=15)
            assert r.status_code == 200, r.text
            items = {it["id"]: it for it in r.json()["items"] if it.get("source") == "vip"}
            assert "vip6_ice_bear" in items
            assert items["vip6_ice_bear"]["expired"] is True
            assert items["vip6_ice_bear"]["can_wear"] is False
            assert items["vip6_ice_bear"]["equipped"] is False

            # Equip must 403 VIP_EXPIRED.
            r = requests.post(f"{API}/me/bag/equip",
                              json={"category": "entrance_effects",
                                    "item_id": "vip6_ice_bear", "source": "vip"},
                              headers=hdr, timeout=15)
            assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"
            assert "VIP_EXPIRED" in r.text
        finally:
            # Restore the user we probed.
            if created_user_email:
                mongo.users.delete_one({"email": created_user_email})
            else:
                mongo.users.update_one(
                    {"email": email},
                    {"$set": {"vip_level": orig_level, "vip_expires_at": orig_expiry}},
                )


# -------------------- below-threshold user --------------------
class TestNonVipUserHasNoRewards:
    def test_non_vip_bag_has_no_vip_items(self, mongo):
        email = "test.nonvip.entrance@oriotest.dev"
        mongo.users.delete_many({"email": email})
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "demo1234",
            "username": "testnonvip", "nickname": "testnonvip",
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
        try:
            r = requests.post(f"{API}/auth/login",
                              json={"email": email, "password": "demo1234"}, timeout=15)
            tok = r.json()["access_token"]
            r = requests.get(f"{API}/me/bag", params={"category": "entrance_effects"},
                             headers={"Authorization": f"Bearer {tok}"}, timeout=15)
            assert r.status_code == 200
            vip_items = [it for it in r.json()["items"] if it.get("source") == "vip"]
            assert vip_items == [], f"non-VIP got {vip_items}"
        finally:
            mongo.users.delete_one({"email": email})


# -------------------- static media endpoint --------------------
class TestEntranceMedia:
    @pytest.mark.parametrize("name,ctype", [
        ("ice_bear.webp", "image/webp"),
        ("golden_leopard.webp", "image/webp"),
        ("ice_bear.m4a", "audio/mp4"),
        ("golden_leopard.m4a", "audio/mp4"),
        ("ice_bear_preview.mp4", "video/mp4"),
        ("golden_leopard_preview.mp4", "video/mp4"),
        ("ice_bear_preview.webm", "video/webm"),
        ("golden_leopard_preview.webm", "video/webm"),
    ])
    def test_media_served(self, name, ctype):
        r = requests.get(f"{API}/static/entrances/{name}", timeout=15)
        assert r.status_code == 200, f"{name} -> {r.status_code}"
        assert ctype in (r.headers.get("content-type") or "")
        assert len(r.content) > 500

    @pytest.mark.parametrize("name", [
        "../server.py", "..%2Fserver.py", "foo/bar.webp", "nope.webp", "ice_bear.exe",
    ])
    def test_media_rejects_traversal_and_unknown(self, name):
        r = requests.get(f"{API}/static/entrances/{name}", timeout=15)
        assert r.status_code in (404, 400), f"{name} -> {r.status_code}"
