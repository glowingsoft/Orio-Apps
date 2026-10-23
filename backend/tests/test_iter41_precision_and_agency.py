"""
ORIO — Iter-41 verification:
  • Official 9,999 Diamonds = $1 USD conversion
  • $10 minimum, $1,000 maximum withdrawal
  • Placeholder-rejection on payout methods
  • Agency ID lookup + user-initiated join-request flow
"""
from __future__ import annotations
import os, uuid, requests, pytest

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"


def _post(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.post(f"{API}{path}", headers=h, json=json, timeout=25)


def _patch(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.patch(f"{API}{path}", headers=h, json=json, timeout=25)


def _get(path, tok=None):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.get(f"{API}{path}", headers=h, timeout=25)


def _delete(path, tok=None):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.delete(f"{API}{path}", headers=h, timeout=25)


def _login():
    r = _post("/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PW})
    assert r.status_code == 200
    return r.json()["access_token"]


def _register_fresh(tag="i41"):
    t = uuid.uuid4().hex[:8]
    email = f"{tag}_{t}@voiceup.app"
    r = _post("/auth/register", json={
        "email": email, "password": "iter41pass",
        "username": f"{tag}_{t}"[:20], "nickname": f"I41 {t[:4]}",
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = _get("/auth/me", tok).json()
    return tok, me["id"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login()


# -------------- Conversion / limits --------------
def test_conversion_is_exactly_9999(admin_tok):
    j = _get("/withdrawal/config", admin_tok).json()
    assert j["diamonds_per_usd"] == 9999
    assert j["minimum_withdrawal_usd"] == 10
    assert j["maximum_withdrawal_usd"] == 1000
    # Spec examples
    assert 10 * 9999 == 99_990
    assert 100 * 9999 == 999_900
    assert 1_000 * 9999 == 9_999_000


# -------------- Placeholder rejection on payout methods --------------
def test_placeholder_values_rejected():
    tok, _ = _register_fresh("i41_ph")
    for payload in [
        {"method": "paypal", "details": {"email": "x@y.co", "account_holder_name": "test"}},
        {"method": "paypal", "details": {"email": "x@y.co", "account_holder_name": "..."}},
        {"method": "paypal", "details": {"email": "x@y.co", "account_holder_name": "A"}},  # too short
        {"method": "paypal", "details": {"email": "notanemail", "account_holder_name": "Jane Doe"}},
        {"method": "usdt_trc20", "details": {"wallet_address": "not-a-tron-address"}},
        {"method": "bank_transfer", "details": {
            "account_holder_name": "Jane Doe", "bank_name": "demo",
            "account_number": "12", "country": "US",
        }},  # short account_number + "demo" bank
    ]:
        r = _post("/me/payout-methods", tok, json=payload)
        assert r.status_code == 400, f"accepted bad payload: {payload} / {r.text}"


def test_real_values_accepted():
    tok, _ = _register_fresh("i41_ok")
    r = _post("/me/payout-methods", tok, json={
        "method": "paypal",
        "details": {"email": "jane.doe@example.co", "account_holder_name": "Jane Doe"},
    })
    assert r.status_code == 201, r.text
    r = _post("/me/payout-methods", tok, json={
        "method": "usdt_trc20",
        "details": {"wallet_address": "TXYZabc1234defghjkmnpqrstuvwxyzABC"},
    })
    assert r.status_code == 201, r.text


# -------------- Saved payout persists --------------
def test_saved_payout_method_persists_across_sessions():
    tok1, _ = _register_fresh("i41_prs")
    r = _post("/me/payout-methods", tok1, json={
        "method": "paypal",
        "details": {"email": "persist@example.co", "account_holder_name": "Jane Doe"},
    })
    assert r.status_code == 201
    pm_id = r.json()["id"]
    # Simulate "logout/login" by requesting /me/payout-methods with the same token
    items = _get("/me/payout-methods", tok1).json()["items"]
    assert any(it["id"] == pm_id for it in items)
    # Still there after another /auth/me round-trip
    _get("/auth/me", tok1)
    items2 = _get("/me/payout-methods", tok1).json()["items"]
    assert any(it["id"] == pm_id for it in items2)


# -------------- Agency ID lookup --------------
def test_agency_lookup_rejects_bogus(admin_tok):
    tok, _ = _register_fresh("i41_lkup")
    # Non-existent id -> 404
    r = _get("/agency-search?id=bogus-does-not-exist", tok)
    assert r.status_code == 404
    # Missing id -> 400
    r = _get("/agency-search?id=", tok)
    assert r.status_code == 400


def test_agency_lookup_returns_real_agency(admin_tok):
    _, owner_id = _register_fresh("i41_own")
    name = f"Lookup-{uuid.uuid4().hex[:4]}"
    ag = _post("/admin/agencies", admin_tok,
               json={"name": name, "owner_user_id": owner_id}).json()
    seeker_tok, _ = _register_fresh("i41_seek")
    r = _get(f"/agency-search?id={ag['id']}", seeker_tok)
    assert r.status_code == 200
    body = r.json()
    assert body["agency"]["id"] == ag["id"]
    assert body["agency"]["name"] == name
    assert body["my_membership_status"] is None
    assert body["pending_request_id"] is None


# -------------- Join request flow --------------
def test_join_request_pending_then_approved(admin_tok):
    owner_tok, owner_id = _register_fresh("i41_own2")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"Join-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    user_tok, user_id = _register_fresh("i41_u2")

    # User requests to join
    r = _post(f"/agencies/{ag['id']}/join-request", user_tok, json={"message": "please"})
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["status"] == "pending"
    # Lookup now reflects the pending state
    look = _get(f"/agency-search?id={ag['id']}", user_tok).json()
    assert look["pending_request_id"] == req["id"]
    # User is NOT a member yet
    assert _get("/me/agency", user_tok).json()["membership"] is None
    # Duplicate request -> 409
    r = _post(f"/agencies/{ag['id']}/join-request", user_tok)
    assert r.status_code == 409
    # Owner approves
    r = _post(f"/agencies/{ag['id']}/join-requests/{req['id']}/approve", owner_tok)
    assert r.status_code == 200
    # NOW user is a member
    me_ag = _get("/me/agency", user_tok).json()
    assert me_ag["agency"]["id"] == ag["id"]
    assert me_ag["role"] == "HOST"


def test_join_request_can_be_rejected(admin_tok):
    owner_tok, owner_id = _register_fresh("i41_rown")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"Rej-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    user_tok, _ = _register_fresh("i41_ru")
    req = _post(f"/agencies/{ag['id']}/join-request", user_tok).json()
    r = _post(f"/agencies/{ag['id']}/join-requests/{req['id']}/reject", owner_tok)
    assert r.status_code == 200
    # Not a member
    assert _get("/me/agency", user_tok).json()["membership"] is None


def test_user_cannot_join_if_already_in_an_agency(admin_tok):
    _, owner_a_id = _register_fresh("i41_a")
    _, owner_b_id = _register_fresh("i41_b")
    ag_a = _post("/admin/agencies", admin_tok,
                 json={"name": f"A-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_a_id}).json()
    ag_b = _post("/admin/agencies", admin_tok,
                 json={"name": f"B-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_b_id}).json()
    user_tok, user_id = _register_fresh("i41_dblu")
    _post(f"/admin/agencies/{ag_a['id']}/hosts", admin_tok, json={"user_id": user_id})
    r = _post(f"/agencies/{ag_b['id']}/join-request", user_tok)
    assert r.status_code == 409


def test_user_can_cancel_own_pending_request(admin_tok):
    owner_tok, owner_id = _register_fresh("i41_cown")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"CR-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    user_tok, _ = _register_fresh("i41_cu")
    req = _post(f"/agencies/{ag['id']}/join-request", user_tok).json()
    r = _delete(f"/me/join-requests/{req['id']}", user_tok)
    assert r.status_code == 200
    # cancelled: no longer pending
    assert _get("/me/join-requests", user_tok).json()["items"] == []


def test_only_owner_or_admin_can_approve(admin_tok):
    _, owner_id = _register_fresh("i41_sown")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"S-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    user_tok, _ = _register_fresh("i41_su")
    stranger_tok, _ = _register_fresh("i41_str")
    req = _post(f"/agencies/{ag['id']}/join-request", user_tok).json()
    # Stranger cannot approve
    assert _post(f"/agencies/{ag['id']}/join-requests/{req['id']}/approve", stranger_tok).status_code == 403
    # Stranger cannot reject
    assert _post(f"/agencies/{ag['id']}/join-requests/{req['id']}/reject", stranger_tok).status_code == 403
    # Admin can
    assert _post(f"/agencies/{ag['id']}/join-requests/{req['id']}/approve", admin_tok).status_code == 200
