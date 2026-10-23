"""Iter-71 — GIF limit enforcement + 25-mic rooms + comprehensive countries."""
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


@pytest.fixture
def base_url():
    return "http://localhost:8001"


async def _register(c: httpx.AsyncClient, base_url: str):
    s = uuid.uuid4().hex[:8]
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": f"iter71_{s}@orio-tests.example.com",
            "password": "Testing1234!",
            "username": f"i71_{s}",
            "nickname": f"i71 {s}",
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    me = (await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})).json()
    return tok, me


# ---------- GIF limits ----------
TINY_GIF_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
TINY_GIF = f"data:image/gif;base64,{TINY_GIF_B64}"


async def test_valid_tiny_gif_accepted(base_url):
    """A perfectly valid 1x1 GIF (under all limits) is accepted."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        from bson import ObjectId
        DB.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"vip_level": 5}})
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": TINY_GIF, "kind": "gif"},
        )
        assert r.status_code == 200, r.text


async def test_oversized_gif_rejected_with_clear_message(base_url):
    """A GIF > 5 MB is rejected with 400 and a helpful message. 3-day
    block NOT triggered (it's not inappropriate content)."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url)
        from bson import ObjectId
        DB.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"vip_level": 5}})
        import base64
        # ~6 MB payload — large enough to breach the 5 MB cap in the server.
        big_payload = b"A" * (6 * 1024 * 1024)
        big_gif = "data:image/gif;base64," + base64.b64encode(big_payload).decode()
        r = await c.post(
            f"{base_url}/api/me/profile-avatar/moderate",
            headers={"Authorization": f"Bearer {tok}"},
            json={"avatar_url": big_gif, "kind": "gif"},
        )
        assert r.status_code == 400, r.text
        assert "too large" in r.text.lower()
        # Not blocked for 3 days
        s = await c.get(f"{base_url}/api/me/media-block", headers={"Authorization": f"Bearer {tok}"})
        assert s.json()["blocked"] is False


# ---------- 25-mic rooms ----------

async def test_room_can_be_created_with_25_seats(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/rooms",
            headers={"Authorization": f"Bearer {tok}"},
            json={"name": "Iter71 Mega", "category": "chat", "num_seats": 25},
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["num_seats"] == 25


async def test_invalid_seat_count_rejected(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/rooms",
            headers={"Authorization": f"Bearer {tok}"},
            json={"name": "Iter71 Bad", "category": "chat", "num_seats": 30},
        )
        assert r.status_code in (400, 422)


# ---------- Countries ----------

async def test_countries_endpoint_has_full_world_and_unknown(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{base_url}/api/countries")
        assert r.status_code == 200
        rows = r.json()
        codes = {c["code"] for c in rows}
        # Core sanity checks
        assert "XX" in codes, "Unknown 🌎 must be present"
        unknown = next(c for c in rows if c["code"] == "XX")
        assert unknown["flag"] == "🌎"
        # Must include a broad set of countries from every continent.
        for code in ["US", "GB", "FR", "DE", "JP", "BR", "ZA", "AU", "IN", "CN", "RU", "EG", "SA", "NG", "KE", "AR", "MX", "CA"]:
            assert code in codes, f"{code} missing from world list"
        # Reasonable size (> 150 countries)
        assert len(rows) > 150, f"Only {len(rows)} countries; expected the whole world"


# ---------- Age range ----------

async def test_profile_completion_rejects_under_18(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url)
        r = await c.post(
            f"{base_url}/api/me/profile/complete",
            headers={"Authorization": f"Bearer {tok}"},
            json={"nickname": "iter71", "age": 17, "country_code": "EG"},
        )
        assert r.status_code in (400, 422)
