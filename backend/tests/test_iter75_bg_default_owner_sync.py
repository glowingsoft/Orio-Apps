"""Iter-75 — Catalog default + owner_public live sync + custom-bg switch.

Verifies the surgical additions:
  1. `GET /rooms/backgrounds/catalog` now includes the ORIO-branded default
     tile (`id="orio_default"`) and the catalog still has ≥20 entries.
  2. Admin approval of a custom bg sets BOTH `background_url` AND
     `custom_background_url` on the room so the owner can swap back.
  3. `POST /rooms/{id}/background/preset` with `bg_id="my_custom"`
     switches the active background back to the stored custom url;
     fails cleanly if no custom bg is on file.
  4. Updating the owner's profile (nickname / avatar) via `PATCH /users/me`
     propagates the change to every room they own (`owner_public` live-sync).
  5. Updating the avatar via `/users/me/profile-media` also propagates.
  6. `public_room` exposes `custom_background_url` and `background_preset_id`.
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


async def _register(c: httpx.AsyncClient, base_url: str):
    s = uuid.uuid4().hex[:8]
    email = f"iter75_{s}@orio-tests.example.com"
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Testing1234!", "username": f"i75_{s}", "nickname": f"i75 {s}"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"], email


async def _create_room(c: httpx.AsyncClient, base_url: str, token: str) -> str:
    rr = await c.post(
        f"{base_url}/api/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": f"i75 {uuid.uuid4().hex[:6]}", "description": "d", "category": "chat", "num_seats": 8, "is_private": False},
    )
    assert rr.status_code in (200, 201), rr.text
    return rr.json()["id"]


@pytest.mark.asyncio
async def test_catalog_includes_orio_default(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        r = await c.get(f"{base_url}/api/rooms/backgrounds/catalog", headers={"Authorization": f"Bearer {token}"})
        items = r.json()["backgrounds"]
        assert any(b["id"] == "orio_default" for b in items), "ORIO default must be in the catalog"
        assert len(items) >= 20


@pytest.mark.asyncio
async def test_admin_approval_sets_custom_background_url(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        DB.users.update_one({"email": email}, {"$set": {"diamonds": 100_000}})
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        # Iter-82 — buy the 15-day pass before submitting.
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        r = await c.post(f"{base_url}/api/rooms/{rid}/background", headers=h, json={"image_url": _big_png_data_uri()})
        assert r.status_code == 201, r.text
        sub_id = r.json()["sub_id"]
        DB.users.update_one({"email": email}, {"$set": {"is_admin": True}})
        a = await c.post(f"{base_url}/api/admin/room-backgrounds/{sub_id}/decision", headers=h, json={"decision": "approve"})
        assert a.status_code == 200, a.text
        room = DB.rooms.find_one({"_id": ObjectId(rid)})
        assert room.get("custom_background_url") == _big_png_data_uri()
        assert room.get("background_url") == _big_png_data_uri()
        assert room.get("background_preset_id") == "my_custom"


@pytest.mark.asyncio
async def test_switch_back_to_my_custom(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        DB.users.update_one({"email": email}, {"$set": {"diamonds": 100_000}})
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        # Iter-82 — buy the pass, submit, approve.
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        r = await c.post(f"{base_url}/api/rooms/{rid}/background", headers=h, json={"image_url": _big_png_data_uri()})
        sub_id = r.json()["sub_id"]
        DB.users.update_one({"email": email}, {"$set": {"is_admin": True}})
        await c.post(f"{base_url}/api/admin/room-backgrounds/{sub_id}/decision", headers=h, json={"decision": "approve"})
        # Switch to a preset.
        pr = await c.post(f"{base_url}/api/rooms/{rid}/background/preset", headers=h, json={"bg_id": "orio_default"})
        assert pr.status_code == 200
        room = DB.rooms.find_one({"_id": ObjectId(rid)})
        assert room.get("background_preset_id") == "orio_default"
        # Switch back to my_custom.
        rb = await c.post(f"{base_url}/api/rooms/{rid}/background/preset", headers=h, json={"bg_id": "my_custom"})
        assert rb.status_code == 200, rb.text
        assert rb.json()["background_url"] == _big_png_data_uri()
        room = DB.rooms.find_one({"_id": ObjectId(rid)})
        assert room.get("background_preset_id") == "my_custom"


@pytest.mark.asyncio
async def test_my_custom_without_upload_rejected(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        r = await c.post(f"{base_url}/api/rooms/{rid}/background/preset", headers=h, json={"bg_id": "my_custom"})
        assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_profile_update_does_NOT_propagate_to_owned_rooms(base_url):
    """Iter-76 — owner_public is a saved snapshot. Changing the owner's
    nickname via PATCH /users/me must NOT update the room's owner_public."""
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        # Capture the ORIGINAL snapshot.
        rr0 = await c.get(f"{base_url}/api/rooms/{rid}", headers=h)
        original_nick = rr0.json()["owner"]["nickname"]
        new_nick = f"NewNick {uuid.uuid4().hex[:4]}"
        pr = await c.patch(f"{base_url}/api/users/me", headers=h, json={"nickname": new_nick})
        assert pr.status_code == 200, pr.text
        # Room still reports the ORIGINAL nickname in owner_public.
        rr = await c.get(f"{base_url}/api/rooms/{rid}", headers=h)
        assert rr.json()["owner"]["nickname"] == original_nick, (
            "owner_public must remain the saved snapshot (Iter-76)"
        )


@pytest.mark.asyncio
async def test_profile_media_update_does_NOT_propagate_avatar(base_url):
    """Iter-76 — Updating avatar via /users/me/profile-media must NOT touch
    the room's owner_public.avatar_url snapshot."""
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        rr0 = await c.get(f"{base_url}/api/rooms/{rid}", headers=h)
        original_avatar = rr0.json()["owner"].get("avatar_url")
        url = "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=512&q=85"
        pr = await c.patch(f"{base_url}/api/users/me/profile-media", headers=h, json={"url": url, "kind": "avatar"})
        assert pr.status_code == 200, pr.text
        rr = await c.get(f"{base_url}/api/rooms/{rid}", headers=h)
        assert rr.json()["owner"].get("avatar_url") == original_avatar, (
            "owner_public.avatar_url must remain the saved snapshot (Iter-76)"
        )


@pytest.mark.asyncio
async def test_public_room_exposes_custom_fields(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, _ = await _register(c, base_url)
        rid = await _create_room(c, base_url, token)
        rr = await c.get(f"{base_url}/api/rooms/{rid}", headers={"Authorization": f"Bearer {token}"})
        body = rr.json()
        # Keys must exist (may be null when nothing set yet).
        assert "custom_background_url" in body
        assert "background_preset_id" in body
