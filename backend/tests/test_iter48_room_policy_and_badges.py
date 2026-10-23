"""
Iter-48 — ORIO master surgical fix round.

Covers:
  * Section 8 — Room categories are strictly {cp, games, chat, music}; legacy
    categories are normalized in `public_room`.
  * Section 10 — ONE ROOM PER USER:
      - Pre-check returns 409 on second create
      - Partial unique Mongo index exists (defense in depth)
      - Concurrent duplicate attempts fail cleanly
  * Section 9 — Seat count is enforced to {8, 15, 20} and actually determines
    the stored seat array length.
  * Section 26 — `is_new` auto-badge is derived from `created_at`.
"""
import asyncio
import os
import time
import uuid
import pytest
import httpx


def _unique_email() -> str:
    return f"iter48_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(client: httpx.AsyncClient, base_url: str):
    email = _unique_email()
    pw = "Testing1234!"
    r = await client.post(
        f"{base_url}/api/auth/register",
        json={
            "email": email,
            "password": pw,
            "username": f"it48_{uuid.uuid4().hex[:8]}",
            "nickname": "Iter48 User",
        },
    )
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    # Complete profile so create-room passes any gates that need it.
    await client.post(
        f"{base_url}/api/users/me/complete-profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"nickname": "Iter48 User", "age": 25, "gender": "male", "country_code": "US"},
    )
    return tok


@pytest.mark.asyncio
async def test_create_room_normalizes_category(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url)
        h = {"Authorization": f"Bearer {tok}"}
        # 'dj' is a legacy alias → must come back as 'music'
        r = await c.post(
            f"{base_url}/api/rooms",
            headers=h,
            json={"name": "music room", "category": "dj", "num_seats": 8},
        )
        assert r.status_code == 201, r.text
        assert r.json()["category"] == "music"


@pytest.mark.asyncio
async def test_create_room_rejects_invalid_seat_count(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url)
        h = {"Authorization": f"Bearer {tok}"}
        for bad in (3, 7, 9, 12, 19, 21):
            r = await c.post(
                f"{base_url}/api/rooms",
                headers=h,
                json={"name": "x", "category": "chat", "num_seats": bad},
            )
            assert r.status_code in (400, 422), f"seat {bad} must be rejected, got {r.status_code}"


@pytest.mark.asyncio
async def test_create_room_seat_count_actually_persists(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        for n in (8, 15, 20):
            tok = await _register(c, base_url)
            h = {"Authorization": f"Bearer {tok}"}
            r = await c.post(
                f"{base_url}/api/rooms",
                headers=h,
                json={"name": f"r{n}", "category": "chat", "num_seats": n},
            )
            assert r.status_code == 201, r.text
            body = r.json()
            assert body["num_seats"] == n
            # Total slots = n + 1 (host chair at index 0 + n numbered seats)
            assert len(body["seats"]) == n + 1


@pytest.mark.asyncio
async def test_one_room_per_user_pre_check(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url)
        h = {"Authorization": f"Bearer {tok}"}
        r1 = await c.post(f"{base_url}/api/rooms", headers=h,
                          json={"name": "first", "category": "chat", "num_seats": 8})
        assert r1.status_code == 201
        # 2nd create must fail at the API layer with 409
        r2 = await c.post(f"{base_url}/api/rooms", headers=h,
                          json={"name": "second", "category": "chat", "num_seats": 8})
        assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_one_room_per_user_concurrent_requests(base_url):
    # Fire two creates in parallel; exactly one must succeed.
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url)
        h = {"Authorization": f"Bearer {tok}"}
        body = {"name": "race", "category": "chat", "num_seats": 8}
        r1, r2 = await asyncio.gather(
            c.post(f"{base_url}/api/rooms", headers=h, json=body),
            c.post(f"{base_url}/api/rooms", headers=h, json=body),
        )
        statuses = sorted([r1.status_code, r2.status_code])
        assert statuses == [201, 409], f"Expected [201,409], got {statuses}: {r1.text} / {r2.text}"


@pytest.mark.asyncio
async def test_is_new_badge_true_on_freshly_registered_user(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url)
        h = {"Authorization": f"Bearer {tok}"}
        me = await c.get(f"{base_url}/api/auth/me", headers=h)
        assert me.status_code == 200, me.text
        assert me.json()["is_new"] is True


@pytest.mark.asyncio
async def test_auth_providers_still_healthy(base_url):
    """Make sure Phase 6 Phone/Facebook plumbing survived the Iter-48 edits."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{base_url}/api/auth/providers")
    assert r.status_code == 200
    assert set(r.json().keys()) == {"google", "email", "phone", "facebook"}
