"""
Tests for the /wallet/recharge → Growth Point integration (part of the
FINAL VIP + Growth-Point Recharge update).

Verifies:
- POST /api/wallet/recharge awards growth_points 1:1 with the credited coin
  total (coins + bonus) and returns growth_points_awarded + new balance.
- The wallet_transactions row includes growth_points_awarded.
- The growth_ledger collection records an immutable audit row per recharge.
- /api/vip/progress reflects the newly awarded growth points.
- Unknown package_id returns 404, unauthenticated recharge returns 401/403.
"""
import os
import time
import requests
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")


def _login() -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PW}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok, r.text
    return tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _me(tok):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _progress(tok):
    r = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _packages(tok, channel="mobile"):
    r = requests.get(f"{BASE_URL}/api/wallet/packages",
                     params={"channel": channel}, headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- packages endpoint ----------
def test_wallet_packages_mobile_shape():
    tok = _login()
    pkgs = _packages(tok, "mobile")
    assert isinstance(pkgs, list) and len(pkgs) >= 5
    for p in pkgs:
        for k in ("id", "coins", "bonus", "price_usd", "label", "channel"):
            assert k in p, f"missing {k} in {p}"
        assert p["channel"] == "mobile"


def test_wallet_packages_web_bonus_is_nonzero():
    tok = _login()
    pkgs = _packages(tok, "web")
    assert any(int(p.get("bonus", 0)) > 0 for p in pkgs), "web packages must offer at least one bonus"


# ---------- recharge auth / validation ----------
def test_recharge_unauthorized():
    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      json={"package_id": "d_099"}, timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_recharge_unknown_package_returns_404():
    tok = _login()
    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      headers=_hdr(tok),
                      json={"package_id": "d_does_not_exist"}, timeout=15)
    assert r.status_code == 404, r.text


# ---------- recharge awards growth points 1:1 ----------
def test_recharge_awards_growth_points_1_to_1_mobile():
    """Smallest mobile package: d_099 = 9999 coins, 0 bonus → +9999 GP."""
    tok = _login()
    prog_before = _progress(tok)
    gp_before = int(prog_before["growth_points"])
    me_before = _me(tok)
    coins_before = int(me_before.get("coins", 0))

    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      headers=_hdr(tok),
                      json={"package_id": "d_099"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()

    # response shape
    for k in ("coins", "added", "growth_points_awarded", "growth_points"):
        assert k in body, f"missing {k} in {body}"
    assert body["added"] == 9999, body
    assert body["growth_points_awarded"] == 9999, body
    assert body["coins"] == coins_before + 9999
    assert body["growth_points"] == gp_before + 9999

    # /me reflects new coin balance
    me_after = _me(tok)
    assert int(me_after.get("coins", 0)) == coins_before + 9999

    # /progress reflects new growth points
    time.sleep(0.15)
    prog_after = _progress(tok)
    assert int(prog_after["growth_points"]) == gp_before + 9999
    # backward-compat mirror
    assert prog_after["spent"] == prog_after["growth_points"]


def test_recharge_web_package_awards_coins_plus_bonus_as_growth_points():
    """Web package includes bonus. GP awarded == coins + bonus (=total)."""
    tok = _login()
    prog_before = _progress(tok)
    gp_before = int(prog_before["growth_points"])

    # pick the smallest web package
    pkgs = _packages(tok, "web")
    pkg = min(pkgs, key=lambda p: p["price_usd"])
    expected = int(pkg["coins"]) + int(pkg["bonus"])

    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      headers=_hdr(tok),
                      json={"package_id": pkg["id"]}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == expected, body
    assert body["growth_points_awarded"] == expected, body
    assert body["growth_points"] == gp_before + expected


# ---------- audit trail in Mongo ----------
def test_recharge_writes_growth_ledger_and_wallet_tx():
    tok = _login()
    me = _me(tok)
    uid = str(me.get("id") or me.get("_id"))
    assert uid, me

    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      headers=_hdr(tok),
                      json={"package_id": "d_099"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    added = int(body["added"])

    client = MongoClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        # wallet_transactions has growth_points_awarded set
        tx = db.wallet_transactions.find_one(
            {"user_id": uid, "type": "recharge"},
            sort=[("created_at", -1)],
        )
        assert tx is not None, "no wallet_transactions recharge row written"
        assert int(tx.get("growth_points_awarded", 0)) == added, tx
        assert int(tx.get("amount", 0)) == added, tx

        # growth_ledger row exists
        row = db.growth_ledger.find_one(
            {"user_id": uid, "source": "recharge"},
            sort=[("created_at", -1)],
        )
        assert row is not None, "no growth_ledger row written for recharge"
        assert int(row.get("amount", 0)) == added, row
        assert row.get("package_id") == "d_099", row
        # linked to the same tx_id
        assert row.get("tx_id") == tx.get("tx_id"), (row, tx)
    finally:
        client.close()


# ---------- interaction with convert flow ----------
def test_progress_and_me_remain_consistent_after_recharge_and_convert():
    """After recharge (coins++, gp++), a convert (diamonds→gp) still works
    independently of coins and only touches diamonds/growth_points."""
    tok = _login()
    me_before = _me(tok)
    dia_before = int(me_before.get("diamonds", 0))
    gp_before = int(_progress(tok)["growth_points"])

    # Recharge first
    r = requests.post(f"{BASE_URL}/api/wallet/recharge",
                      headers=_hdr(tok),
                      json={"package_id": "d_099"}, timeout=15)
    assert r.status_code == 200, r.text
    gp_mid = int(r.json()["growth_points"])
    assert gp_mid == gp_before + 9999

    # If demo has diamonds, run a convert; otherwise skip that part.
    if dia_before >= 1:
        rc = requests.post(f"{BASE_URL}/api/vip/convert",
                           headers=_hdr(tok),
                           json={"amount": 1}, timeout=15)
        assert rc.status_code == 200, rc.text
        cb = rc.json()
        assert cb["diamonds"] == dia_before - 1
        assert cb["growth_points"] == gp_mid + 1
