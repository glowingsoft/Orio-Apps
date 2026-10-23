"""
Iter-49 — Discovery pills restoration + is_new wiring in search results.

Verifies that:
  * `GET /api/rooms/popular` still responds (PK/popular pill).
  * `GET /api/rooms/watched` still responds (Watched pill).
  * Search endpoint echoes `is_new` for freshly registered users.
  * `is_new` auto-flips to False for a user with an old `created_at`.
"""
import uuid
import pytest
import httpx


def _unique_email():
    return f"iter49_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter49"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it49_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = r.json().get("user") or {}
    # Complete the profile so search returns this user.
    await c.post(
        f"{base_url}/api/users/me/complete-profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"nickname": nickname, "age": 24, "gender": "male", "country_code": "US"},
    )
    return tok, me


@pytest.mark.asyncio
async def test_popular_rooms_endpoint_reachable(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        tok, _ = await _register(c, base_url)
        r = await c.get(
            f"{base_url}/api/rooms",
            params={"sort": "popular"},
            headers={"Authorization": f"Bearer {tok}"},
        )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_pk_rooms_endpoint_reachable(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        tok, _ = await _register(c, base_url)
        r = await c.get(
            f"{base_url}/api/rooms",
            params={"sort": "pk"},
            headers={"Authorization": f"Bearer {tok}"},
        )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_watched_rooms_endpoint_reachable(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        tok, _ = await _register(c, base_url)
        r = await c.get(
            f"{base_url}/api/rooms/watched",
            headers={"Authorization": f"Bearer {tok}"},
        )
    # Returns 200 with the viewer's watch history (empty list for new accounts
    # is acceptable).
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_search_results_carry_is_new(base_url):
    unique = f"iter49badge{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient(timeout=10) as c:
        # Register the target user (will be flagged is_new=True)
        tok_target, _ = await _register(c, base_url, nickname=unique)
        # Register a searcher (different account)
        tok_me, _ = await _register(c, base_url, nickname="iter49seeker")
        r = await c.get(
            f"{base_url}/api/users/search",
            params={"q": unique},
            headers={"Authorization": f"Bearer {tok_me}"},
        )
    assert r.status_code == 200, r.text
    items = r.json().get("items", [])
    assert any(it.get("nickname") == unique for it in items), items
    target_hit = next(it for it in items if it.get("nickname") == unique)
    assert target_hit.get("is_new") is True


@pytest.mark.asyncio
async def test_is_new_false_for_old_user(base_url):
    """Directly inject an 'old' user document and confirm is_new=False.
    We patch the DB behind the API so the created_at is 10 days ago."""
    import os
    import asyncio
    from datetime import datetime, timedelta, timezone
    from motor.motor_asyncio import AsyncIOMotorClient
    from bson import ObjectId

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = AsyncIOMotorClient(mongo_url)
    db = client["voiceup"]
    unique = f"iter49old{uuid.uuid4().hex[:6]}"
    old_ts = datetime.now(timezone.utc) - timedelta(days=10)
    ins = await db.users.insert_one({
        "email": _unique_email(),
        "username": unique.lower(),
        "nickname": unique,
        "avatar_url": "https://example.com/a.png",
        "numeric_id": uuid.uuid4().hex[:8],
        "vip_level": 0, "coins": 0, "diamonds": 0, "level": 1,
        "profile_completed": True,
        "created_at": old_ts,
    })
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            tok_me, _ = await _register(c, base_url, nickname="iter49seek2")
            r = await c.get(
                f"{base_url}/api/users/search",
                params={"q": unique},
                headers={"Authorization": f"Bearer {tok_me}"},
            )
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        target = next((it for it in items if it.get("nickname") == unique), None)
        assert target is not None, items
        assert target.get("is_new") is False
    finally:
        await db.users.delete_one({"_id": ins.inserted_id})
