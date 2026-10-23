"""
Tests for FINAL PREMIUM V-EMBLEM + GROWTH-POINT VIP UPDATE.

Endpoints under test (auth required, Bearer token):
- GET  /api/vip/progress   (growth-point driven progression)
- POST /api/vip/convert    (1:1 Diamond -> Growth Point conversion)
- GET  /api/vip/tiers      (unchanged regression)
"""
import os
import time
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com").rstrip("/")

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"


def _login() -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PW}, timeout=15)
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


# --- /api/vip/tiers regression ---
def test_vip_tiers_regression():
    tok = _login()
    r = requests.get(f"{BASE_URL}/api/vip/tiers", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    tiers = data.get("tiers", [])
    assert len(tiers) == 7
    prices = [t["price_coins"] for t in tiers]
    assert prices == [5000, 12000, 25000, 50000, 120000, 250000, 500000], prices
    for t in tiers:
        assert t.get("duration_days") == 30
        assert isinstance(t.get("benefits"), list) and len(t["benefits"]) >= 2


# --- /api/vip/progress schema & correctness ---
def test_vip_progress_schema():
    tok = _login()
    r = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text
    p = r.json()
    # required keys
    for key in [
        "level", "spent", "growth_points", "current_floor",
        "next_level", "next_threshold", "remaining", "progress", "thresholds",
    ]:
        assert key in p, f"missing key {key} in {p}"

    assert isinstance(p["level"], int) and 0 <= p["level"] <= 7
    assert isinstance(p["growth_points"], int) and p["growth_points"] >= 0
    # backwards-compat mirror
    assert p["spent"] == p["growth_points"]
    assert isinstance(p["progress"], (int, float)) and 0.0 <= p["progress"] <= 1.0
    assert isinstance(p["remaining"], int) and p["remaining"] >= 0
    thr = p["thresholds"]
    assert isinstance(thr, list) and len(thr) == 7
    expected = [50_000, 250_000, 1_000_000, 3_000_000, 7_000_000, 15_000_000, 30_000_000]
    assert [t["threshold"] for t in thr] == expected
    assert [t["level"] for t in thr] == [1, 2, 3, 4, 5, 6, 7]


def test_vip_progress_math_invariants():
    tok = _login()
    r = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15)
    p = r.json()
    g = p["growth_points"]

    # Level from growth_points must match thresholds table.
    expected_level = 0
    for row in p["thresholds"]:
        if g >= row["threshold"]:
            expected_level = row["level"]
    assert p["level"] == expected_level, p

    if p["next_level"] is not None:
        assert p["next_threshold"] > g or p["next_threshold"] == g + p["remaining"]
        assert p["remaining"] == p["next_threshold"] - g
        # progress within [0, 1]
        assert 0.0 <= p["progress"] <= 1.0
    else:
        # at max tier
        assert p["level"] == 7
        assert p["progress"] == 1.0
        assert p["remaining"] == 0


def test_vip_progress_unauthorized():
    r = requests.get(f"{BASE_URL}/api/vip/progress", timeout=15)
    assert r.status_code in (401, 403), r.status_code


# --- /api/vip/convert (Diamond -> Growth Point) ---
def test_vip_convert_unauthorized():
    r = requests.post(f"{BASE_URL}/api/vip/convert", json={"amount": 10}, timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_vip_convert_bad_amount_validation():
    tok = _login()
    # zero / negative rejected by pydantic ge=1
    r = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": 0}, timeout=15)
    assert r.status_code in (400, 422), r.text
    r = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": -50}, timeout=15)
    assert r.status_code in (400, 422), r.text


def test_vip_convert_insufficient_diamonds():
    tok = _login()
    me = _me(tok)
    dia = int(me.get("diamonds", 0))
    over = dia + 1_000_000
    r = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": over}, timeout=15)
    assert r.status_code == 402, f"expected 402 got {r.status_code}: {r.text}"


def test_vip_convert_happy_path_small_amount():
    """Convert 5 diamonds, verify diamonds decrement, growth_points increment, /me + /progress reflect it."""
    tok = _login()
    me_before = _me(tok)
    dia_before = int(me_before.get("diamonds", 0))
    prog_before = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15).json()
    gp_before = int(prog_before.get("growth_points", 0))

    if dia_before < 5:
        # can't run happy path without balance; skip cleanly
        import pytest
        pytest.skip(f"demo user only has {dia_before} diamonds, need >=5 for happy-path convert test")

    amount = 5
    r = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": amount}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("converted") == amount
    assert body.get("diamonds") == dia_before - amount
    assert body.get("growth_points") == gp_before + amount
    assert isinstance(body.get("tx_id"), str) and len(body["tx_id"]) > 0

    # Verify via /me
    me_after = _me(tok)
    assert int(me_after.get("diamonds", 0)) == dia_before - amount

    # Verify via /progress
    time.sleep(0.2)
    prog_after = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15).json()
    assert int(prog_after["growth_points"]) == gp_before + amount
    assert prog_after["spent"] == prog_after["growth_points"]  # mirror preserved


def test_vip_convert_is_atomic_on_race_simulation():
    """Fire two sequential conversions and ensure counters remain consistent."""
    tok = _login()
    me = _me(tok)
    dia = int(me.get("diamonds", 0))
    if dia < 4:
        import pytest
        pytest.skip("insufficient diamonds for atomicity sequence test")

    prog0 = requests.get(f"{BASE_URL}/api/vip/progress", headers=_hdr(tok), timeout=15).json()
    gp0 = int(prog0["growth_points"])

    r1 = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": 2}, timeout=15)
    r2 = requests.post(f"{BASE_URL}/api/vip/convert", headers=_hdr(tok), json={"amount": 2}, timeout=15)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    b2 = r2.json()
    assert b2["diamonds"] == dia - 4
    assert b2["growth_points"] == gp0 + 4
