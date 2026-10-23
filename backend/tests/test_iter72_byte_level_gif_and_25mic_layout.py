"""Iter-72 — Byte-level GIF rejection + 25-mic room layout patch.

Verifies the two surgical fixes:
  1. `_looks_like_gif` now rejects data URIs that LIE about their MIME type
     (e.g. `data:image/jpeg;base64,R0lGOD…`). The profile-avatar photo
     endpoint must refuse such files when `kind=photo`.
  2. `PATCH /rooms/{id}/layout` now accepts `num_seats=25` (previously only
     8/15/20 were allowed).
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

# Tiny real GIF (1×1 transparent). Base64 starts with the GIF magic prefix.
TINY_GIF_B64 = "R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs="
# Tiny real PNG (1×1).
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.fixture
def base_url():
    return "http://localhost:8001"


async def _register(c: httpx.AsyncClient, base_url: str, suffix: str = ""):
    s = (suffix or uuid.uuid4().hex[:8])
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter72_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i72_{s}",
            "nickname": f"i72 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


async def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_photo_endpoint_rejects_lying_mime_gif(base_url):
    """A GIF uploaded with a JPEG data-URI prefix must be rejected."""
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        headers = await _auth(token)
        # LIE: pretend it is a JPEG while the base64 is clearly a GIF.
        lying = f"data:image/jpeg;base64,{TINY_GIF_B64}"
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers=headers,
            json={"avatar_url": lying, "kind": "photo"},
        )
        assert r.status_code == 400, r.text
        assert "GIF" in r.text or "gif" in r.text


@pytest.mark.asyncio
async def test_photo_endpoint_accepts_real_png(base_url):
    """A legitimate PNG must still pass the photo endpoint.

    The moderation floor rejects data URIs whose base64 payload is < 2 kB
    (likely corrupted/placeholder bytes), so we build a sufficiently large
    PNG by stacking a valid 1×1 PNG's base64 up to ~3 kB. This still parses
    as PNG for the magic-byte check and clears the size floor.
    """
    import base64 as _b64
    png_bytes = _b64.b64decode(TINY_PNG_B64)
    big = png_bytes + b"\x00" * (3000 - len(png_bytes))
    png = f"data:image/png;base64,{_b64.b64encode(big).decode()}"
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        headers = await _auth(token)
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers=headers,
            json={"avatar_url": png, "kind": "photo"},
        )
        # 200 = allowed, 400/403 would mean false-positive rejection.
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_room_layout_patch_supports_25(base_url):
    """PATCH /rooms/{id}/layout must now accept num_seats=25."""
    async with httpx.AsyncClient(timeout=20) as c:
        token = await _register(c, base_url)
        headers = await _auth(token)
        # Create a room (owner can later change layout).
        r = await c.post(
            f"{base_url}/api/rooms",
            headers=headers,
            json={
                "name": f"iter72 room {uuid.uuid4().hex[:6]}",
                "description": "iter72 layout patch",
                "category": "chat",
                "num_seats": 8,
                "is_private": False,
            },
        )
        assert r.status_code in (200, 201), r.text
        room = r.json()
        room_id = room["id"]

        # Change layout to 25 — previously rejected with 400.
        r2 = await c.patch(
            f"{base_url}/api/rooms/{room_id}/layout",
            headers=headers,
            json={"num_seats": 25},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["num_seats"] == 25
        # Seat array now has 25 numbered mic seats + 1 host chair = 26.
        assert len(r2.json()["seats"]) == 26
