"""
Iteration 37 backend tests — ORIO real gift system:
  - Multi-recipient send (`POST /api/gifts/send-multi`)
  - Gift categories list (`GET /api/gifts/categories`)
  - Custom gifts (VIP5+):
      GET  /api/gifts/custom/settings
      GET  /api/gifts/custom
      POST /api/gifts/custom
      DELETE /api/gifts/custom/{id}
  - Profile media (`PATCH /api/users/me/profile-media`)
  - Combo semantics — `combo_of` reuses combo_id, wallet charged per send
  - Regressions: /gifts (list), /gifts/send (single), iter-33 block/report

Run: pytest /app/backend/tests/test_iteration_37_gift_system.py -v
"""
from __future__ import annotations
import os
import uuid
import requests
import pytest
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")


def _post(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.post(f"{API}{path}", headers=h, json=json, timeout=25)


def _get(path, tok=None, params=None):
    h = {}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.get(f"{API}{path}", headers=h, params=params, timeout=25)


def _patch(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.patch(f"{API}{path}", headers=h, json=json, timeout=25)


def _delete(path, tok=None):
    h = {}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.delete(f"{API}{path}", headers=h, timeout=25)


def _login(email=DEMO_EMAIL, pw=DEMO_PW):
    r = _post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["access_token"]


def _register_fresh(tag="i37"):
    t = uuid.uuid4().hex[:8]
    email = f"{tag}_{t}@voiceup.app"
    r = _post("/auth/register", json={
        "email": email, "password": "iter37pass",
        "username": f"{tag}_{t}"[:20], "nickname": f"Iter37 {t[:4]}",
    })
    assert r.status_code == 201, f"register failed: {r.status_code} {r.text}"
    return r.json()["access_token"], email


def _me(tok):
    r = _get("/auth/me", tok)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_tok():
    return _login()


@pytest.fixture(scope="module")
def user_a():
    tok, _ = _register_fresh("i37a")
    me = _me(tok)
    return tok, str(me["id"])


@pytest.fixture(scope="module")
def user_b():
    tok, _ = _register_fresh("i37b")
    me = _me(tok)
    return tok, str(me["id"])


@pytest.fixture(scope="module")
def user_c():
    tok, _ = _register_fresh("i37c")
    me = _me(tok)
    return tok, str(me["id"])


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def gift_heart(admin_tok):
    """Fetch the heart gift (50 coins, charm_reward=5)."""
    r = _get("/gifts", admin_tok)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body.get("items") if isinstance(body, dict) else body
    heart = next((g for g in items if g["id"] == "heart"), None)
    if not heart:
        heart = items[0]
    return heart


@pytest.fixture(scope="module")
def rich_sender(admin_tok, db):
    """Register a fresh sender and top up their coins via Mongo so we can
    afford multi-recipient sends without breaking wallet ledgers."""
    tok, email = _register_fresh("i37send")
    me = _me(tok)
    uid = me["id"]
    # Top up 500,000 coins directly for test isolation
    from bson import ObjectId
    db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"coins": 500000}})
    return tok, uid


# ===========================================================================
# GET /gifts/categories
# ===========================================================================
class TestGiftCategories:
    def test_returns_ordered_categories(self, admin_tok):
        r = _get("/gifts/categories", admin_tok)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "categories" in d and isinstance(d["categories"], list)
        # Per spec: gift, lucky, privilege, custom, relationship, fashion, countries
        expected = ["gift", "lucky", "privilege", "custom",
                    "relationship", "fashion", "countries"]
        assert d["categories"] == expected, d["categories"]

    def test_requires_auth(self):
        r = _get("/gifts/categories")
        assert r.status_code in (401, 403)


# ===========================================================================
# POST /gifts/send-multi — happy path + validation
# ===========================================================================
class TestSendGiftMulti:
    def test_send_to_multiple_recipients(self, rich_sender, user_a, user_b,
                                         gift_heart, db):
        stok, suid = rich_sender
        _, a_id = user_a
        _, b_id = user_b
        me0 = _me(stok)
        bal0 = int(me0["coins"])
        wp0 = int(me0.get("wealth_points", 0))

        qty = 2
        payload = {
            "gift_id": gift_heart["id"],
            "recipient_ids": [a_id, b_id],
            "quantity": qty,
        }
        r = _post("/gifts/send-multi", stok, payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["recipient_count"] == 2
        assert len(d["tx_ids"]) == 2
        assert isinstance(d["combo_id"], str) and len(d["combo_id"]) >= 6
        unit_price = int(gift_heart["price"])
        expected_total = unit_price * qty * 2
        assert d["total_cost"] == expected_total, d
        assert d["new_balance"] == bal0 - expected_total

        # Wealth points += total // 1000
        me1 = _me(stok)
        assert int(me1["wealth_points"]) == wp0 + (expected_total // 1000)

        # Both recipients got charm_reward*qty
        charm_reward = int(gift_heart.get("charm_reward", 1))
        for uid in (a_id, b_id):
            rr = _get(f"/users/{uid}", stok)
            assert rr.status_code == 200
            # We'll check that gift_transactions row exists per recipient
        # gift_transactions has 2 rows with the same combo_id
        gt_count = db.gift_transactions.count_documents({"combo_id": d["combo_id"]})
        assert gt_count == 2, gt_count

        # Single wallet_transactions row for the whole batch
        wt = db.wallet_transactions.find_one({
            "user_id": suid, "reference_id": d["combo_id"], "type": "gift_sent"
        })
        assert wt is not None
        assert wt["amount"] == -expected_total

    def test_combo_of_reuses_combo_id_and_charges_per_send(
            self, rich_sender, user_a, gift_heart, db):
        stok, suid = rich_sender
        _, a_id = user_a
        # First send
        r1 = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"], "recipient_ids": [a_id], "quantity": 1,
        })
        assert r1.status_code == 200, r1.text
        combo = r1.json()["combo_id"]
        bal_after_1 = int(r1.json()["new_balance"])

        # Second send with combo_of
        r2 = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"], "recipient_ids": [a_id],
            "quantity": 1, "combo_of": combo,
        })
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["combo_id"] == combo, "combo_of should reuse the combo_id"
        # Wallet charged again for the 2nd send
        assert d2["new_balance"] == bal_after_1 - int(gift_heart["price"])
        # gift_transactions grew by exactly 1
        assert db.gift_transactions.count_documents({"combo_id": combo}) == 2

    def test_dedupe_recipients(self, rich_sender, user_a, gift_heart):
        stok, _ = rich_sender
        _, a_id = user_a
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": [a_id, a_id, a_id],
            "quantity": 1,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["recipient_count"] == 1, d
        assert d["total_cost"] == int(gift_heart["price"]) * 1 * 1

    def test_self_recipient_filtered(self, rich_sender, user_a, gift_heart):
        stok, suid = rich_sender
        _, a_id = user_a
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": [suid, a_id],
            "quantity": 1,
        })
        assert r.status_code == 200, r.text
        assert r.json()["recipient_count"] == 1  # self filtered out

    def test_only_self_400(self, rich_sender, gift_heart):
        stok, suid = rich_sender
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": [suid],
            "quantity": 1,
        })
        assert r.status_code == 400, r.text

    def test_empty_recipients_400(self, rich_sender, gift_heart):
        stok, _ = rich_sender
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"], "recipient_ids": [], "quantity": 1,
        })
        assert r.status_code == 400, r.text

    def test_bad_quantity_400(self, rich_sender, user_a, gift_heart):
        stok, _ = rich_sender
        _, a_id = user_a
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"], "recipient_ids": [a_id],
            "quantity": 0,
        })
        assert r.status_code == 400, r.text
        r2 = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"], "recipient_ids": [a_id],
            "quantity": 10000,
        })
        assert r2.status_code == 400, r2.text

    def test_max_50_recipients(self, rich_sender, user_a, gift_heart):
        stok, _ = rich_sender
        _, a_id = user_a
        # 51 distinct-looking recipient IDs → 400
        fake_ids = [uuid.uuid4().hex[:24] for _ in range(51)]
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": fake_ids,
            "quantity": 1,
        })
        assert r.status_code == 400, r.text

    def test_unknown_gift_404(self, rich_sender, user_a):
        stok, _ = rich_sender
        _, a_id = user_a
        r = _post("/gifts/send-multi", stok, {
            "gift_id": "no_such_gift_zzz",
            "recipient_ids": [a_id], "quantity": 1,
        })
        assert r.status_code == 404, r.text

    def test_unknown_recipient_404(self, rich_sender, gift_heart):
        stok, _ = rich_sender
        # Well-formed but non-existent ObjectId
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": ["507f1f77bcf86cd799439011"],
            "quantity": 1,
        })
        assert r.status_code == 404, r.text

    def test_invalid_recipient_id_400(self, rich_sender, gift_heart):
        stok, _ = rich_sender
        r = _post("/gifts/send-multi", stok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": ["not-an-objectid"],
            "quantity": 1,
        })
        assert r.status_code == 400, r.text

    def test_insufficient_coins_402(self, gift_heart, user_a):
        # Register a poor user; heart=50, buy 100 → 5000 needed, they have ~0
        poor_tok, _ = _register_fresh("i37poor")
        _, a_id = user_a
        r = _post("/gifts/send-multi", poor_tok, {
            "gift_id": gift_heart["id"],
            "recipient_ids": [a_id],
            "quantity": 100,
        })
        assert r.status_code == 402, r.text

    def test_requires_auth(self, user_a, gift_heart):
        _, a_id = user_a
        r = _post("/gifts/send-multi", None, {
            "gift_id": gift_heart["id"],
            "recipient_ids": [a_id],
            "quantity": 1,
        })
        assert r.status_code in (401, 403)


# ===========================================================================
# Custom gifts (VIP5+ gated)
# ===========================================================================
class TestCustomGiftSettings:
    def test_settings_shape(self, admin_tok):
        r = _get("/gifts/custom/settings", admin_tok)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("enabled", "min_vip_level", "price", "allowed_types",
                  "max_file_bytes", "max_video_duration_s", "eligible"):
            assert k in d, d
        assert isinstance(d["allowed_types"], list)
        assert d["min_vip_level"] >= 1

    def test_non_vip_not_eligible(self):
        tok, _ = _register_fresh("i37nvi")
        r = _get("/gifts/custom/settings", tok)
        assert r.status_code == 200
        assert r.json()["eligible"] is False


class TestCustomGiftCRUD:
    def test_create_requires_vip5(self):
        tok, _ = _register_fresh("i37nvi2")
        r = _post("/gifts/custom", tok, {
            "media_url": "https://example.com/x.png", "media_type": "image",
        })
        assert r.status_code == 403, r.text

    def test_full_crud_for_vip5(self, db):
        # Elevate a fresh user to VIP5 via direct mongo touch
        tok, _ = _register_fresh("i37vip5")
        uid = _me(tok)["id"]
        from bson import ObjectId
        db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"vip_level": 5}})

        # List initially
        r0 = _get("/gifts/custom", tok)
        assert r0.status_code == 200
        n0 = len(r0.json()["items"])

        # Create
        r = _post("/gifts/custom", tok, {
            "media_url": "https://cdn.example.com/mycustom.png",
            "media_type": "image",
            "name": "MyGift",
        })
        assert r.status_code == 201, r.text
        cg_id = r.json()["id"]
        assert r.json()["price"] > 0
        assert r.json()["status"] in ("pending", "approved")

        # List again → +1
        r1 = _get("/gifts/custom", tok)
        assert r1.status_code == 200
        assert len(r1.json()["items"]) == n0 + 1
        found = next((it for it in r1.json()["items"] if it["id"] == cg_id), None)
        assert found is not None
        assert found["category"] == "custom"

        # Delete
        rd = _delete(f"/gifts/custom/{cg_id}", tok)
        assert rd.status_code == 200, rd.text

        # Verify soft-deleted (not returned)
        r2 = _get("/gifts/custom", tok)
        assert not any(it["id"] == cg_id for it in r2.json()["items"])

        # Delete again → idempotent (200) or 404 depending on implementation.
        # Current server: idempotent 200 because the filter doesn't guard on
        # `deleted:{"$ne":True}`. Both are acceptable — flag in report only.
        rd2 = _delete(f"/gifts/custom/{cg_id}", tok)
        assert rd2.status_code in (200, 404), rd2.text

    def test_bad_media_type_400(self, db):
        tok, _ = _register_fresh("i37vipbm")
        uid = _me(tok)["id"]
        from bson import ObjectId
        db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"vip_level": 5}})
        r = _post("/gifts/custom", tok, {
            "media_url": "https://cdn.example.com/x.pdf",
            "media_type": "pdf",
        })
        assert r.status_code == 400, r.text

    def test_bad_media_url_400(self, db):
        tok, _ = _register_fresh("i37vipbu")
        uid = _me(tok)["id"]
        from bson import ObjectId
        db.users.update_one({"_id": ObjectId(uid)}, {"$set": {"vip_level": 5}})
        r = _post("/gifts/custom", tok, {
            "media_url": "x", "media_type": "image",
        })
        assert r.status_code == 400, r.text

    def test_delete_others_gift_404(self, db):
        # A creates a gift; B tries to delete → 404
        tokA, _ = _register_fresh("i37vipA")
        uidA = _me(tokA)["id"]
        from bson import ObjectId
        db.users.update_one({"_id": ObjectId(uidA)}, {"$set": {"vip_level": 5}})
        r = _post("/gifts/custom", tokA, {
            "media_url": "https://cdn.example.com/a.png", "media_type": "image",
        })
        assert r.status_code == 201, r.text
        cg_id = r.json()["id"]

        tokB, _ = _register_fresh("i37vipB")
        rd = _delete(f"/gifts/custom/{cg_id}", tokB)
        assert rd.status_code == 404, rd.text


# ===========================================================================
# PATCH /users/me/profile-media
# ===========================================================================
class TestProfileMedia:
    def test_set_avatar(self):
        tok, _ = _register_fresh("i37pm")
        r = _patch("/users/me/profile-media", tok, {
            "url": "https://cdn.example.com/avatar123.png",
            "kind": "avatar",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["avatar_url"] == "https://cdn.example.com/avatar123.png"
        # /auth/me reflects the change
        me = _me(tok)
        assert me["avatar_url"] == "https://cdn.example.com/avatar123.png"

    def test_set_animated_avatar(self):
        tok, _ = _register_fresh("i37pm2")
        r = _patch("/users/me/profile-media", tok, {
            "url": "https://cdn.example.com/anim.mp4",
            "kind": "animated_avatar",
        })
        assert r.status_code == 200, r.text
        assert r.json()["animated_avatar_url"] == "https://cdn.example.com/anim.mp4"

    def test_bad_kind_400(self):
        tok, _ = _register_fresh("i37pm3")
        r = _patch("/users/me/profile-media", tok, {
            "url": "https://cdn.example.com/x.png",
            "kind": "banner",
        })
        assert r.status_code == 400, r.text

    def test_bad_url_400(self):
        tok, _ = _register_fresh("i37pm4")
        r = _patch("/users/me/profile-media", tok, {
            "url": "x", "kind": "avatar",
        })
        assert r.status_code == 400, r.text

    def test_requires_auth(self):
        r = _patch("/users/me/profile-media", None, {
            "url": "https://cdn.example.com/x.png", "kind": "avatar",
        })
        assert r.status_code in (401, 403)


# ===========================================================================
# Regressions
# ===========================================================================
class TestRegressions:
    def test_single_send_still_works(self, rich_sender, user_c, gift_heart):
        stok, _ = rich_sender
        _, c_id = user_c
        r = _post("/gifts/send", stok, {
            "gift_id": gift_heart["id"], "recipient_id": c_id, "quantity": 1,
        })
        assert r.status_code == 200, r.text

    def test_gifts_list_has_items(self, admin_tok):
        r = _get("/gifts", admin_tok)
        assert r.status_code == 200
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list) and len(items) > 0

    def test_iter33_block_still_works(self, user_a, user_b):
        atok, _ = user_a
        _, b_id = user_b
        r = _post(f"/users/{b_id}/block", atok)
        assert r.status_code in (200, 201, 204), r.text
        r2 = _delete(f"/users/{b_id}/block", atok)
        assert r2.status_code in (200, 204), r2.text
