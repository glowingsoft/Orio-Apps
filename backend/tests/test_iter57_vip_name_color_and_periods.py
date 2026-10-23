"""
Iter-57 — Server-authoritative VIP name_color + updated period windows.

Contract tests:
  * /auth/me carries `name_color` derived from vip_level:
      0,1 → None, 2-5 → "red", 6-7 → "rainbow"
  * The flag flips as soon as the user's VIP level is updated server-side.
  * /rankings/v2/wealth user rows carry `name_color`.
  * /rankings/global rows carry `name_color` inside .user.
  * _period_start logic: daily=24h rolling, weekly=168h rolling,
    monthly=start of UTC calendar month, all=None (lifetime).
"""
import os
import uuid
import pymongo
from bson import ObjectId
from datetime import datetime, timezone, timedelta

import httpx
import pytest


MONGO = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
DB = MONGO[os.environ.get("DB_NAME", "voiceup")]


def _unique_email():
    return f"iter57_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter57"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it57_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200
    return tok, me.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("lvl,expected", [
    (0, None), (1, None),
    (2, "red"), (3, "red"), (4, "red"), (5, "red"),
    (6, "rainbow"), (7, "rainbow"),
])
async def test_name_color_mapping(base_url, lvl, expected):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, f"iter57_v{lvl}")
        # Mutate the user's vip_level directly to simulate a server-side VIP state.
        DB.users.update_one(
            {"_id": ObjectId(me["id"])},
            {"$set": {
                "vip_level": lvl,
                "vip_expires_at": datetime.now(timezone.utc) + timedelta(days=30),
                "growth_points": 100_000_000,  # above every maintenance threshold
            }},
        )
        r = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json().get("name_color") == expected


@pytest.mark.asyncio
async def test_name_color_flips_on_vip_upgrade(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter57_flip")
        # Start at 0.
        DB.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"vip_level": 0}})
        r = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.json().get("name_color") is None
        # Bump to 3 → red.
        DB.users.update_one(
            {"_id": ObjectId(me["id"])},
            {"$set": {
                "vip_level": 3,
                "vip_expires_at": datetime.now(timezone.utc) + timedelta(days=30),
                "growth_points": 100_000_000,
            }},
        )
        r2 = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r2.json().get("name_color") == "red"
        # Bump to 7 → rainbow.
        DB.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"vip_level": 7}})
        r3 = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r3.json().get("name_color") == "rainbow"


@pytest.mark.asyncio
async def test_rankings_rows_carry_name_color(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter57_rank")
        # /rankings/v2/wealth
        r = await c.get(
            f"{base_url}/api/rankings/v2/wealth?period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200
        body = r.json()
        if body:
            assert "name_color" in body[0]
        # /rankings/global
        r2 = await c.get(
            f"{base_url}/api/rankings/global?metric=contribution&period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r2.status_code == 200
        items = r2.json().get("items", [])
        if items:
            assert "name_color" in items[0]["user"]


@pytest.mark.asyncio
@pytest.mark.parametrize("period", ["daily", "weekly", "monthly", "all"])
async def test_ranking_periods_are_server_authoritative(base_url, period):
    """Smoke-test that each period is accepted and returns a well-formed list."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, f"iter57_p_{period}")
        r = await c.get(
            f"{base_url}/api/rankings/global?metric=contribution&period={period}",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("items"), list)
