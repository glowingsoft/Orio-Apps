"""Iter-73 — Room Tools: premium backgrounds + owner_public numeric_id.

Verifies the surgical additions:
  1. `GET /rooms/backgrounds/catalog` returns 20+ curated backgrounds that
     cover the user-requested themes (cars, lions, tigers, falcons, flowers,
     houses, luxury, …).
  2. `POST /rooms/{id}/background/preset` applies a preset for the owner
     only and updates `rooms.background_url` immediately.
  3. Only the owner can set the background. Arbitrary/unknown URLs are
     rejected so the preset endpoint can't bypass custom moderation.
  4. `owner_public` on `/rooms` responses now includes `numeric_id` and
     `username` so the host area can show the owner's ID.
"""
import os
import uuid
import pytest
import httpx
from pymongo import MongoClient

pytestmark = pytest.mark.asyncio

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
_CLIENT = MongoClient(MONGO_URL)
DB = _CLIENT[DB_NAME]

REQUIRED_CATEGORIES = {"cars", "animals", "flowers", "houses", "luxury"}


@pytest.fixture
def base_url():
    return "http://localhost:8001"


async def _register(c: httpx.AsyncClient, base_url: str):
    s = uuid.uuid4().hex[:8]
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter73_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i73_{s}",
            "nickname": f"i73 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


async def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_catalog_returns_20_plus_backgrounds(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        headers = await _auth(token)
        r = await c.get(f"{base_url}/api/rooms/backgrounds/catalog", headers=headers)
        assert r.status_code == 200, r.text
        items = r.json()["backgrounds"]
        assert len(items) >= 20, f"Expected 20+ backgrounds, got {len(items)}"
        # All required thematic categories must appear.
        got = {b["category"] for b in items}
        missing = REQUIRED_CATEGORIES - got
        assert not missing, f"Missing required categories: {missing}"
        # Each entry must have id, image_url, and Arabic + English titles.
        for b in items:
            assert b.get("id"), b
            assert b.get("image_url", "").startswith("http"), b
            assert b.get("title_en"), b
            assert b.get("title_ar"), b


@pytest.mark.asyncio
async def test_owner_can_apply_preset(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        headers = await _auth(token)
        # Create a room (owner can later change the background).
        rr = await c.post(
            f"{base_url}/api/rooms",
            headers=headers,
            json={
                "name": f"iter73 bg {uuid.uuid4().hex[:6]}",
                "description": "iter73 bg",
                "category": "chat",
                "num_seats": 8,
                "is_private": False,
            },
        )
        assert rr.status_code in (200, 201), rr.text
        room_id = rr.json()["id"]
        # Grab the first catalog item.
        cat = await c.get(f"{base_url}/api/rooms/backgrounds/catalog", headers=headers)
        bg = cat.json()["backgrounds"][0]
        # Apply it.
        rp = await c.post(
            f"{base_url}/api/rooms/{room_id}/background/preset",
            headers=headers,
            json={"bg_id": bg["id"]},
        )
        assert rp.status_code == 200, rp.text
        body = rp.json()
        assert body["background_url"] == bg["image_url"]
        # Verify room reflects it.
        rg = await c.get(f"{base_url}/api/rooms/{room_id}", headers=headers)
        assert rg.json()["background_url"] == bg["image_url"]


@pytest.mark.asyncio
async def test_non_owner_cannot_apply_preset(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        owner_tok = await _register(c, base_url)
        owner_h = await _auth(owner_tok)
        rr = await c.post(
            f"{base_url}/api/rooms",
            headers=owner_h,
            json={
                "name": f"iter73 bg2 {uuid.uuid4().hex[:6]}",
                "description": "d",
                "category": "chat",
                "num_seats": 8,
                "is_private": False,
            },
        )
        room_id = rr.json()["id"]
        other_tok = await _register(c, base_url)
        other_h = await _auth(other_tok)
        cat = await c.get(f"{base_url}/api/rooms/backgrounds/catalog", headers=owner_h)
        bg_id = cat.json()["backgrounds"][0]["id"]
        rp = await c.post(
            f"{base_url}/api/rooms/{room_id}/background/preset",
            headers=other_h,
            json={"bg_id": bg_id},
        )
        assert rp.status_code == 403, rp.text


@pytest.mark.asyncio
async def test_unknown_bg_rejected(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        h = await _auth(token)
        rr = await c.post(
            f"{base_url}/api/rooms",
            headers=h,
            json={
                "name": f"iter73 bg3 {uuid.uuid4().hex[:6]}",
                "description": "d",
                "category": "chat",
                "num_seats": 8,
                "is_private": False,
            },
        )
        room_id = rr.json()["id"]
        # Unknown bg_id.
        r1 = await c.post(
            f"{base_url}/api/rooms/{room_id}/background/preset",
            headers=h,
            json={"bg_id": "does_not_exist"},
        )
        assert r1.status_code == 400
        # Arbitrary image_url not in catalog.
        r2 = await c.post(
            f"{base_url}/api/rooms/{room_id}/background/preset",
            headers=h,
            json={"image_url": "https://evil.example.com/anything.jpg"},
        )
        assert r2.status_code == 400


@pytest.mark.asyncio
async def test_owner_public_includes_numeric_id(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        h = await _auth(token)
        rr = await c.post(
            f"{base_url}/api/rooms",
            headers=h,
            json={
                "name": f"iter73 id {uuid.uuid4().hex[:6]}",
                "description": "id test",
                "category": "chat",
                "num_seats": 8,
                "is_private": False,
            },
        )
        assert rr.status_code in (200, 201), rr.text
        owner = rr.json()["owner"]
        assert owner.get("numeric_id"), f"owner_public must include numeric_id, got {owner}"
        assert owner.get("username"), f"owner_public must include username, got {owner}"
