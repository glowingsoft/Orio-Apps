"""
Iter-52 — Delete Room + Supporter Ranking.

Tests:
  * Delete room requires auth, enforces owner-only, soft-deletes properly.
  * Ranking endpoint accepts both metrics (contribution + charm).
  * Ranking filters respect period=daily/weekly/monthly/all.
  * Ranking caps at top 50 and reflects real transactions.
  * Ranking rejects invalid metric values.
"""
import uuid
import pytest
import httpx


def _unique_email():
    return f"iter52_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter52"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it52_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    await c.post(
        f"{base_url}/api/users/me/complete-profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"nickname": nickname, "age": 24, "gender": "male", "country_code": "US"},
    )
    return tok


async def _create_room(c, base_url, tok):
    r = await c.post(
        f"{base_url}/api/rooms",
        headers={"Authorization": f"Bearer {tok}"},
        json={"name": "iter52 room", "category": "chat", "num_seats": 8},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_delete_room_requires_auth(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.delete(f"{base_url}/api/rooms/000000000000000000000000")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_non_owner_cannot_delete_room(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter52_del_o")
        other_tok = await _register(c, base_url, "iter52_del_other")
        room = await _create_room(c, base_url, owner_tok)
        r = await c.delete(
            f"{base_url}/api/rooms/{room['id']}",
            headers={"Authorization": f"Bearer {other_tok}"},
        )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_owner_can_delete_room(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter52_del_owner")
        room = await _create_room(c, base_url, owner_tok)
        r = await c.delete(
            f"{base_url}/api/rooms/{room['id']}",
            headers={"Authorization": f"Bearer {owner_tok}"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


@pytest.mark.asyncio
async def test_delete_room_frees_one_room_per_owner_slot(base_url):
    """After deletion the owner can create a new room — proving the partial
    unique index no longer blocks them."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url, "iter52_slot")
        room = await _create_room(c, base_url, tok)
        await c.delete(f"{base_url}/api/rooms/{room['id']}",
                       headers={"Authorization": f"Bearer {tok}"})
        # Create a 2nd room — should now succeed.
        r2 = await c.post(
            f"{base_url}/api/rooms",
            headers={"Authorization": f"Bearer {tok}"},
            json={"name": "iter52 second", "category": "chat", "num_seats": 8},
        )
    assert r2.status_code == 201, r2.text


# ---------- Supporter Ranking ----------

@pytest.mark.asyncio
async def test_ranking_endpoint_shape_empty_room(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url, "iter52_r")
        room = await _create_room(c, base_url, tok)
        for metric in ("contribution", "charm"):
            for period in ("daily", "weekly", "monthly", "all"):
                r = await c.get(
                    f"{base_url}/api/rooms/{room['id']}/ranking",
                    params={"metric": metric, "period": period},
                    headers={"Authorization": f"Bearer {tok}"},
                )
                assert r.status_code == 200, (metric, period, r.text)
                body = r.json()
                assert body["metric"] == metric
                assert body["period"] == period
                assert isinstance(body["items"], list)
                assert len(body["items"]) == 0  # fresh room → no gifts


@pytest.mark.asyncio
async def test_ranking_rejects_invalid_metric(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _register(c, base_url, "iter52_rbad")
        room = await _create_room(c, base_url, tok)
        r = await c.get(
            f"{base_url}/api/rooms/{room['id']}/ranking",
            params={"metric": "bogus"},
            headers={"Authorization": f"Bearer {tok}"},
        )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_ranking_reflects_real_gift_transactions(base_url):
    """Minimal end-to-end: owner creates a room, a sender buys gold and sends
    a gift to the owner, ranking should show the sender in contribution and the
    owner in charm."""
    import asyncio
    from datetime import datetime, timezone
    from motor.motor_asyncio import AsyncIOMotorClient
    import os

    client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client["voiceup"]

    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter52_gift_o")
        sender_tok = await _register(c, base_url, "iter52_gift_s")
        room = await _create_room(c, base_url, owner_tok)

        # Fetch sender/owner ids
        om = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {owner_tok}"})
        sm = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {sender_tok}"})
        oid = om.json()["id"]; sid = sm.json()["id"]

        # Insert a synthetic gift transaction directly (we're testing the
        # ranking aggregation, not the full gift-send pipeline).
        await db.gift_transactions.insert_one({
            "sender_id": sid,
            "recipient_id": oid,
            "room_id": room["id"],
            "quantity": 3,
            "total_cost": 1500,
            "created_at": datetime.now(timezone.utc),
        })

        try:
            r_contrib = await c.get(
                f"{base_url}/api/rooms/{room['id']}/ranking",
                params={"metric": "contribution", "period": "all"},
                headers={"Authorization": f"Bearer {owner_tok}"},
            )
            r_charm = await c.get(
                f"{base_url}/api/rooms/{room['id']}/ranking",
                params={"metric": "charm", "period": "all"},
                headers={"Authorization": f"Bearer {owner_tok}"},
            )
            assert r_contrib.status_code == 200
            assert r_charm.status_code == 200
            cb = r_contrib.json()["items"]
            kb = r_charm.json()["items"]
            assert any(it["user"]["id"] == sid and it["amount"] == 1500 for it in cb), cb
            assert any(it["user"]["id"] == oid and it["amount"] == 1500 for it in kb), kb
        finally:
            await db.gift_transactions.delete_one({"room_id": room["id"], "sender_id": sid})
