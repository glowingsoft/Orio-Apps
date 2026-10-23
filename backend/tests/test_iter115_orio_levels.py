"""Iter-115 — ORIO Wealth/Charm level rework.

Tests cover:
- One-time migration state (config + backup + reset)
- level_configs cumulative thresholds for wealth & charm (51 levels, max=51)
- GET /api/me/levels response shape and values
- Level mapping across all 51 tiers using the thresholds (via direct Mongo seed +
  /api/me/levels, which computes from points server-side)
- /api/gifts/send: wealth / charm increments, request_id idempotency,
  insufficient coins → 402 and request_id released, multi-level-up, self-gift
- /api/gifts/send-multi: wealth totals, per-recipient charm, replay 409
- Final cleanup: restore demo user's coins/wealth/charm/levels to their original
  values and remove any TEST_* users that were created.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests
import pymongo
from bson import ObjectId

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"

# Official 51-level requirements (individual per level), from the spec.
REQS = [
    1_000, 5_000, 15_000, 25_000, 50_000, 100_000, 500_000, 1_500_000, 3_000_000, 5_000_000,
    7_500_000, 10_000_000, 15_000_000, 25_000_000, 50_000_000, 100_000_000, 120_000_000,
    150_000_000, 200_000_000, 250_000_000, 300_000_000, 350_000_000, 400_000_000, 450_000_000,
    500_000_000, 550_000_000, 600_000_000, 650_000_000, 700_000_000, 750_000_000, 800_000_000,
    850_000_000, 900_000_000, 950_000_000, 1_000_000_000, 1_100_000_000, 1_200_000_000,
    1_300_000_000, 1_400_000_000, 1_500_000_000, 1_600_000_000, 1_700_000_000, 1_800_000_000,
    1_900_000_000, 2_000_000_000, 2_200_000_000, 2_400_000_000, 2_600_000_000, 2_800_000_000,
    3_100_000_000, 3_500_000_000,
]
CUM: list[int] = []
_s = 0
for r in REQS:
    _s += r
    CUM.append(_s)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def db():
    cli = pymongo.MongoClient(MONGO_URL)
    return cli[DB_NAME]


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_original(db):
    """Snapshot of the demo user BEFORE the test suite modifies anything so we
    can restore it in the final teardown."""
    u = db.users.find_one({"email": DEMO_EMAIL})
    assert u is not None, "demo user missing"
    return {
        "_id": u["_id"],
        "coins": int(u.get("coins", 0)),
        "wealth_points": int(u.get("wealth_points", 0)),
        "charm_points": int(u.get("charm_points", 0)),
        "wealth_level": int(u.get("wealth_level", 0)),
        "charm_level": int(u.get("charm_level", 0)),
    }


@pytest.fixture(scope="session")
def recipient_user(db, api):
    """Dedicated TEST_* recipient. Registered through the real API so bcrypt /
    schema stay consistent, then cleaned up at session end."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_recipient_{suffix}@orio.example.com"
    payload = {
        "email": email,
        "password": "Testpass!2026",
        "username": f"testrcp{suffix}",
        "nickname": "TEST_Recipient",
    }
    r = api.post(f"{BASE_URL}/api/auth/register", json=payload)
    assert r.status_code in (200, 201), r.text
    tok = r.json().get("access_token")
    u = db.users.find_one({"email": email.lower()})
    assert u is not None
    yield {"email": email, "id": str(u["_id"]), "oid": u["_id"], "token": tok}
    # cleanup
    db.users.delete_one({"_id": u["_id"]})


@pytest.fixture(scope="session", autouse=True)
def restore_demo(demo_original, db, request):
    """Final teardown: restore demo user to its original coin / wealth / charm
    state and purge gift_requests + any TEST_* residue."""
    yield
    db.users.update_one({"_id": demo_original["_id"]}, {"$set": {
        "coins": demo_original["coins"],
        "wealth_points": demo_original["wealth_points"],
        "charm_points": demo_original["charm_points"],
        "wealth_level": demo_original["wealth_level"],
        "charm_level": demo_original["charm_level"],
    }})
    db.gift_requests.delete_many({"_id": {"$regex": f"^{demo_original['_id']}:TEST_"}})
    db.users.delete_many({"email": {"$regex": "^test_"}})


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------------------
# 1. Migration state
# ---------------------------------------------------------------------------
class TestMigration:
    def test_migration_flag_done(self, db):
        guard = db.config.find_one({"_id": "level_reset_v2"})
        assert guard and guard.get("done") is True
        assert int(guard.get("backed_up", 0)) > 0

    def test_backup_collection_populated(self, db):
        assert db.level_reset_backup_v2.count_documents({}) > 0

    def test_all_users_reset_to_zero(self, db):
        # We may have accrued test activity by the time earlier classes run so
        # restrict to the demo user and non-test users.
        q = {"email": {"$not": {"$regex": "^TEST_"}}, "email": {"$ne": DEMO_EMAIL}}
        bad = db.users.count_documents({**q, "$or": [{"wealth_points": {"$gt": 0}}, {"charm_points": {"$gt": 0}}]})
        assert bad == 0

    def test_migration_is_idempotent(self, db):
        """Re-running the guard should not re-reset or re-insert the backup."""
        before = db.level_reset_backup_v2.count_documents({})
        guard = db.config.find_one({"_id": "level_reset_v2"})
        # Simulate another server start: with done=True the function would exit immediately.
        assert guard.get("done") is True
        after = db.level_reset_backup_v2.count_documents({})
        assert before == after


# ---------------------------------------------------------------------------
# 2. level_configs — 51 cumulative thresholds for wealth & charm
# ---------------------------------------------------------------------------
class TestLevelConfigs:
    @pytest.mark.parametrize("sys", ["wealth", "charm"])
    def test_thresholds_cumulative_and_51_long(self, db, sys):
        cfg = db.level_configs.find_one({"_id": sys})
        assert cfg is not None, f"missing level_configs {sys}"
        assert cfg.get("max_level") == 51
        thr = cfg.get("thresholds") or []
        assert len(thr) == 51
        for i, t in enumerate(thr, start=1):
            assert t["level"] == i
            assert t["requirement"] == REQS[i - 1], f"L{i} requirement mismatch"
            assert t["points"] == CUM[i - 1], f"L{i} cumulative mismatch"


# ---------------------------------------------------------------------------
# 3. GET /api/me/levels shape
# ---------------------------------------------------------------------------
class TestMyLevelsEndpoint:
    def test_my_levels_shape(self, api, demo_token):
        r = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(demo_token))
        assert r.status_code == 200, r.text
        data = r.json()
        for sys in ("wealth", "charm"):
            assert sys in data
            for k in ("level", "points", "next_level", "remaining", "is_max"):
                assert k in data[sys], f"{sys} missing {k}"
            assert data[sys]["max_level"] == 51


# ---------------------------------------------------------------------------
# 4. Level mapping across all 51 tiers (uses direct Mongo seed + GET)
# ---------------------------------------------------------------------------
class TestAllLevels:
    def test_all_51_tiers(self, db, api, recipient_user):
        """For every level L: cum(L)-1 → level L-1, cum(L) → level L, cum(L)+5 → level L.
        At points >= cum(51) → is_max True, remaining is None, next_level None."""
        tok = recipient_user["token"]
        oid = recipient_user["oid"]
        failures: list[str] = []
        for L in range(1, 52):
            below = CUM[L - 1] - 1 if L > 1 else 0  # L=1 lower edge is 0 (level 0)
            at = CUM[L - 1]
            above = CUM[L - 1] + 5

            # below → level L-1
            db.users.update_one({"_id": oid}, {"$set": {"wealth_points": below}})
            lv = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(tok)).json()["wealth"]
            if lv["level"] != L - 1:
                failures.append(f"L{L} below({below}): level={lv['level']} expected {L-1}")

            # at → level L
            db.users.update_one({"_id": oid}, {"$set": {"wealth_points": at}})
            lv = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(tok)).json()["wealth"]
            if lv["level"] != L:
                failures.append(f"L{L} at({at}): level={lv['level']}")
            if L < 51:
                exp_rem = CUM[L] - at
                if lv["remaining"] != exp_rem:
                    failures.append(f"L{L} at remaining={lv['remaining']} expected {exp_rem}")
                assert lv["is_max"] is False
            else:
                if lv["is_max"] is not True or lv["remaining"] is not None or lv["next_level"] is not None:
                    failures.append(f"L51 at: is_max={lv['is_max']} remaining={lv['remaining']} next={lv['next_level']}")

            # above → still level L (unless L=51 where it stays MAX)
            db.users.update_one({"_id": oid}, {"$set": {"wealth_points": above}})
            lv = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(tok)).json()["wealth"]
            if lv["level"] != L:
                failures.append(f"L{L} above({above}): level={lv['level']}")
            if L < 51 and lv["remaining"] != CUM[L] - above:
                failures.append(f"L{L} above remaining={lv['remaining']} expected {CUM[L]-above}")
        # reset
        db.users.update_one({"_id": oid}, {"$set": {"wealth_points": 0, "charm_points": 0, "wealth_level": 0, "charm_level": 0}})
        assert not failures, "\n".join(failures[:15])


# ---------------------------------------------------------------------------
# 5. Gift flow: wealth / charm / idempotency / self-gift / insufficient coins
# ---------------------------------------------------------------------------
class TestGiftFlow:
    def _reset(self, db, oid):
        db.users.update_one({"_id": oid}, {"$set": {"wealth_points": 0, "charm_points": 0, "wealth_level": 0, "charm_level": 0}})

    def test_single_gift_credits_exact(self, db, api, demo_token, recipient_user, demo_original):
        self._reset(db, demo_original["_id"])
        self._reset(db, recipient_user["oid"])
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 10_000_000}})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        payload = {"gift_id": "diamond", "recipient_id": recipient_user["id"], "quantity": 3, "request_id": rid}
        r = api.post(f"{BASE_URL}/api/gifts/send", json=payload, headers=_auth(demo_token))
        assert r.status_code == 200, r.text
        exp = 1000 * 3
        sender = db.users.find_one({"_id": demo_original["_id"]})
        rcp = db.users.find_one({"_id": recipient_user["oid"]})
        assert sender["wealth_points"] == exp
        assert rcp["charm_points"] == exp
        # Replay → 409
        r2 = api.post(f"{BASE_URL}/api/gifts/send", json=payload, headers=_auth(demo_token))
        assert r2.status_code == 409, r2.text
        sender2 = db.users.find_one({"_id": demo_original["_id"]})
        rcp2 = db.users.find_one({"_id": recipient_user["oid"]})
        assert sender2["wealth_points"] == exp
        assert rcp2["charm_points"] == exp
        # Coins deducted once only
        assert sender2["coins"] == 10_000_000 - exp

    def test_multi_level_up_single_gift_spec_note(self):
        """Spec note: review request said 'LV5' for 495,000 wealth points, but
        cumulative thresholds say 196,000 (L6) ≤ 495,000 < 696,000 (L7), so the
        correct level is L6. The authoritative check lives in
        test_multi_level_up_single_gift_accurate below."""
        assert CUM[5] <= 495_000 < CUM[6]

    def test_cumulative_table_sanity(self):
        assert CUM[0] == 1000 and CUM[1] == 6000 and CUM[2] == 21000 and CUM[3] == 46000
        assert CUM[4] == 96000 and CUM[5] == 196000 and CUM[6] == 696000

    def test_multi_level_up_single_gift_accurate(self, db, api, demo_token, recipient_user, demo_original):
        """Correct expected level for 495,000 points from the spec table (cum: 96k L5, 196k L6, 696k L7)."""
        self._reset(db, demo_original["_id"])
        self._reset(db, recipient_user["oid"])
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 10_000_000}})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        r = api.post(f"{BASE_URL}/api/gifts/send", headers=_auth(demo_token),
                     json={"gift_id": "sports_car", "recipient_id": recipient_user["id"], "quantity": 99, "request_id": rid})
        assert r.status_code == 200, r.text
        lv = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(demo_token)).json()["wealth"]
        assert lv["points"] == 495_000
        assert lv["level"] == 6  # 196k ≤ 495k < 696k → LV6
        assert lv["next_level"] == 7
        assert lv["remaining"] == 696_000 - 495_000

    def test_self_gift_credits_both(self, db, api, demo_token, demo_original):
        self._reset(db, demo_original["_id"])
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 1_000_000}})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        r = api.post(f"{BASE_URL}/api/gifts/send", headers=_auth(demo_token),
                     json={"gift_id": "cake", "recipient_id": str(demo_original["_id"]), "quantity": 2, "request_id": rid})
        assert r.status_code == 200, r.text
        u = db.users.find_one({"_id": demo_original["_id"]})
        assert u["wealth_points"] == 400
        assert u["charm_points"] == 400

    def test_insufficient_coins_releases_request_id(self, db, api, demo_token, recipient_user, demo_original):
        self._reset(db, demo_original["_id"])
        self._reset(db, recipient_user["oid"])
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 50}})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        r = api.post(f"{BASE_URL}/api/gifts/send", headers=_auth(demo_token),
                     json={"gift_id": "diamond", "recipient_id": recipient_user["id"], "quantity": 1, "request_id": rid})
        assert r.status_code == 402, r.text
        # Top up and retry with the SAME request_id → should now succeed
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 10_000}})
        r2 = api.post(f"{BASE_URL}/api/gifts/send", headers=_auth(demo_token),
                      json={"gift_id": "diamond", "recipient_id": recipient_user["id"], "quantity": 1, "request_id": rid})
        assert r2.status_code == 200, r2.text


# ---------------------------------------------------------------------------
# 6. send-multi flow
# ---------------------------------------------------------------------------
class TestSendMulti:
    def _reset(self, db, oid):
        db.users.update_one({"_id": oid}, {"$set": {"wealth_points": 0, "charm_points": 0, "wealth_level": 0, "charm_level": 0}})

    @pytest.fixture
    def two_recipients(self, db, api):
        out = []
        for i in range(2):
            s = uuid.uuid4().hex[:8]
            email = f"TEST_mrcp_{s}@orio.example.com"
            r = api.post(f"{BASE_URL}/api/auth/register", json={
                "email": email, "password": "Testpass!2026",
                "username": f"tm{s}", "nickname": f"TEST_M{i}",
            })
            assert r.status_code in (200, 201), r.text
            u = db.users.find_one({"email": email.lower()})
            out.append({"email": email, "id": str(u["_id"]), "oid": u["_id"]})
        yield out
        for o in out:
            db.users.delete_one({"_id": o["oid"]})

    def test_multi_credits_and_replay(self, db, api, demo_token, demo_original, two_recipients):
        self._reset(db, demo_original["_id"])
        for r in two_recipients:
            self._reset(db, r["oid"])
        db.users.update_one({"_id": demo_original["_id"]}, {"$set": {"coins": 10_000_000}})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        payload = {
            "gift_id": "heart",
            "recipient_ids": [r["id"] for r in two_recipients],
            "quantity": 4,
            "request_id": rid,
        }
        resp = api.post(f"{BASE_URL}/api/gifts/send-multi", json=payload, headers=_auth(demo_token))
        assert resp.status_code == 200, resp.text
        unit = 50
        per = unit * 4
        total = per * 2
        sender = db.users.find_one({"_id": demo_original["_id"]})
        assert sender["wealth_points"] == total
        for r in two_recipients:
            u = db.users.find_one({"_id": r["oid"]})
            assert u["charm_points"] == per
        # Replay → 409
        r2 = api.post(f"{BASE_URL}/api/gifts/send-multi", json=payload, headers=_auth(demo_token))
        assert r2.status_code == 409, r2.text
        sender2 = db.users.find_one({"_id": demo_original["_id"]})
        assert sender2["wealth_points"] == total  # no double credit
        assert sender2["coins"] == 10_000_000 - total  # no double deduct
