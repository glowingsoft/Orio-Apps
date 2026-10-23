"""Iter-115b addendum — validates new fields/behaviors:
  (1) GET /api/me/levels now exposes `cumulative` (len=51 per system) with
      the exact spec values at [0..5].
  (2) /api/gifts/send-multi now ALLOWS the sender itself as a recipient and
      credits the sender BOTH wealth_points (full total_cost) and
      charm_points (per_recipient_cost for the self slot).
  (3) /api/gifts/send with recipient=self still credits both (regression).
"""
from __future__ import annotations
import os, uuid, pytest, requests, pymongo

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://audio-community-9.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"

EXPECTED_CUM_FIRST_SIX = [1000, 6000, 21000, 46000, 96000, 196000]


@pytest.fixture(scope="module")
def db():
    return pymongo.MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def demo_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_snapshot(db):
    u = db.users.find_one({"email": DEMO_EMAIL})
    assert u is not None
    return {"_id": u["_id"], "coins": int(u.get("coins", 0)),
            "wealth_points": int(u.get("wealth_points", 0)),
            "charm_points": int(u.get("charm_points", 0)),
            "wealth_level": int(u.get("wealth_level", 0)),
            "charm_level": int(u.get("charm_level", 0))}


@pytest.fixture(scope="module", autouse=True)
def restore(db, demo_snapshot):
    yield
    db.users.update_one({"_id": demo_snapshot["_id"]}, {"$set": {
        "coins": demo_snapshot["coins"],
        "wealth_points": demo_snapshot["wealth_points"],
        "charm_points": demo_snapshot["charm_points"],
        "wealth_level": demo_snapshot["wealth_level"],
        "charm_level": demo_snapshot["charm_level"],
    }})
    db.gift_requests.delete_many({"_id": {"$regex": r":TEST_"}})


def _auth(t): return {"Authorization": f"Bearer {t}"}


class TestCumulativeField:
    def test_me_levels_includes_cumulative_51(self, api, demo_token):
        r = api.get(f"{BASE_URL}/api/me/levels", headers=_auth(demo_token))
        assert r.status_code == 200, r.text
        data = r.json()
        for sys in ("wealth", "charm"):
            cum = data[sys].get("cumulative")
            assert isinstance(cum, list), f"{sys}.cumulative missing"
            assert len(cum) == 51, f"{sys}.cumulative length {len(cum)}"
            assert cum[:6] == EXPECTED_CUM_FIRST_SIX, f"{sys}.cumulative[:6]={cum[:6]}"
            # monotonically increasing
            for i in range(1, 51):
                assert cum[i] > cum[i-1], f"{sys}.cumulative non-monotone at idx {i}"


class TestSelfGiftSendMulti:
    def test_send_multi_allows_self(self, db, api, demo_token, demo_snapshot):
        did = demo_snapshot["_id"]
        # Reset points & give coins.
        db.users.update_one({"_id": did}, {"$set": {
            "coins": 5_000_000, "wealth_points": 0, "charm_points": 0,
            "wealth_level": 0, "charm_level": 0,
        }})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        payload = {
            "gift_id": "diamond",  # 1000 coins unit
            "recipient_ids": [str(did)],
            "quantity": 2,
            "request_id": rid,
        }
        r = api.post(f"{BASE_URL}/api/gifts/send-multi", json=payload, headers=_auth(demo_token))
        assert r.status_code == 200, r.text
        u = db.users.find_one({"_id": did})
        # unit=1000, qty=2 → per_recipient_cost=2000, total=2000 (self)
        assert u["wealth_points"] == 2000, u["wealth_points"]
        assert u["charm_points"] == 2000, u["charm_points"]
        assert u["coins"] == 5_000_000 - 2000

    def test_send_single_self_credits_both(self, db, api, demo_token, demo_snapshot):
        did = demo_snapshot["_id"]
        db.users.update_one({"_id": did}, {"$set": {
            "coins": 2_000_000, "wealth_points": 0, "charm_points": 0,
            "wealth_level": 0, "charm_level": 0,
        }})
        rid = "TEST_rid_" + uuid.uuid4().hex[:10]
        r = api.post(f"{BASE_URL}/api/gifts/send", json={
            "gift_id": "cake",  # unit=200
            "recipient_id": str(did),
            "quantity": 3,
            "request_id": rid,
        }, headers=_auth(demo_token))
        assert r.status_code == 200, r.text
        u = db.users.find_one({"_id": did})
        assert u["wealth_points"] == 600
        assert u["charm_points"] == 600
