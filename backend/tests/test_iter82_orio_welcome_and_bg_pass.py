"""Iter-82 — ORIO Welcome default + 15-day custom-bg pass + VIP6 gate.

Verifies:
  1. New rooms ship with `background_preset_id = "orio_welcome"` and the
     ORIO Welcome background_url.
  2. The catalog contains the `orio_welcome` entry.
  3. Changing `cover_url` (room avatar) does NOT touch `background_url`.
  4. `/rooms/custom-background/entitlement` reports VIP + pass status.
  5. `/rooms/custom-background/purchase-15d` deducts exactly 50 000 Diamonds,
     grants a 15-day entitlement, and refuses when balance is low.
  6. VIP6+ users cannot buy the pass (409).
  7. `POST /rooms/{id}/background` is 403 for users without VIP6+ or an
     active pass; 201 (pending) after purchase; 201 again for VIP6+ users.
  8. `public_room.background_url` never falls back to `cover_url`.
"""
import os
import base64
import uuid
import pytest
import httpx
from pymongo import MongoClient
from bson import ObjectId

pytestmark = pytest.mark.asyncio

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
DB = MongoClient(MONGO_URL)[DB_NAME]

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.fixture
def base_url():
    return "http://localhost:8001"


def _big_png_data_uri() -> str:
    png_bytes = base64.b64decode(TINY_PNG_B64)
    big = png_bytes + b"\x00" * 3000
    return f"data:image/png;base64,{base64.b64encode(big).decode()}"


async def _register(c, base_url):
    s = uuid.uuid4().hex[:8]
    email = f"iter82_{s}@orio-tests.example.com"
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Testing1234!", "username": f"i82_{s}", "nickname": f"i82 {s}"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"], email


async def _create_room(c, base_url, token):
    rr = await c.post(
        f"{base_url}/api/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": f"i82 {uuid.uuid4().hex[:6]}", "description": "d", "category": "chat", "num_seats": 8, "is_private": False},
    )
    assert rr.status_code in (200, 201), rr.text
    return rr.json()


@pytest.mark.asyncio
async def test_new_room_ships_with_orio_welcome(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        room = await _create_room(c, base_url, token)
        assert room["background_preset_id"] == "orio_welcome"
        assert "unsplash" in (room["background_url"] or "")


@pytest.mark.asyncio
async def test_catalog_includes_orio_welcome(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        r = await c.get(f"{base_url}/api/rooms/backgrounds/catalog", headers={"Authorization": f"Bearer {token}"})
        items = r.json()["backgrounds"]
        assert any(b["id"] == "orio_welcome" for b in items)


@pytest.mark.asyncio
async def test_entitlement_defaults_to_locked(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        r = await c.get(f"{base_url}/api/rooms/custom-background/entitlement", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["can_submit"] is False
        assert body["pass_active"] is False
        assert body["vip6_unlimited"] is False
        assert body["price_diamonds"] == 50000
        assert body["days"] == 15


@pytest.mark.asyncio
async def test_purchase_pass_deducts_50k_and_unlocks(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        h = {"Authorization": f"Bearer {token}"}
        # Low balance → 402.
        DB.users.update_one({"email": email}, {"$set": {"diamonds": 100}})
        r = await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        assert r.status_code == 402
        # Enough → 200.
        DB.users.update_one({"email": email}, {"$set": {"diamonds": 100000}})
        r2 = await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        assert r2.status_code == 200, r2.text
        assert r2.json()["diamonds_remaining"] == 50000
        assert r2.json()["days"] == 15
        # Entitlement is active now.
        e = await c.get(f"{base_url}/api/rooms/custom-background/entitlement", headers=h)
        assert e.json()["can_submit"] is True
        assert e.json()["pass_active"] is True


@pytest.mark.asyncio
async def test_vip6_cannot_buy_pass(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        DB.users.update_one({"email": email}, {"$set": {"vip_level": 6, "diamonds": 100000}})
        r = await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_submit_requires_entitlement(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        room = await _create_room(c, base_url, token)
        rid = room["id"]
        h = {"Authorization": f"Bearer {token}"}
        # Without entitlement → 403.
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r.status_code == 403, r.text
        # After purchasing the pass → 201.
        DB.users.update_one({"email": email}, {"$set": {"diamonds": 100000}})
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        r2 = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r2.status_code == 201, r2.text


@pytest.mark.asyncio
async def test_vip6_submits_without_pass(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        room = await _create_room(c, base_url, token)
        rid = room["id"]
        h = {"Authorization": f"Bearer {token}"}
        # Promote to VIP6; no pass purchased.
        DB.users.update_one({"email": email}, {"$set": {"vip_level": 6}})
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_cover_change_does_not_touch_background(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        room = await _create_room(c, base_url, token)
        rid = room["id"]
        orig_bg = room["background_url"]
        # Change the cover (Room Avatar).
        new_cover = "https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=400&q=85"
        r = await c.patch(
            f"{base_url}/api/rooms/{rid}/cover",
            headers={"Authorization": f"Bearer {token}"},
            json={"cover_url": new_cover},
        )
        assert r.status_code == 200, r.text
        # Background must remain the ORIO Welcome image, unchanged.
        rr = await c.get(f"{base_url}/api/rooms/{rid}", headers={"Authorization": f"Bearer {token}"})
        body = rr.json()
        assert body["cover_url"] == new_cover
        assert body["background_url"] == orig_bg, (
            "Changing Room Avatar (cover_url) must NOT change Room Background"
        )
