"""Iter-74/82 — Custom room background submission + pre-moderation guard.

Updated for Iter-82 (15-day pass model). The per-submission 50k diamond
deduction was replaced by a single 15-day pass purchased separately via
`/rooms/custom-background/purchase-15d`. These tests verify the
submission-time behavior with that new model.

Covers:
  1. 15-day pass purchase deducts exactly 50 000 Diamonds and unlocks
     unlimited submissions during the window.
  2. Inappropriate / tiny / corrupted images are rejected IMMEDIATELY at
     submit time (no persist, no state change) — the pass is not consumed.
  3. Pending submissions do NOT set `background_url` on the room.
  4. Admin approval sets `background_url` + `custom_background_url` on the
     room; `cover_url` (Room Avatar) is NOT touched.
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
    email = f"iter74_{s}@orio-tests.example.com"
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Testing1234!", "username": f"i74_{s}", "nickname": f"i74 {s}"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"], email


async def _create_room(c, base_url, token):
    rr = await c.post(
        f"{base_url}/api/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": f"i74 {uuid.uuid4().hex[:6]}", "description": "d", "category": "chat", "num_seats": 8, "is_private": False},
    )
    assert rr.status_code in (200, 201), rr.text
    return rr.json()["id"]


def _grant_diamonds(email: str, amount: int = 100_000):
    DB.users.update_one({"email": email}, {"$set": {"diamonds": amount}})


def _grant_pass(c, base_url, token):
    """Buy a 15-day pass (assumes diamonds already granted)."""
    return c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers={"Authorization": f"Bearer {token}"})


@pytest.mark.asyncio
async def test_pass_costs_50k_and_unlocks_submissions(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        _grant_diamonds(email, 100_000)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        p = await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        assert p.status_code == 200, p.text
        u = DB.users.find_one({"email": email})
        assert u["diamonds"] == 50_000, f"expected 50000 left, got {u['diamonds']}"
        # Now submission is allowed → 201.
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_insufficient_diamonds_blocks_pass_purchase(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        _grant_diamonds(email, 100)
        r = await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 402, r.text
        u = DB.users.find_one({"email": email})
        assert u["diamonds"] == 100


@pytest.mark.asyncio
async def test_inappropriate_image_rejected_without_consuming_pass(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        _grant_diamonds(email, 100_000)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        tiny = "data:image/png;base64,iVBORw0KGgoAAAA"
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": tiny},
        )
        assert r.status_code == 400, r.text
        subs = list(DB.room_backgrounds.find({"room_id": rid}))
        assert len(subs) == 0
        # Pass is still active.
        e = await c.get(f"{base_url}/api/rooms/custom-background/entitlement", headers=h)
        assert e.json()["pass_active"] is True


@pytest.mark.asyncio
async def test_pending_submission_does_not_set_background(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        _grant_diamonds(email, 100_000)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        orig_bg = (await c.get(f"{base_url}/api/rooms/{rid}", headers=h)).json()["background_url"]
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r.status_code == 201, r.text
        # Background is still the ORIO Welcome default.
        rr = await c.get(f"{base_url}/api/rooms/{rid}", headers=h)
        assert rr.json()["background_url"] == orig_bg


@pytest.mark.asyncio
async def test_admin_approval_sets_background_url_not_cover(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        token, email = await _register(c, base_url)
        _grant_diamonds(email, 100_000)
        rid = await _create_room(c, base_url, token)
        h = {"Authorization": f"Bearer {token}"}
        await c.post(f"{base_url}/api/rooms/custom-background/purchase-15d", headers=h)
        r = await c.post(
            f"{base_url}/api/rooms/{rid}/background",
            headers=h,
            json={"image_url": _big_png_data_uri()},
        )
        assert r.status_code == 201, r.text
        sub_id = r.json()["sub_id"]
        orig_cover = (await c.get(f"{base_url}/api/rooms/{rid}", headers=h)).json()["cover_url"]
        DB.users.update_one({"email": email}, {"$set": {"is_admin": True}})
        a = await c.post(
            f"{base_url}/api/admin/room-backgrounds/{sub_id}/decision",
            headers=h,
            json={"decision": "approve"},
        )
        assert a.status_code == 200, a.text
        room = DB.rooms.find_one({"_id": ObjectId(rid)})
        assert room.get("background_url") == _big_png_data_uri()
        assert room.get("cover_url") == orig_cover, "cover_url must not change"
