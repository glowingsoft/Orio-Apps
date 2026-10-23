"""Iter-67 — Room cover moderation + 3-day block list + owner-only cover update."""
import os
import pytest
import httpx
from pymongo import MongoClient

pytestmark = pytest.mark.asyncio

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
_CLIENT = MongoClient(MONGO_URL)
DB = _CLIENT[DB_NAME]


@pytest.fixture
def base_url():
    return "http://localhost:8001"


async def _register(c: httpx.AsyncClient, base_url: str):
    import uuid
    s = uuid.uuid4().hex[:8]
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter67_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i67_{s}",
            "nickname": f"i67 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    r2 = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 200
    return tok, r2.json()


async def test_moderation_rejects_tiny_image_and_blocks_hash(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        tiny = "data:image/png;base64,AA=="
        r = await c.post(
            f"{base_url}/api/room-covers/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": tiny},
        )
        assert r.status_code == 403, r.text
        # Iter-69: moderation failure returns USER_MEDIA_BLOCKED (the client
        # renders the Arabic 3-day notice). Both per-hash and user-wide blocks
        # are recorded.
        assert "USER_MEDIA_BLOCKED" in r.text
        # Retry — now blocked by per-user hash list OR user-wide block
        r2 = await c.post(
            f"{base_url}/api/room-covers/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": tiny},
        )
        assert r2.status_code == 403
        assert "USER_MEDIA_BLOCKED" in r2.text or "blocked" in r2.text.lower()


async def test_moderation_accepts_valid_url(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/room-covers/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": "https://images.unsplash.com/photo-xyz"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True


async def test_room_cover_patch_owner_only(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        # Create a room
        cr = await c.post(
            f"{base_url}/api/rooms",
            headers={"Authorization": f"Bearer {tok}"},
            json={"name": "Iter67 Room", "category": "chat", "num_seats": 8},
        )
        assert cr.status_code in (200, 201), cr.text
        room_id = cr.json()["id"]
        # Owner can update cover
        upd = await c.patch(
            f"{base_url}/api/rooms/{room_id}/cover",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": "https://images.unsplash.com/photo-cover-123"},
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["cover_url"].endswith("photo-cover-123")

        # A stranger cannot update
        other_tok, _ = await _register(c, base_url)
        bad = await c.patch(
            f"{base_url}/api/rooms/{room_id}/cover",
            headers={"Authorization": f"Bearer {other_tok}"},
            json={"cover_url": "https://images.unsplash.com/photo-abc"},
        )
        assert bad.status_code == 403, bad.text


async def test_moderation_blocks_global_hash(base_url):
    """Admin populates `moderation_blocked_hashes` → any user upload with
    that hash is rejected and the user is blocked for 3 days."""
    import hashlib
    bad_url = "https://images.example.com/known-bad.jpg"
    h = hashlib.sha256(bad_url.encode("utf-8")).hexdigest()
    DB.moderation_blocked_hashes.update_one(
        {"image_hash": h}, {"$set": {"image_hash": h, "reason": "test"}}, upsert=True
    )
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            tok, _ = await _register(c, base_url)
            r = await c.post(
                f"{base_url}/api/room-covers/moderate",
                headers={"Authorization": f"Bearer {tok}"},
                json={"cover_url": bad_url},
            )
            assert r.status_code == 403, r.text
            # Iter-69: the user-wide 3-day block fires on any moderation
            # rejection — the standardized sentinel is `USER_MEDIA_BLOCKED`.
            assert "USER_MEDIA_BLOCKED" in r.text
    finally:
        DB.moderation_blocked_hashes.delete_one({"image_hash": h})
