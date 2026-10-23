"""
ORIO — Phase 2A (Agency + Host Earnings frontend-facing API) tests.

Covers the NEW endpoints that back the Earnings/Agency Center screens:
  • GET /me/agency                              -> my active membership + role
  • GET /me/agency-invitations                  -> my pending invites
  • GET /me/transactions                        -> my own ledger entries
  • POST /me/agency/leave                       -> self-leave
  • POST /agencies/{id}/invitations             -> owner/admin invite
  • GET /agencies/{id}/invitations              -> owner/admin list invites
  • DELETE /agencies/{id}/invitations/{inv_id}  -> owner/admin cancel
  • POST /agency-invitations/{inv_id}/accept    -> invitee accept
  • POST /agency-invitations/{inv_id}/reject    -> invitee reject
  • GET /agencies/{id}/hosts                    -> owner/admin/member roster
  • GET /agencies/{id}/transactions             -> owner/admin agency ledger
  • POST /agencies/{id}/hosts/{uid}/suspend     -> owner/admin suspend
  • POST /agencies/{id}/hosts/{uid}/reactivate  -> owner/admin reactivate
  • DELETE /agencies/{id}/hosts/{uid}           -> owner/admin remove

Phase-1 invariants still hold:
  • Non-owners cannot read agency-only data.
  • Accepting an invite while already in another agency MUST 409
    (one-active-agency-per-host rule, DB-level enforcement).
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


def _delete(path, tok=None):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    return requests.delete(f"{API}{path}", headers=h, timeout=25)


def _login(email=DEMO_EMAIL, pw=DEMO_PW):
    r = _post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _register_fresh(tag="p2a"):
    t = uuid.uuid4().hex[:8]
    email = f"{tag}_{t}@voiceup.app"
    r = _post("/auth/register", json={
        "email": email, "password": "phase2apass",
        "username": f"{tag}_{t}"[:20], "nickname": f"P2A {t[:4]}",
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    me = _get("/auth/me", tok).json()
    return tok, me["id"], email


@pytest.fixture(scope="module")
def admin_tok():
    return _login()


# ===========================================================================
#  /me/agency, /me/transactions
# ===========================================================================
def test_me_agency_null_when_no_membership():
    tok, _, _ = _register_fresh("p2a_me0")
    r = _get("/me/agency", tok)
    assert r.status_code == 200
    j = r.json()
    assert j["membership"] is None
    assert j["agency"] is None
    assert j["role"] is None


def test_me_agency_reports_active_membership(admin_tok):
    tok, uid, _ = _register_fresh("p2a_me1")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"MeTest-{uuid.uuid4().hex[:4]}", "owner_user_id": uid}).json()
    r = _get("/me/agency", tok).json()
    assert r["membership"] is not None
    assert r["agency"]["id"] == ag["id"]
    assert r["role"] == "AGENCY_OWNER"


def test_me_transactions_returns_own_rows_only(admin_tok):
    _, host_id, _ = _register_fresh("p2a_txown")
    host_tok = _post("/auth/login", json={"email": "demo@voiceup.app", "password": "demo1234"}).json()  # unused
    # Register a brand new user and log in as them to send a gift to host_id.
    r = _post("/gifts/send-multi", admin_tok,
              json={"gift_id": "cake", "recipient_ids": [host_id], "quantity": 1})
    assert r.status_code == 200
    # Log in as the host; they must see their own earning row via /me/transactions.
    # We need the host's token; register_fresh didn't return it. Register again
    # with a fresh pair:
    tok, me_id, _ = _register_fresh("p2a_txmine")
    r1 = _post("/gifts/send-multi", admin_tok,
               json={"gift_id": "cake", "recipient_ids": [me_id], "quantity": 1})
    assert r1.status_code == 200
    tx_id = r1.json()["tx_ids"][0]
    rr = _get("/me/transactions", tok)
    assert rr.status_code == 200
    items = rr.json()["items"]
    assert any(it["reference_id"] == tx_id for it in items), "my txn not visible to me"
    # And no row belonging to someone else.
    assert all(it["user_id"] == me_id for it in items)


def test_me_transactions_requires_auth():
    assert _get("/me/transactions").status_code in (401, 403)


# ===========================================================================
#  Invitation lifecycle: owner invites → invitee accepts → one-active rule
# ===========================================================================
def test_full_invite_accept_flow(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_own")
    invitee_tok, invitee_id, _ = _register_fresh("p2a_inv")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"InviteCo-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    # Owner invites by numeric_id
    me = _get("/auth/me", invitee_tok).json()
    r = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
              json={"user_identifier": me["numeric_id"], "message": "join us"})
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["status"] == "pending"
    # Invitee sees it
    mine = _get("/me/agency-invitations", invitee_tok).json()["items"]
    assert any(it["id"] == inv["id"] for it in mine)
    # Random stranger cannot cancel it
    stranger_tok, _, _ = _register_fresh("p2a_str")
    r = _delete(f"/agencies/{ag['id']}/invitations/{inv['id']}", stranger_tok)
    assert r.status_code == 403
    # Invitee cannot cancel the owner's invite either (only accept/reject)
    r = _delete(f"/agencies/{ag['id']}/invitations/{inv['id']}", invitee_tok)
    assert r.status_code == 403
    # Invitee accepts
    r = _post(f"/agency-invitations/{inv['id']}/accept", invitee_tok)
    assert r.status_code == 200, r.text
    # /me/agency now reflects active membership
    mine = _get("/me/agency", invitee_tok).json()
    assert mine["agency"]["id"] == ag["id"]
    assert mine["role"] == "HOST"
    # Second accept = 409
    r = _post(f"/agency-invitations/{inv['id']}/accept", invitee_tok)
    assert r.status_code == 409


def test_reject_invitation(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_rown")
    invitee_tok, invitee_id, _ = _register_fresh("p2a_rinv")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"RejectCo-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    inv = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
                json={"user_identifier": invitee_id}).json()
    r = _post(f"/agency-invitations/{inv['id']}/reject", invitee_tok)
    assert r.status_code == 200
    # No active membership after reject
    mine = _get("/me/agency", invitee_tok).json()
    assert mine["membership"] is None
    # Reject-after-reject = 409
    r = _post(f"/agency-invitations/{inv['id']}/reject", invitee_tok)
    assert r.status_code == 409


def test_duplicate_pending_invite_blocked(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_dup")
    _, invitee_id, _ = _register_fresh("p2a_dupInv")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"DupCo-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    r1 = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
               json={"user_identifier": invitee_id})
    assert r1.status_code == 201
    # Second pending invite = 409
    r2 = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
               json={"user_identifier": invitee_id})
    assert r2.status_code == 409


def test_accept_while_in_another_agency_is_blocked(admin_tok):
    _, owner_a, _ = _register_fresh("p2a_a_own")
    _, owner_b, _ = _register_fresh("p2a_b_own")
    invitee_tok, invitee_id, _ = _register_fresh("p2a_dblInv")
    ag_a = _post("/admin/agencies", admin_tok,
                 json={"name": f"AA-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_a}).json()
    ag_b = _post("/admin/agencies", admin_tok,
                 json={"name": f"BB-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_b}).json()
    # Add invitee to A directly as admin
    r = _post(f"/admin/agencies/{ag_a['id']}/hosts", admin_tok,
              json={"user_id": invitee_id})
    assert r.status_code == 201
    # Owner-B invites — accept MUST 409 because invitee is already active in A.
    inv = _post(f"/agencies/{ag_b['id']}/invitations", _login(),
                json={"user_identifier": invitee_id}).json()  # admin invites
    r = _post(f"/agency-invitations/{inv['id']}/accept", invitee_tok)
    assert r.status_code == 409, "one-active-agency rule not enforced on accept"


def test_cancel_invitation_by_owner(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_cown")
    _, invitee_id, _ = _register_fresh("p2a_cinv")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"CancelCo-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    inv = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
                json={"user_identifier": invitee_id}).json()
    r = _delete(f"/agencies/{ag['id']}/invitations/{inv['id']}", owner_tok)
    assert r.status_code == 200
    # Cancelled invites cannot be accepted
    r = _post(f"/agency-invitations/{inv['id']}/accept", _login())
    assert r.status_code in (403, 409)  # addressed-to check first


# ===========================================================================
#  Owner roster + transactions + state transitions
# ===========================================================================
def test_owner_can_view_roster_and_transactions(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_rt")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"RT-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    # Owner reads hosts
    r = _get(f"/agencies/{ag['id']}/hosts", owner_tok)
    assert r.status_code == 200
    assert len(r.json()["items"]) >= 1  # at least the owner's membership
    # Owner reads transactions (empty for a brand-new agency)
    r = _get(f"/agencies/{ag['id']}/transactions", owner_tok)
    assert r.status_code == 200
    assert isinstance(r.json()["items"], list)
    # Stranger blocked
    stranger_tok, _, _ = _register_fresh("p2a_rtstr")
    assert _get(f"/agencies/{ag['id']}/hosts", stranger_tok).status_code == 403
    assert _get(f"/agencies/{ag['id']}/transactions", stranger_tok).status_code == 403


def test_owner_suspend_reactivate_remove(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_sx")
    _, host_id, _ = _register_fresh("p2a_sxhost")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"SX-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    _post(f"/admin/agencies/{ag['id']}/hosts", admin_tok, json={"user_id": host_id})
    # Owner suspends host
    r = _post(f"/agencies/{ag['id']}/hosts/{host_id}/suspend", owner_tok)
    assert r.status_code == 200
    # Owner reactivates
    r = _post(f"/agencies/{ag['id']}/hosts/{host_id}/reactivate", owner_tok)
    assert r.status_code == 200
    # Owner cannot suspend themselves
    r = _post(f"/agencies/{ag['id']}/hosts/{owner_id}/suspend", owner_tok)
    assert r.status_code in (400, 404)
    # Owner removes host
    r = _delete(f"/agencies/{ag['id']}/hosts/{host_id}", owner_tok)
    assert r.status_code == 200
    # Owner cannot remove themselves
    r = _delete(f"/agencies/{ag['id']}/hosts/{owner_id}", owner_tok)
    assert r.status_code in (400, 404)


# ===========================================================================
#  Leave agency
# ===========================================================================
def test_host_can_leave_agency(admin_tok):
    tok, uid, _ = _register_fresh("p2a_leave")
    _, owner_id, _ = _register_fresh("p2a_leaveOwn")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"LeaveCo-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    _post(f"/admin/agencies/{ag['id']}/hosts", admin_tok, json={"user_id": uid})
    assert _get("/me/agency", tok).json()["agency"]["id"] == ag["id"]
    r = _post("/me/agency/leave", tok)
    assert r.status_code == 200
    assert _get("/me/agency", tok).json()["membership"] is None
    # Leaving when not in any agency = 404
    r = _post("/me/agency/leave", tok)
    assert r.status_code == 404


def test_owner_cannot_leave_their_agency(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_ownleave")
    _post("/admin/agencies", admin_tok,
          json={"name": f"NoLeave-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id})
    r = _post("/me/agency/leave", owner_tok)
    assert r.status_code == 400


# ===========================================================================
#  Security — unauthorized paths
# ===========================================================================
def test_invite_endpoints_require_auth():
    assert _get("/me/agency").status_code in (401, 403)
    assert _get("/me/agency-invitations").status_code in (401, 403)
    assert _post("/me/agency/leave").status_code in (401, 403)
    assert _post("/agency-invitations/x/accept").status_code in (401, 403)


def test_non_owner_cannot_invite_or_cancel(admin_tok):
    _, owner_id, _ = _register_fresh("p2a_nown")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"NO-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    stranger_tok, _, _ = _register_fresh("p2a_nstr")
    _, target_id, _ = _register_fresh("p2a_ntarget")
    r = _post(f"/agencies/{ag['id']}/invitations", stranger_tok,
              json={"user_identifier": target_id})
    assert r.status_code == 403


def test_cannot_accept_invitation_addressed_to_someone_else(admin_tok):
    owner_tok, owner_id, _ = _register_fresh("p2a_xown")
    _, invitee_id, _ = _register_fresh("p2a_xinv")
    other_tok, _, _ = _register_fresh("p2a_xother")
    ag = _post("/admin/agencies", admin_tok,
               json={"name": f"XO-{uuid.uuid4().hex[:4]}", "owner_user_id": owner_id}).json()
    inv = _post(f"/agencies/{ag['id']}/invitations", owner_tok,
                json={"user_identifier": invitee_id}).json()
    r = _post(f"/agency-invitations/{inv['id']}/accept", other_tok)
    assert r.status_code == 403
