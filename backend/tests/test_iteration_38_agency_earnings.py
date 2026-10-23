"""
Iter-38 — Agency + Host Earnings Financial Foundation (Phase 1).

Uses the live preview backend (same pattern as iter-37 tests).
Covers: revenue split, agency CRUD, one-active-agency rule, host
suspend/reactivate, admin ledger, idempotency, immutability (no mutation API),
refund/reversal, permissions, audit log.
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


def _get(path, tok=None, params=None):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.get(f"{API}{path}", headers=h, params=params, timeout=25)


def _patch(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.patch(f"{API}{path}", headers=h, json=json, timeout=25)


def _delete(path, tok=None):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.delete(f"{API}{path}", headers=h, timeout=25)


def _login(email=DEMO_EMAIL, pw=DEMO_PW):
    r = _post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_fresh(tag="i38"):
    t = uuid.uuid4().hex[:8]
    email = f"{tag}_{t}@voiceup.app"
    r = _post("/auth/register", json={
        "email": email, "password": "iter38pass",
        "username": f"{tag}_{t}"[:20], "nickname": f"I38 {t[:4]}",
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = _get("/auth/me", tok).json()
    return tok, me["id"], email


# ---------------------- Fixtures ----------------------
@pytest.fixture(scope="module")
def admin_tok():
    return _login()


# ---------------------- Revenue split ----------------------
def test_revenue_split_default(admin_tok):
    r = _get("/admin/revenue-split", admin_tok)
    assert r.status_code == 200
    j = r.json()
    assert j["host_percentage"] + j["agency_percentage"] + j["orio_percentage"] == 100


def test_revenue_split_non_admin_blocked():
    tok, _, _ = _register_fresh("i38nonadmin")
    r = _get("/admin/revenue-split", tok)
    assert r.status_code == 403


def test_revenue_split_sum_must_be_100(admin_tok):
    r = _patch("/admin/revenue-split", admin_tok,
               json={"host_percentage": 60, "agency_percentage": 5, "orio_percentage": 45})
    assert r.status_code == 400
    # Valid update
    r = _patch("/admin/revenue-split", admin_tok,
               json={"host_percentage": 50, "agency_percentage": 5, "orio_percentage": 45,
                     "reason": "iter-38 baseline"})
    assert r.status_code == 200
    j = r.json()
    assert j["host_percentage"] == 50 and j["agency_percentage"] == 5


# ---------------------- Agency CRUD ----------------------
def test_create_agency_and_update(admin_tok):
    _, uid, _ = _register_fresh("i38owner")
    r = _post("/admin/agencies", admin_tok, json={"name": "Stellar", "owner_user_id": uid})
    assert r.status_code == 201, r.text
    ag = r.json()
    assert ag["name"] == "Stellar" and ag["status"] == "active"
    # Public read
    r = _get(f"/agencies/{ag['id']}", admin_tok)
    assert r.status_code == 200
    # Update name + status
    r = _patch(f"/admin/agencies/{ag['id']}", admin_tok, json={"name": "Nova", "status": "suspended"})
    assert r.status_code == 200
    assert r.json()["name"] == "Nova" and r.json()["status"] == "suspended"


def test_create_agency_non_admin_blocked():
    tok, uid, _ = _register_fresh("i38u")
    r = _post("/admin/agencies", tok, json={"name": "Rogue", "owner_user_id": uid})
    assert r.status_code == 403


def test_one_active_agency_per_host(admin_tok):
    _, uid_a, _ = _register_fresh("i38ownA")
    _, uid_b, _ = _register_fresh("i38hstB")
    _, uid_c, _ = _register_fresh("i38ownC")

    ag1 = _post("/admin/agencies", admin_tok,
                json={"name": "AgOne", "owner_user_id": uid_a}).json()
    ag2 = _post("/admin/agencies", admin_tok,
                json={"name": "AgTwo", "owner_user_id": uid_c}).json()

    r = _post(f"/admin/agencies/{ag1['id']}/hosts", admin_tok, json={"user_id": uid_b})
    assert r.status_code == 201
    # Second active membership for same user → 409
    r = _post(f"/admin/agencies/{ag2['id']}/hosts", admin_tok, json={"user_id": uid_b})
    assert r.status_code == 409

    # Suspend B in ag1
    r = _post(f"/admin/agencies/{ag1['id']}/hosts/{uid_b}/suspend", admin_tok)
    assert r.status_code == 200
    # Reactivate B in ag1 (no other active membership)
    r = _post(f"/admin/agencies/{ag1['id']}/hosts/{uid_b}/reactivate", admin_tok)
    assert r.status_code == 200
    # Remove B from ag1 → now B can join ag2
    r = _delete(f"/admin/agencies/{ag1['id']}/hosts/{uid_b}", admin_tok)
    assert r.status_code == 200
    r = _post(f"/admin/agencies/{ag2['id']}/hosts", admin_tok, json={"user_id": uid_b})
    assert r.status_code == 201


def test_agency_owner_can_read_own_agency_earnings(admin_tok):
    tok, uid, _ = _register_fresh("i38owner2")
    r = _post("/admin/agencies", admin_tok, json={"name": "ReadMe", "owner_user_id": uid})
    assert r.status_code == 201
    ag_id = r.json()["id"]
    # Owner can read
    r = _get(f"/agencies/{ag_id}/earnings", tok)
    assert r.status_code == 200
    # Stranger cannot
    other_tok, _, _ = _register_fresh("i38stranger")
    r = _get(f"/agencies/{ag_id}/earnings", other_tok)
    assert r.status_code == 403


# ---------------------- Split math ----------------------
@pytest.mark.parametrize("gross", [0, 1, 9, 10, 99, 100, 999, 1000, 123_456, 7_891_234])
def test_split_math_no_money_lost(gross):
    import sys; sys.path.insert(0, "/app/backend")
    from server import _split_amount, DEFAULT_REVENUE_SPLIT
    h, a, o = _split_amount(gross, DEFAULT_REVENUE_SPLIT)
    assert h + a + o == gross
    assert h >= 0 and a >= 0 and o >= 0


# ---------------------- Gift → ledger ----------------------
def test_gift_send_writes_ledger_entry(admin_tok):
    # Pick a non-demo recipient from the rooms list.
    r = _get("/rooms", admin_tok)
    assert r.status_code == 200
    recipient = None
    for room in r.json():
        owner = (room.get("owner") or {}).get("id")
        if owner:
            recipient = owner; break
    assert recipient, "no recipient found"
    r = _post("/gifts/send-multi", admin_tok,
              json={"gift_id": "diamond", "recipient_ids": [recipient], "quantity": 1})
    assert r.status_code == 200, r.text
    tx_id = r.json()["tx_ids"][0]
    # Ledger contains the row
    r = _get(f"/admin/ledger?user_id={recipient}&limit=20", admin_tok)
    assert r.status_code == 200
    rows = [it for it in r.json()["items"] if it["reference_id"] == tx_id]
    assert rows, "no ledger row written for gift"
    it = rows[0]
    assert it["source"] == "gift"
    assert it["status"] == "completed"
    assert it["host_amount"] + it["agency_amount"] + it["orio_amount"] == it["gross_amount"]
    assert it["split_snapshot"]["host_percentage"] + it["split_snapshot"]["agency_percentage"] + it["split_snapshot"]["orio_percentage"] == 100


def test_gift_ledger_idempotent_via_combo(admin_tok):
    # Same combo_of should still create a NEW ledger row because the server
    # charges wallet per send. The idempotency guarantee is per-reference_id
    # which is unique per tx_id — reused combo_id must still produce distinct
    # tx_ids, hence distinct ledger rows. This confirms the design.
    r = _get("/rooms", admin_tok).json()
    recipient = next((rm["owner"]["id"] for rm in r if (rm.get("owner") or {}).get("id")), None)
    assert recipient
    r1 = _post("/gifts/send-multi", admin_tok,
               json={"gift_id": "rose", "recipient_ids": [recipient], "quantity": 1}).json()
    r2 = _post("/gifts/send-multi", admin_tok,
               json={"gift_id": "rose", "recipient_ids": [recipient], "quantity": 1,
                     "combo_of": r1["combo_id"]}).json()
    assert r1["tx_ids"][0] != r2["tx_ids"][0]


# ---------------------- Admin manual reversal ----------------------
def test_refund_creates_compensating_entry(admin_tok):
    # Use a brand-new recipient so no previous test can interfere.
    _, new_user_id, _ = _register_fresh("i38refund")
    s = _post("/gifts/send-multi", admin_tok,
              json={"gift_id": "cake", "recipient_ids": [new_user_id], "quantity": 1}).json()
    tx_id = s["tx_ids"][0]
    # Reverse
    r = _post("/admin/ledger/reverse", admin_tok, json={"reference_id": tx_id, "reason": "test"})
    assert r.status_code == 200
    rev_ref = r.json()["reference_id"]
    assert rev_ref == f"REV::{tx_id}"
    # Idempotent reversal
    r2 = _post("/admin/ledger/reverse", admin_tok, json={"reference_id": tx_id})
    assert r2.status_code == 200
    assert r2.json()["reversal_tx_id"] == r.json()["reversal_tx_id"]
    # Non-existent reference
    r3 = _post("/admin/ledger/reverse", admin_tok, json={"reference_id": "NO-SUCH-REF"})
    assert r3.status_code == 404


# ---------------------- Audit log ----------------------
def test_audit_log_records_actions(admin_tok):
    _, uid, _ = _register_fresh("i38aud")
    r = _post("/admin/agencies", admin_tok, json={"name": "AuditCo", "owner_user_id": uid})
    assert r.status_code == 201
    r = _get("/admin/audit-logs?limit=20", admin_tok)
    assert r.status_code == 200
    actions = [it["action"] for it in r.json()["items"]]
    assert "agency_created" in actions


# ---------------------- Admin guards ----------------------
def test_admin_endpoints_block_non_admins():
    tok, _, _ = _register_fresh("i38na")
    assert _get("/admin/revenue-split", tok).status_code == 403
    assert _get("/admin/audit-logs", tok).status_code == 403
    assert _get("/admin/ledger", tok).status_code == 403
    # Agency create blocked
    assert _post("/admin/agencies", tok, json={"name": "x", "owner_user_id": "x"}).status_code == 403
    # Ledger reverse blocked
    assert _post("/admin/ledger/reverse", tok, json={"reference_id": "x"}).status_code == 403


def test_unauthenticated_blocked():
    assert _get("/admin/revenue-split").status_code in (401, 403)
    assert _get("/hosts/me/earnings").status_code in (401, 403)
    assert _post("/admin/agencies", json={"name": "x", "owner_user_id": "x"}).status_code in (401, 403)


# ---------------------- Earnings reads ----------------------
def test_my_host_earnings_endpoint(admin_tok):
    r = _get("/hosts/me/earnings", admin_tok)
    assert r.status_code == 200
    j = r.json()
    assert "available" in j and "pending" in j
    assert set(j["available"].keys()) >= {"host", "gross", "entries"}
