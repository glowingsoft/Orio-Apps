"""
Iter-56 — Rankings categories (Custom Gifts / Rooms / Family) + VIP maintenance.

Smoke tests the new /rankings/v2/{category} categories added in iter-56:
  * custom_gifts, rooms, family all return list[dict] with the normalized
    row shape {id, nickname, avatar_url?, score, kind, ...}.
  * Auth is required.
  * Legacy categories (wealth/charm/cp/friendship/gifts) still work.
"""
import os
import uuid
import httpx
import pytest


def _unique_email():
    return f"iter56_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter56"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it56_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    return tok


@pytest.mark.asyncio
@pytest.mark.parametrize("cat", ["custom_gifts", "rooms", "family"])
async def test_new_categories_shape(base_url, cat):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url, f"iter56_{cat}")
        r = await c.get(
            f"{base_url}/api/rankings/v2/{cat}?period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        if body:
            row = body[0]
            # Each row must carry an id, a display name, a score, and a kind
            # ("user" for custom_gifts | "room" for rooms | "family" for family).
            assert "id" in row
            assert "nickname" in row
            assert "score" in row
            assert "kind" in row
            if cat == "rooms":
                assert row["kind"] == "room"
            elif cat == "family":
                assert row["kind"] == "family"
            else:
                assert row["kind"] == "user"


@pytest.mark.asyncio
async def test_rankings_v2_requires_auth(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{base_url}/api/rankings/v2/rooms?period=all")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.parametrize("cat", ["wealth", "charm", "cp", "friendship", "gifts"])
async def test_legacy_categories_still_work(base_url, cat):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url, f"iter56_leg_{cat}")
        r = await c.get(
            f"{base_url}/api/rankings/v2/{cat}?period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_bad_category_rejected(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        tok = await _register(c, base_url, "iter56_bad")
        r = await c.get(
            f"{base_url}/api/rankings/v2/garbage?period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
    assert r.status_code in (400, 422)
