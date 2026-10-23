"""Iter-64 — Growth Point rate rules & VIP maintenance recharge requirements.

Scenarios:
  * `/wallet/recharge`     → 1 Diamond = 1 Growth Point  (unchanged)
  * `/vip/convert`         → 1 Diamond = 2 Growth Points (NEW rate)
  * VIP1 maintenance       → ≥  50_000 Diamonds recharged in cycle
  * VIP2 maintenance       → ≥ 250_000 Diamonds recharged in cycle
  * VIP1 fail              → downgrade to level 0 (expired)
  * Growth Points persist across repeated progress fetches (idempotent).
"""
import asyncio
import os
import pytest
import httpx
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from pymongo import MongoClient

pytestmark = pytest.mark.asyncio

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")
_CLIENT = MongoClient(MONGO_URL)
DB = _CLIENT[DB_NAME]


@pytest.fixture
def base_url():
    return "http://localhost:8001"


async def _register(c: httpx.AsyncClient, base_url: str, name: str):
    """Register a fresh user and return (access_token, me-dict)."""
    import uuid
    suffix = uuid.uuid4().hex[:8]
    email = f"iter64_{suffix}@orio-tests.example.com"
    r = await c.post(
        f"{base_url}/api/auth/register",
        json={
            "email": email,
            "password": "Testing1234!",
            "username": f"i64_{suffix}",
            "nickname": name,
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    r2 = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 200
    return tok, r2.json()


async def test_recharge_awards_1x_growth_points(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter64_recharge")
        # Pick the cheapest package
        pkgs = (await c.get(f"{base_url}/api/wallet/packages", headers={"Authorization": f"Bearer {tok}"})).json()
        assert pkgs, pkgs
        pkg = pkgs[0]
        expected_coins = pkg["coins"] + (pkg["bonus"] or 0)
        start_gp = int(me.get("growth_points", 0))
        r = await c.post(
            f"{base_url}/api/wallet/recharge",
            headers={"Authorization": f"Bearer {tok}"},
            json={"package_id": pkg["id"]},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["added"] == expected_coins
        assert j["growth_points_awarded"] == expected_coins, "Recharge must be 1:1"
        assert j["growth_points"] == start_gp + expected_coins


async def test_exchange_awards_2x_growth_points(base_url):
    """Core Iter-64 requirement: Diamond EXCHANGE = 2× Growth Points."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter64_exchange")
        # Fund a bit of diamonds first via a recharge.
        pkgs = (await c.get(f"{base_url}/api/wallet/packages", headers={"Authorization": f"Bearer {tok}"})).json()
        await c.post(
            f"{base_url}/api/wallet/recharge",
            headers={"Authorization": f"Bearer {tok}"},
            json={"package_id": pkgs[0]["id"]},
        )
        # Snapshot GP before exchange
        me2 = (await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})).json()
        gp_before = int(me2["growth_points"])
        coins_before = int(me2["coins"])

        amount = 100
        r = await c.post(
            f"{base_url}/api/vip/convert",
            headers={"Authorization": f"Bearer {tok}"},
            json={"amount": amount},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        # Diamonds deducted by amount, GP credited by 2× amount.
        assert j["coins"] == coins_before - amount
        assert j["growth_points"] == gp_before + (amount * 2)
        assert j["growth_points_awarded"] == amount * 2


async def test_exchange_insufficient_balance(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter64_exbroke")
        r = await c.post(
            f"{base_url}/api/vip/convert",
            headers={"Authorization": f"Bearer {tok}"},
            json={"amount": 999_999_999},
        )
        assert r.status_code == 402


async def test_vip1_maintenance_requires_50k_recharge(base_url):
    """VIP1 whose cycle expired without ≥50k Diamonds recharged drops to 0."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter64_v1down")
        uid = ObjectId(me["id"])
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 1,
                "vip_expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
                "growth_points": 0,
            }},
        )
        DB.growth_ledger.delete_many({"user_id": str(uid), "source": "recharge"})
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["level"] == 0


async def test_vip1_renews_with_50k_recharged(base_url):
    """VIP1 auto-renews when the cycle contains ≥50k Diamonds recharged."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter64_v1ok")
        uid = ObjectId(me["id"])
        expired = datetime.now(timezone.utc) - timedelta(hours=1)
        cycle_start = expired - timedelta(days=30)
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 1,
                "vip_expires_at": expired,
                "growth_points": 0,
            }},
        )
        DB.growth_ledger.delete_many({"user_id": str(uid), "source": "recharge"})
        DB.growth_ledger.insert_one({
            "user_id": str(uid),
            "source": "recharge",
            "amount": 60_000,
            "created_at": cycle_start + timedelta(days=3),
            "tx_id": "test-vip1-ok",
        })
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["level"] == 1


async def test_vip2_downgrades_when_recharge_below_250k(base_url):
    """VIP2 drops to VIP1 when the cycle has <250k Diamonds recharged."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter64_v2down")
        uid = ObjectId(me["id"])
        expired = datetime.now(timezone.utc) - timedelta(hours=1)
        cycle_start = expired - timedelta(days=30)
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 2,
                "vip_expires_at": expired,
                "growth_points": 0,
            }},
        )
        DB.growth_ledger.delete_many({"user_id": str(uid), "source": "recharge"})
        DB.growth_ledger.insert_one({
            "user_id": str(uid),
            "source": "recharge",
            "amount": 100_000,  # less than 250k
            "created_at": cycle_start + timedelta(days=10),
            "tx_id": "test-vip2-insufficient",
        })
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["level"] == 1


async def test_vip_maintenance_endpoint_hides_vip1_vip2_requirements(base_url):
    """Public /vip/maintenance must NOT expose the hidden recharge
    requirements for VIP1 & VIP2 — only the Growth Point thresholds."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter64_hidden")
        r = await c.get(f"{base_url}/api/vip/maintenance", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        reqs = {row["level"]: row["threshold"] for row in r.json().get("requirements", [])}
        # VIP1/2 thresholds remain 0 in the public maintenance payload (hidden).
        assert reqs.get(1) == 0
        assert reqs.get(2) == 0
        # VIP3+ growth-point thresholds remain visible.
        assert reqs.get(3) == 500_000
        assert reqs.get(7) == 15_000_000


async def test_growth_points_persist_across_fetches(base_url):
    """Repeated /vip/progress calls MUST return the same growth_points — the
    maintenance evaluator is read-mostly / idempotent for active cycles."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter64_persist")
        pkgs = (await c.get(f"{base_url}/api/wallet/packages", headers={"Authorization": f"Bearer {tok}"})).json()
        await c.post(
            f"{base_url}/api/wallet/recharge",
            headers={"Authorization": f"Bearer {tok}"},
            json={"package_id": pkgs[0]["id"]},
        )
        a = (await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})).json()
        b = (await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})).json()
        c2 = (await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})).json()
        assert a["growth_points"] == b["growth_points"] == c2["growth_points"]
