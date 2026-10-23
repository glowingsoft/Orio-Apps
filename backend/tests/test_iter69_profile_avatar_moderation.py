"""Iter-69 — Profile avatar / GIF endpoints with VIP5 gate + user-wide block."""
import os
import uuid
import pytest
import httpx
from datetime import datetime, timedelta, timezone
from bson import ObjectId
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
    s = uuid.uuid4().hex[:8]
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter69_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i69_{s}",
            "nickname": f"i69 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    me = (await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})).json()
    return tok, me


async def test_profile_photo_moderation_and_patch(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        # Moderate (ok)
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/photo.jpg", "kind": "photo"},
        )
        assert r.status_code == 200, r.text
        # Patch persists
        p = await c.patch(
            f"{base_url}/api/me/profile-avatar",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/photo-xyz.jpg", "kind": "photo"},
        )
        assert p.status_code == 200, p.text
        assert p.json()["avatar_url"].endswith("photo-xyz.jpg")
        assert p.json().get("animated_avatar_url") is None


async def test_profile_gif_requires_vip5(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/anim.gif", "kind": "gif"},
        )
        assert r.status_code == 403
        assert "GIF_VIP5_REQUIRED" in r.text


async def test_profile_gif_allowed_when_vip5(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        DB.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"vip_level": 5}})
        # Smallest valid single-frame GIF (data URI) — passes PIL parsing and
        # the Iter-71 limits (1×1 px, 1 frame, 0 ms).
        tiny_gif_b64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        gif = f"data:image/gif;base64,{tiny_gif_b64}"
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": gif, "kind": "gif"},
        )
        assert r.status_code == 200, r.text


async def test_photo_endpoint_rejects_gif_payload(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/anim.gif", "kind": "photo"},
        )
        assert r.status_code == 400


async def test_user_wide_media_block_persists(base_url):
    """When moderation flags a bad image, the user is blocked for 3 days
    across BOTH profile and room avatars."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        uid = me["id"]
        # Force a user-level media block
        DB.users.update_one(
            {"_id": ObjectId(uid)},
            {"$set": {"media_blocked_until": datetime.now(timezone.utc) + timedelta(days=3)}},
        )
        # Status endpoint reflects it
        s = await c.get(f"{base_url}/api/me/media-block", headers={"Authorization": f"Bearer {tok}"})
        assert s.status_code == 200
        assert s.json()["blocked"] is True
        # Profile photo blocked
        p = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/photo.jpg", "kind": "photo"},
        )
        assert p.status_code == 403
        assert "USER_MEDIA_BLOCKED" in p.text
        # Room cover endpoint also blocked (sanity)
        rc = await c.post(
            f"{base_url}/api/room-covers/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": "https://example.com/room.jpg"},
        )
        assert rc.status_code == 403
        assert "USER_MEDIA_BLOCKED" in rc.text


async def test_bad_image_triggers_user_wide_block(base_url):
    """Moderation failure records BOTH the per-user hash block AND the
    user-wide 3-day avatar block."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        tiny = "data:image/png;base64,AA=="
        r = await c.post(
            f"{base_url}/api/room-covers/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"cover_url": tiny},
        )
        assert r.status_code == 403
        assert "USER_MEDIA_BLOCKED" in r.text
        # Status endpoint now reports blocked
        s = await c.get(f"{base_url}/api/me/media-block", headers={"Authorization": f"Bearer {tok}"})
        assert s.json()["blocked"] is True
