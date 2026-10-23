"""
Iter-55 — VIP Maintenance + Global Supporter Ranking.

Backend contract tests:
  * /api/vip/progress returns the iter-55 maintenance fields.
  * /api/vip/maintenance exposes the per-level requirements map.
  * /api/rankings/global shape + metric/period filters.
  * Maintenance downgrade logic triggers exactly one-level drop when the
    30-day cycle has elapsed AND the user is below the required threshold.
  * Auto-renew (no downgrade) when growth_points meets the threshold OR
    when the current level has no maintenance requirement (VIP 1 / 2).
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import httpx
import pytest
import pymongo
from bson import ObjectId


MONGO = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
DB = MONGO[os.environ.get("DB_NAME", "voiceup")]


def _unique_email():
    return f"iter55_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter55"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it55_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200
    return tok, me.json()


@pytest.mark.asyncio
async def test_vip_progress_includes_maintenance(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter55_prog")
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        for key in (
            "level", "growth_points", "remaining_days",
            "maintenance_threshold", "maintenance_remaining",
            "maintenance_requirements",
        ):
            assert key in j, f"missing key {key} in {j.keys()}"
        reqs = j["maintenance_requirements"]
        # Exactly 7 entries, strict order 1..7, canonical values from spec.
        assert [r["level"] for r in reqs] == [1, 2, 3, 4, 5, 6, 7]
        canon = {1: 0, 2: 0, 3: 500_000, 4: 1_500_000, 5: 3_500_000, 6: 7_500_000, 7: 15_000_000}
        for r_ in reqs:
            assert r_["threshold"] == canon[r_["level"]], r_


@pytest.mark.asyncio
async def test_vip_maintenance_endpoint(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter55_maint_ep")
        r = await c.get(f"{base_url}/api/vip/maintenance", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "requirements" in j
        assert len(j["requirements"]) == 7


@pytest.mark.asyncio
async def test_downgrade_one_level_when_cycle_expired_and_below_threshold(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter55_dn")
        uid = ObjectId(me["id"])
        # Simulate: VIP 4, 1,500,000 is required, but user has only 100 GP, and
        # expiry was yesterday. The lazy /vip/progress call must demote by ONE
        # level (4 → 3). VIP 3 has its own 500,000 requirement which is also
        # unmet, so the next lazy pass (via another progress call) must demote
        # again to VIP 2 — but ONLY as cycles elapse. Since we only expired
        # once, the first call drops to VIP 3 and sets a FRESH 30-day cycle.
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 4,
                "vip_expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
                "growth_points": 100,
            }},
        )
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["level"] == 3, f"expected drop 4→3, got level={j['level']}"
        # Fresh cycle set.
        assert j["vip_expires_at"] is not None
        assert j["remaining_days"] >= 29


@pytest.mark.asyncio
async def test_auto_renew_when_threshold_met(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter55_renew")
        uid = ObjectId(me["id"])
        # VIP 3, requires 500k GP — user has 600k, expiry past → auto-renew.
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 3,
                "vip_expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
                "growth_points": 600_000,
            }},
        )
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["level"] == 3  # no downgrade
        assert j["remaining_days"] >= 29


@pytest.mark.asyncio
async def test_vip1_vip2_require_diamond_recharge_maintenance(base_url):
    """Iter-64 — VIP1 and VIP2 now have HIDDEN per-cycle Diamond-recharge
    requirements (50k and 250k respectively). A VIP2 whose cycle expired with
    zero recharges in-cycle must downgrade to VIP1."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter55_v2")
        uid = ObjectId(me["id"])
        DB.users.update_one(
            {"_id": uid},
            {"$set": {
                "vip_level": 2,
                "vip_expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
                "growth_points": 0,
            }},
        )
        # Purge any pre-existing recharge ledger rows for this user.
        DB.growth_ledger.delete_many({"user_id": str(uid), "source": "recharge"})
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["level"] == 1, f"VIP2 w/ zero recharge must downgrade to VIP1, got {j['level']}"


@pytest.mark.asyncio
async def test_vip2_auto_renews_when_recharge_requirement_met(base_url):
    """VIP2 keeps VIP2 when ≥250k diamonds were recharged in the cycle."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter55_v2b")
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
            "amount": 300_000,
            "created_at": cycle_start + timedelta(days=5),
            "tx_id": "test-vip2-maint-ok",
        })
        r = await c.get(f"{base_url}/api/vip/progress", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["level"] == 2, f"VIP2 with ≥250k recharged must auto-renew, got {j['level']}"


@pytest.mark.asyncio
async def test_vip1_expires_when_recharge_requirement_not_met(base_url):
    """VIP1 whose cycle expired with <50k recharged drops to VIP 0 (expired)."""
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter55_v1exp")
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
        j = r.json()
        assert j["level"] == 0, f"VIP1 w/ zero recharge must expire to 0, got {j['level']}"


@pytest.mark.asyncio
async def test_global_ranking_shape_and_filters(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, _ = await _register(c, base_url, "iter55_rank")
        # Validate contribution + all shape (no required data).
        r = await c.get(
            f"{base_url}/api/rankings/global?metric=contribution&period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["metric"] == "contribution"
        assert j["period"] == "all"
        assert isinstance(j["items"], list)
        # Charm metric also valid.
        r2 = await c.get(
            f"{base_url}/api/rankings/global?metric=charm&period=weekly",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r2.status_code == 200
        assert r2.json()["metric"] == "charm"
        assert r2.json()["period"] == "weekly"
        # Bad metric rejected.
        bad = await c.get(
            f"{base_url}/api/rankings/global?metric=badness&period=all",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert bad.status_code == 400


@pytest.mark.asyncio
async def test_global_ranking_requires_auth(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{base_url}/api/rankings/global?metric=contribution&period=all")
        assert r.status_code in (401, 403)
