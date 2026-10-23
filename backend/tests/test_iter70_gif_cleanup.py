"""Iter-70 — Legacy GIF cleanup + public_user hides sub-VIP5 GIFs."""
import os
import pytest
import httpx
from datetime import datetime, timezone
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
    import uuid
    s = uuid.uuid4().hex[:8]
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter70_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i70_{s}",
            "nickname": f"i70 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    me = (await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})).json()
    return tok, me


async def test_public_user_hides_gif_for_sub_vip5(base_url):
    """A user with a legacy animated_avatar_url in Mongo but vip_level < 5
    MUST NOT have the field exposed via /auth/me (or any public_user call)."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        uid = ObjectId(me["id"])
        # Write a dangling GIF directly to the DB (simulating legacy state)
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 2,
                "animated_avatar_url": "https://example.com/dangling.gif",
                "avatar_url": "https://example.com/static.jpg",
            }},
        )
        r = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        body = r.json()
        assert body["animated_avatar_url"] is None, body
        # Static photo preserved
        assert body["avatar_url"] == "https://example.com/static.jpg"


async def test_public_user_shows_gif_for_vip5_plus(base_url):
    """VIP5+ users keep their animated_avatar_url visible."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        uid = ObjectId(me["id"])
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 5,
                "animated_avatar_url": "https://example.com/legit.gif",
                "avatar_url": "https://example.com/static.jpg",
            }},
        )
        r = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["animated_avatar_url"].endswith("legit.gif")


async def test_sub_vip5_cannot_patch_gif(base_url):
    """VIP < 5 trying to PATCH an animated avatar must still 403."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.patch(
            f"{base_url}/api/me/profile-avatar",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": "https://example.com/anim.gif", "kind": "gif"},
        )
        assert r.status_code == 403
        assert "GIF_VIP5_REQUIRED" in r.text
