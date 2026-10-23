"""Iter-152 — Unlimited custom gifts backend tests.

Covers:
 1. POST /api/gifts/custom no longer enforces max_per_user (VIP5 user can create >3).
 2. VIP<5 user → 403 Requires VIP 5+.
 3. VIP5+ missing video_url → 400 Gift video is required.
"""
import os
import pytest
import requests
import pymongo
from bson import ObjectId
from datetime import datetime, timezone

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
PASS = "demo1234"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    return pymongo.MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def tokens():
    return {
        "t1": _login("test.1@oriotest.dev", PASS),   # VIP3 (should be <5)
        "t2": _login("test.2@oriotest.dev", PASS),   # VIP5
    }


@pytest.fixture(scope="module")
def user_ids(tokens):
    out = {}
    for k, tok in tokens.items():
        r = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15).json()
        out[k] = r["id"]
    return out


def _seed_media(db, owner_id, kind, with_duration=False):
    """Seed a media_files record with purpose='gift' owned by the given user."""
    doc = {
        "owner_id": owner_id,
        "kind": kind,  # "image" or "video"
        "purpose": "gift",
        "url": f"/api/media/files/placeholder",
        "mime": "video/mp4" if kind == "video" else "image/png",
        "size": 1024,
        "created_at": datetime.now(timezone.utc),
        "is_deleted": False,
        "name": "TEST_iter152_media",
    }
    if with_duration or kind == "video":
        doc["duration"] = 5.0  # 5s video (≤10.5s)
    r = db.media_files.insert_one(doc)
    return str(r.inserted_id)


@pytest.fixture(scope="module")
def seeded_media(db, user_ids):
    """Seed enough image+video media_files for the VIP5 user to create 5 custom gifts."""
    created = []
    pairs_for_t2 = []
    for _ in range(5):
        img_id = _seed_media(db, user_ids["t2"], "image")
        vid_id = _seed_media(db, user_ids["t2"], "video")
        created.extend([img_id, vid_id])
        pairs_for_t2.append((img_id, vid_id))
    # Also one pair for t1 (VIP3) to attempt create → 403
    img_t1 = _seed_media(db, user_ids["t1"], "image")
    vid_t1 = _seed_media(db, user_ids["t1"], "video")
    created.extend([img_t1, vid_t1])
    yield {"t2": pairs_for_t2, "t1": (img_t1, vid_t1)}
    # Teardown media
    for mid in created:
        try:
            db.media_files.delete_one({"_id": ObjectId(mid)})
        except Exception:
            pass
    # Teardown any custom gifts created
    db.custom_gifts.delete_many({"name": {"$regex": "^TEST_iter152"}})


# ─────────────────────────────────────────────────────────────────────
# 1. VIP5+ unlimited (create 5 gifts in a row)
# ─────────────────────────────────────────────────────────────────────
class TestUnlimitedCustomGifts:
    def test_vip5_can_create_more_than_three(self, tokens, seeded_media, db):
        created_ids = []
        for i, (img_id, vid_id) in enumerate(seeded_media["t2"]):
            payload = {
                "name": f"TEST_iter152_cg_{i}",
                "media_url": f"/api/media/files/{img_id}",
                "media_type": "image",
                "video_url": f"/api/media/files/{vid_id}",
            }
            r = requests.post(f"{API}/gifts/custom", headers=_auth(tokens["t2"]), json=payload, timeout=20)
            assert r.status_code == 201, f"[gift #{i+1}] expected 201, got {r.status_code}: {r.text}"
            j = r.json()
            assert j.get("price") == 4999
            assert j.get("status") == "approved"
            assert j.get("id")
            created_ids.append(j["id"])
        # All 5 should persist and be visible via admin-less GET /api/gifts/custom
        r = requests.get(f"{API}/gifts/custom", headers=_auth(tokens["t2"]), timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        listed_ids = {g["id"] for g in items}
        for cid in created_ids:
            assert cid in listed_ids, f"created gift {cid} not listed"
        # Explicit check: >3 is allowed (previous cap was 3)
        assert len(created_ids) == 5

    def test_vip_below_5_forbidden(self, tokens, seeded_media):
        img_id, vid_id = seeded_media["t1"]
        payload = {
            "name": "TEST_iter152_cg_vip3",
            "media_url": f"/api/media/files/{img_id}",
            "media_type": "image",
            "video_url": f"/api/media/files/{vid_id}",
        }
        r = requests.post(f"{API}/gifts/custom", headers=_auth(tokens["t1"]), json=payload, timeout=20)
        assert r.status_code == 403, f"expected 403 for VIP<5, got {r.status_code}: {r.text}"

    def test_vip5_missing_video_returns_400(self, tokens, seeded_media):
        img_id, _ = seeded_media["t2"][0]
        payload = {
            "name": "TEST_iter152_novideo",
            "media_url": f"/api/media/files/{img_id}",
            "media_type": "image",
            # no video_url
        }
        r = requests.post(f"{API}/gifts/custom", headers=_auth(tokens["t2"]), json=payload, timeout=20)
        assert r.status_code == 400, f"expected 400 for missing video, got {r.status_code}: {r.text}"
        assert "video" in r.text.lower()
