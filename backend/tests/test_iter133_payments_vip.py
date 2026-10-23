"""
Iter-133 — Diamond recharge rate change (499/$ ), Stripe secure checkout,
VIP 10-level thresholds driven by lifetime RECHARGED diamonds, fulfilment
idempotency, and recharge-agent diamonds_target recomputation.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

# Load backend .env so we can talk directly to Mongo for the fulfilment test.
load_dotenv("/app/backend/.env")

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

# Thresholds the user requested (10 levels, cumulative, recharged diamonds).
EXPECTED_THRESHOLDS = [
    (1, 5_000), (2, 100_000), (3, 300_000), (4, 650_000), (5, 2_000_000),
    (6, 7_000_000), (7, 20_000_000), (8, 40_000_000), (9, 60_000_000), (10, 100_000_000),
]

# Expected 12 mobile packages with coins = round(price_cents * 499 / 100), bonus=0.
EXPECTED_TIERS = [99, 199, 299, 499, 999, 1999, 2999, 4999, 9999, 14999, 19999, 99900]


def _coins(cents: int) -> int:
    return (cents * 499 + 50) // 100


@pytest.fixture(scope="session")
def mongo_db():
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} → {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def test1_token() -> str:
    return _login("test.1@oriotest.dev", "demo1234")


@pytest.fixture(scope="session")
def test2_token() -> str:
    return _login("test.2@oriotest.dev", "demo1234")


@pytest.fixture(scope="session")
def test3_token() -> str:
    return _login("test.3@oriotest.dev", "demo1234")


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Packages ---------------------------------------------------------
class TestPackages:
    def test_mobile_packages_shape_and_coins(self, test2_token):
        r = requests.get(f"{API}/wallet/packages", params={"channel": "mobile"}, headers=_hdr(test2_token), timeout=20)
        assert r.status_code == 200, r.text
        pkgs = r.json()
        assert len(pkgs) == 12, f"expected 12 mobile packages, got {len(pkgs)}"
        for pkg, cents in zip(pkgs, EXPECTED_TIERS):
            assert pkg["price_cents"] == cents
            assert pkg["coins"] == _coins(cents), f"{pkg['id']} coins={pkg['coins']} expected {_coins(cents)}"
            assert pkg["bonus"] == 0, f"mobile bonus must be 0, got {pkg['bonus']} for {pkg['id']}"
            assert pkg["id"].startswith("d_")
        # Spot-check the samples called out in the request.
        by_id = {p["id"]: p for p in pkgs}
        assert by_id["d_099"]["coins"] == 494
        assert by_id["d_999"]["coins"] == 4985
        assert by_id["d_19999"]["coins"] == 99795
        assert by_id["d_99900"]["coins"] == 498501
        assert by_id["d_99900"]["bonus"] == 0
        assert by_id["d_99900"]["price_usd"] == 999.0

    def test_web_packages_bonus_10pct(self, test2_token):
        r = requests.get(f"{API}/wallet/packages", params={"channel": "web"}, headers=_hdr(test2_token), timeout=20)
        assert r.status_code == 200
        pkgs = r.json()
        assert len(pkgs) == 12
        for pkg, cents in zip(pkgs, EXPECTED_TIERS):
            base = _coins(cents)
            expected_bonus = (base + 5) // 10
            assert pkg["coins"] == base
            assert pkg["bonus"] == expected_bonus, f"{pkg['id']} bonus={pkg['bonus']} expected {expected_bonus}"
            assert pkg["id"].startswith("w_")
        by_id = {p["id"]: p for p in pkgs}
        assert by_id["w_99900"]["bonus"] == 49850


# ---------- /wallet/recharge should be 410 ----------------------------------
class TestLegacyRechargeDisabled:
    def test_wallet_recharge_returns_410_and_does_not_credit(self, test2_token, mongo_db):
        me0 = requests.get(f"{API}/auth/me", headers=_hdr(test2_token), timeout=20).json()
        coins0 = int(me0["user"]["coins"] if "user" in me0 else me0.get("coins", 0))
        r = requests.post(f"{API}/wallet/recharge", headers=_hdr(test2_token), json={"package_id": "d_099"}, timeout=20)
        assert r.status_code == 410, f"expected 410 Gone, got {r.status_code}: {r.text[:200]}"
        me1 = requests.get(f"{API}/auth/me", headers=_hdr(test2_token), timeout=20).json()
        coins1 = int(me1["user"]["coins"] if "user" in me1 else me1.get("coins", 0))
        assert coins1 == coins0, "wallet balance must NOT change on 410"


# ---------- Checkout --------------------------------------------------------
class TestCheckout:
    def test_checkout_unknown_package_404(self, test2_token):
        r = requests.post(f"{API}/payments/checkout", headers=_hdr(test2_token),
                          json={"package_id": "nope_xx", "origin_url": BASE_URL}, timeout=30)
        assert r.status_code == 404

    def test_checkout_creates_pending_transaction(self, test2_token, mongo_db):
        r = requests.post(f"{API}/payments/checkout", headers=_hdr(test2_token),
                          json={"package_id": "d_099", "origin_url": BASE_URL}, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        assert "url" in body and body["url"].startswith("https://checkout.stripe.com"), body
        assert "session_id" in body and body["session_id"]
        sid = body["session_id"]
        doc = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert doc is not None, "payment_transactions doc should be created"
        assert doc["credited"] is False
        assert doc["payment_status"] == "pending"
        assert doc["package_id"] == "d_099"
        assert int(doc["diamonds"]) == 494

    def test_status_unpaid_does_not_credit(self, test2_token, mongo_db):
        # Create a fresh session, then poll status without paying.
        r = requests.post(f"{API}/payments/checkout", headers=_hdr(test2_token),
                          json={"package_id": "d_099", "origin_url": BASE_URL}, timeout=60).json()
        sid = r["session_id"]
        me0 = requests.get(f"{API}/auth/me", headers=_hdr(test2_token), timeout=20).json()
        coins0 = int((me0.get("user") or me0).get("coins", 0))
        s = requests.get(f"{API}/payments/status/{sid}", headers=_hdr(test2_token), timeout=30)
        assert s.status_code == 200
        body = s.json()
        assert body["payment_status"] in ("pending", "unpaid", "open", "no_payment_required"), body
        assert body.get("credited_now") in (False, None)
        me1 = requests.get(f"{API}/auth/me", headers=_hdr(test2_token), timeout=20).json()
        coins1 = int((me1.get("user") or me1).get("coins", 0))
        assert coins1 == coins0, "unpaid session must not credit"
        doc = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert doc["credited"] is False

    def test_status_other_users_session_returns_404(self, test2_token, test3_token):
        r = requests.post(f"{API}/payments/checkout", headers=_hdr(test2_token),
                          json={"package_id": "d_099", "origin_url": BASE_URL}, timeout=60).json()
        sid = r["session_id"]
        s = requests.get(f"{API}/payments/status/{sid}", headers=_hdr(test3_token), timeout=30)
        assert s.status_code == 404


# ---------- Fulfilment idempotency ------------------------------------------
class TestFulfilmentIdempotency:
    def test_paid_session_credits_exactly_once_and_unlocks_vip(self, test2_token, mongo_db):
        # Fresh checkout for a mid-size pack so VIP1 (5,000) auto-unlocks.
        r = requests.post(f"{API}/payments/checkout", headers=_hdr(test2_token),
                          json={"package_id": "d_1999", "origin_url": BASE_URL}, timeout=60).json()
        sid = r["session_id"]
        tx = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert tx is not None
        diamonds = int(tx["diamonds"])
        assert diamonds == _coins(1999)
        user_oid = ObjectId(tx["user_id"])

        before = mongo_db.users.find_one({"_id": user_oid},
                                         {"coins": 1, "recharged_diamonds": 1, "vip_level": 1}) or {}
        coins_before = int(before.get("coins", 0) or 0)
        rech_before = int(before.get("recharged_diamonds", 0) or 0)

        # Simulate Stripe success by flipping payment_status in Mongo.
        mongo_db.payment_transactions.update_one(
            {"session_id": sid},
            {"$set": {"payment_status": "paid", "status": "complete"}},
        )
        # First status call should credit.
        s1 = requests.get(f"{API}/payments/status/{sid}", headers=_hdr(test2_token), timeout=30).json()
        assert s1["payment_status"] == "paid"
        assert s1.get("credited_now") is True
        # Second call must be idempotent.
        s2 = requests.get(f"{API}/payments/status/{sid}", headers=_hdr(test2_token), timeout=30).json()
        assert s2["payment_status"] == "paid"
        assert s2.get("credited_now") in (False, None)

        after = mongo_db.users.find_one({"_id": user_oid},
                                        {"coins": 1, "recharged_diamonds": 1, "vip_level": 1}) or {}
        coins_after = int(after.get("coins", 0) or 0)
        rech_after = int(after.get("recharged_diamonds", 0) or 0)
        vip_after = int(after.get("vip_level", 0) or 0)

        assert coins_after - coins_before == diamonds, \
            f"coins credited={coins_after - coins_before} expected {diamonds}"
        assert rech_after - rech_before == diamonds, \
            f"recharged_diamonds delta={rech_after - rech_before} expected {diamonds}"
        # 1999 pack = 9975 diamonds → above VIP1 threshold (5,000).
        assert rech_after >= 5_000
        assert vip_after >= 1, f"VIP should auto-unlock to >=1, got {vip_after}"

        tx_now = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert tx_now["credited"] is True

        # And only one wallet_transactions entry exists for this session.
        n = mongo_db.wallet_transactions.count_documents({"stripe_session_id": sid})
        assert n == 1, f"wallet_transactions must be inserted exactly once, got {n}"


# ---------- /vip/thresholds and /vip/progress -------------------------------
class TestVipThresholdsAndProgress:
    def test_thresholds_match_spec(self, test1_token):
        r = requests.get(f"{API}/vip/thresholds", headers=_hdr(test1_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()["thresholds"]
        got = [(int(x["level"]), int(x["threshold"])) for x in sorted(rows, key=lambda x: x["level"])]
        assert got == EXPECTED_THRESHOLDS, got

    def test_vip_progress_shape(self, test1_token):
        r = requests.get(f"{API}/vip/progress", headers=_hdr(test1_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "recharged_diamonds" in d
        assert "levels" in d and len(d["levels"]) == 10
        for row in d["levels"]:
            assert "level" in row and "threshold" in row and "remaining" in row and "unlocked" in row
            if row["unlocked"]:
                assert row["remaining"] == 0
            else:
                assert row["remaining"] == row["threshold"] - d["recharged_diamonds"]

    def test_test1_vip3_remaining_vip4(self, test1_token):
        # test.1 is set up with recharged=498,501 → VIP3; VIP4 remaining = 151,499.
        r = requests.get(f"{API}/vip/progress", headers=_hdr(test1_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["recharged_diamonds"] == 498_501, d["recharged_diamonds"]
        # VIP1..3 unlocked
        by_level = {row["level"]: row for row in d["levels"]}
        for lv in (1, 2, 3):
            assert by_level[lv]["unlocked"], f"VIP{lv} should be unlocked"
            assert by_level[lv]["remaining"] == 0
        # VIP4 locked with remaining 151,499
        assert by_level[4]["unlocked"] is False
        assert by_level[4]["remaining"] == 151_499
        assert d.get("next_level") == 4
        assert d.get("remaining") == 151_499
        assert d.get("level") == 3


# ---------- /vip/convert must NOT change vip_level -------------------------
class TestVipConvertNoVipChange:
    def test_convert_does_not_change_vip_level(self, test2_token, mongo_db):
        # Ensure test.2 has coins to convert. If not, give a small amount via
        # the paid-fulfilment path we already exercised. We'll just skip when
        # the balance is 0 to keep the test non-destructive.
        me = requests.get(f"{API}/auth/me", headers=_hdr(test2_token), timeout=20).json()
        u = me.get("user") or me
        coins = int(u.get("coins", 0) or 0)
        vip_before = int(u.get("vip_level", 0) or 0)
        if coins < 10:
            pytest.skip("test.2 has <10 coins; skipping convert check")
        r = requests.post(f"{API}/vip/convert", headers=_hdr(test2_token), json={"amount": 10}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["vip_level"] == vip_before, f"vip_level changed from {vip_before} to {body['vip_level']}"


# ---------- Recharge agent diamonds_target = amount_usd * 499 --------------
class TestRechargeAgentRate:
    def test_new_request_uses_499_per_usd(self, test2_token, mongo_db):
        # Pick any active agent; if none, create a throwaway one directly in Mongo.
        agent = mongo_db.recharge_agents.find_one({"is_active": True})
        cleanup_id = None
        if not agent:
            res = mongo_db.recharge_agents.insert_one({
                "name": "TEST_AGENT_ITER133", "agent_code": "TESTAG133",
                "is_active": True, "created_at": __import__("datetime").datetime.utcnow(),
                "payout_methods": [],
            })
            agent = mongo_db.recharge_agents.find_one({"_id": res.inserted_id})
            cleanup_id = res.inserted_id

        from datetime import datetime, timezone
        paid_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "agent_id": str(agent["_id"]),
            "agent_tx_id": f"TX-ITER133-{int(time.time())}",
            "amount_usd": 10,
            "paid_at": paid_at,
            "note": "ITER133 pytest",
        }
        r = requests.post(f"{API}/recharge-agent-transactions", headers=_hdr(test2_token), json=payload, timeout=30)
        try:
            assert r.status_code == 201, f"{r.status_code} {r.text[:300]}"
            body = r.json()
            tx_id = body.get("id") or body.get("_id") or body.get("tx_id")
            assert tx_id, body
            # Fetch and verify API response round-trips the known fields.
            got = requests.get(f"{API}/recharge-agent-transactions/{tx_id}", headers=_hdr(test2_token), timeout=20)
            assert got.status_code == 200
            jd = got.json()
            assert int(jd["amount_usd"]) == 10
            # diamonds_target + rate_diamonds_per_usd aren't exposed in the public serializer
            # but are stored in Mongo — verify at the DB layer (where callers like admin verify use it).
            db_doc = mongo_db.recharge_agent_transactions.find_one({"_id": ObjectId(tx_id)})
            assert db_doc is not None
            assert int(db_doc["diamonds_target"]) == 10 * 499, db_doc
            assert int(db_doc["rate_diamonds_per_usd"]) == 499
        finally:
            # Teardown: delete the test tx and (if we created it) the test agent.
            try:
                if 'tx_id' in locals() and tx_id:
                    mongo_db.recharge_agent_transactions.delete_one({"_id": ObjectId(tx_id)})
            except Exception:
                pass
            if cleanup_id is not None:
                mongo_db.recharge_agents.delete_one({"_id": cleanup_id})
