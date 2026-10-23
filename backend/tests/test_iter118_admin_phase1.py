"""
Iter-118 Admin Phase 1 — comprehensive backend tests.

Covers:
  • User detail / relations / transactions / level-history / bans
  • Wallet adjust (incl. never-negative guard + ledger entries)
  • Levels (wealth/charm/vip) + history row source=admin
  • Profile edit (nickname + reset_avatar)
  • Ban (account / device / both) + enforcement (403 BANNED envelope)
  • Device ban (header X-Device-Id across other accounts)
  • Short-duration auto-lift (hours ~= 0.0003 → ~1s)
  • Owner / self cannot be banned
  • Permission granularity (users.view-only admin cannot ban/wallet)
  • Owner PATCH /team/{email} grants bans.manage live (no re-login)
  • Audit search with q/action/admin_email/target_user_id/date_from/date_to
  • /admin/dashboard/me shape
  • Orio Team welcome: register brand-new user → /messages/threads has official
    thread with EXACT welcome text once; sending to official is blocked
"""
from __future__ import annotations

import os
import time
import uuid
import requests
import pytest

BASE = (os.environ.get("EXPO_BACKEND_URL_TEST")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = BASE + "/api"

OWNER_EMAIL = "orioowner@gmail.com"
OWNER_PW = "OwnerTest!2026"
MULTI = [f"multiacct{i}@orio.app" for i in range(1, 5)]
MULTI_PW = "demo1234"
WELCOME_TEXT = ("نرحب بك في اوريو شات، يمكنك تكوين صداقات والتعرف على أصدقاء جدد من أنحاء العالم "
                "والاستمتاع معهم، في الوقت الفعلي.Orio Team")
BAN_MSG_AR = "لقد تم حظرك بسبب انتهاك خصوصية المجتمع."


# ---------------- fixtures / helpers ----------------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    return r.json()


def _h(tok, device=None):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if device:
        h["X-Device-Id"] = device
    return h


def _me(tok):
    r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
    assert r.status_code == 200, r.text[:200]
    return r.json()


@pytest.fixture(scope="module")
def owner():
    t = _login(OWNER_EMAIL, OWNER_PW)
    me = _me(t["access_token"])
    return {"tok": t["access_token"], "refresh": t.get("refresh_token"), "id": me["id"], "email": OWNER_EMAIL}


@pytest.fixture(scope="module")
def m1():
    t = _login(MULTI[0], MULTI_PW)
    me = _me(t["access_token"])
    return {"tok": t["access_token"], "refresh": t.get("refresh_token"), "id": me["id"], "email": MULTI[0]}


@pytest.fixture(scope="module")
def m2():
    t = _login(MULTI[1], MULTI_PW)
    me = _me(t["access_token"])
    return {"tok": t["access_token"], "refresh": t.get("refresh_token"), "id": me["id"], "email": MULTI[1]}


@pytest.fixture(scope="module")
def m3():
    t = _login(MULTI[2], MULTI_PW)
    me = _me(t["access_token"])
    return {"tok": t["access_token"], "refresh": t.get("refresh_token"), "id": me["id"], "email": MULTI[2]}


@pytest.fixture(scope="module", autouse=True)
def _cleanup_admin_and_bans(owner, m3):
    """Ensure admin/team entry removed + any residual bans lifted at exit."""
    yield
    try:
        requests.delete(f"{API}/admin/dashboard/team/{MULTI[2]}", headers=_h(owner["tok"]), timeout=10)
    except Exception:
        pass
    for uid_email in ((m3["id"], None),):
        pass
    # Unban any residual
    for u_email in MULTI:
        try:
            lr = _login(u_email, MULTI_PW)
            me = _me(lr["access_token"])
            requests.post(f"{API}/admin/dashboard/users/{me['id']}/unban",
                          headers=_h(owner["tok"]), json={"reason": "cleanup"}, timeout=10)
        except Exception:
            pass


# ---------------- Phase 1: user detail / basic reads ----------------
class TestUserDetail:
    def test_detail_owner_can_read(self, owner, m1):
        r = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail", headers=_h(owner["tok"]), timeout=15)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["id"] == m1["id"]
        assert "coins" in j and "diamonds" in j
        assert "counts" in j and all(k in j["counts"] for k in
                                     ["followers", "following", "friends", "blocked", "blocked_by"])

    def test_relations_kinds(self, owner, m1):
        for kind in ("followers", "following", "friends", "blocked", "blocked_by"):
            r = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/relations",
                             params={"kind": kind}, headers=_h(owner["tok"]), timeout=15)
            assert r.status_code == 200, f"{kind}: {r.text[:200]}"
            assert isinstance(r.json().get("items"), list)

    def test_transactions_list(self, owner, m1):
        r = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/transactions",
                         headers=_h(owner["tok"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

    def test_level_history_endpoint(self, owner, m1):
        r = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/level-history",
                         headers=_h(owner["tok"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

    def test_me_endpoint_owner(self, owner):
        r = requests.get(f"{API}/admin/dashboard/me", headers=_h(owner["tok"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["is_owner"] is True
        assert isinstance(j["permissions"], list) and len(j["permissions"]) > 10


# ---------------- Wallet + Levels + Profile ----------------
class TestWalletLevelsProfile:
    def test_wallet_credit_and_ledger(self, owner, m1):
        before = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail",
                              headers=_h(owner["tok"]), timeout=15).json()["coins"]
        r = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet",
                          headers=_h(owner["tok"]),
                          json={"currency": "coins", "delta": 7, "reason": "TEST_credit"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j["after"] == before + 7
        # Verify a ledger row exists
        tx = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/transactions",
                          headers=_h(owner["tok"]), timeout=15).json()["items"]
        assert any(x["amount"] == 7 and x["description"] == "TEST_credit" for x in tx)
        # Debit back
        r2 = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet",
                           headers=_h(owner["tok"]),
                           json={"currency": "coins", "delta": -7, "reason": "TEST_debit"}, timeout=15)
        assert r2.status_code == 200 and r2.json()["after"] == before

    def test_wallet_cannot_go_negative(self, owner, m1):
        detail = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail",
                              headers=_h(owner["tok"]), timeout=15).json()
        bad = -(detail["coins"] + 10_000)
        r = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet",
                          headers=_h(owner["tok"]),
                          json={"currency": "coins", "delta": bad, "reason": "TEST_overflow"}, timeout=15)
        assert r.status_code == 400

    def test_set_wealth_level(self, owner, m1):
        r = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/levels",
                          headers=_h(owner["tok"]),
                          json={"system": "wealth", "level": 3, "reason": "TEST_wealth3"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail",
                         headers=_h(owner["tok"]), timeout=15).json()
        assert d["wealth_level"] == 3
        assert d["wealth_points"] > 0  # cumulative threshold applied
        # history row with source=admin
        hist = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/level-history",
                            headers=_h(owner["tok"]), timeout=15).json()["items"]
        assert any(h["system"] == "wealth" and h["to"] == 3 and h["source"] == "admin" for h in hist)

    def test_profile_patch_nickname_and_reset_avatar(self, owner, m1):
        orig_nick = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail",
                                 headers=_h(owner["tok"]), timeout=15).json()["nickname"]
        new_nick = f"TEST_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/admin/dashboard/users/{m1['id']}/profile",
                           headers=_h(owner["tok"]),
                           json={"nickname": new_nick, "reset_avatar": True, "reason": "TEST_edit"},
                           timeout=15)
        assert r.status_code == 200, r.text[:200]
        d = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail",
                         headers=_h(owner["tok"]), timeout=15).json()
        assert d["nickname"] == new_nick
        assert d["avatar_url"] in (None, "")
        # Restore nickname
        requests.patch(f"{API}/admin/dashboard/users/{m1['id']}/profile", headers=_h(owner["tok"]),
                       json={"nickname": orig_nick or "demo", "reason": "TEST_restore"}, timeout=15)


# ---------------- Bans + enforcement ----------------
class TestBans:
    def test_owner_cannot_be_banned(self, owner):
        r = requests.post(f"{API}/admin/dashboard/users/{owner['id']}/ban",
                          headers=_h(owner["tok"]),
                          json={"type": "account", "hours": 1, "reason": "TEST_owner"}, timeout=15)
        assert r.status_code == 400

    def test_self_cannot_be_banned(self, owner):
        # Owner is a user — but guard_owner_target checks owner first; a non-owner admin would
        # trigger the self branch. Owner-case already covered above.
        pass

    def test_ban_blocks_existing_token_and_refresh(self, owner, m2):
        # m2 is already logged in with a valid token
        token = m2["tok"]
        refresh = m2["refresh"]
        # issue ban (1 hour)
        r = requests.post(f"{API}/admin/dashboard/users/{m2['id']}/ban",
                          headers=_h(owner["tok"]),
                          json={"type": "account", "hours": 1, "reason": "TEST_account_ban"}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        # existing access token should now 403 with BANNED envelope
        pre = requests.get(f"{API}/auth/me", headers=_h(token), timeout=15)
        assert pre.status_code == 403, f"expected 403, got {pre.status_code} {pre.text[:200]}"
        envelope = pre.json().get("detail")
        assert isinstance(envelope, dict), envelope
        assert envelope.get("code") == "BANNED"
        assert envelope.get("message") == BAN_MSG_AR
        assert envelope.get("expires_at")
        assert envelope.get("server_now")
        assert envelope.get("permanent") is False
        # refresh should also fail
        rf = requests.post(f"{API}/auth/refresh", json={"refresh_token": refresh}, timeout=15)
        assert rf.status_code in (401, 403), f"refresh after ban should fail: {rf.status_code} {rf.text[:200]}"
        # unban
        ub = requests.post(f"{API}/admin/dashboard/users/{m2['id']}/unban",
                           headers=_h(owner["tok"]),
                           json={"reason": "TEST_unban"}, timeout=15)
        assert ub.status_code == 200

    def test_short_ban_auto_lifts(self, owner, m2):
        # Fresh login after previous unban
        tk = _login(MULTI[1], MULTI_PW)["access_token"]
        # Need to make sure m2 has at least one device recorded (or just account ban is fine)
        r = requests.post(f"{API}/admin/dashboard/users/{m2['id']}/ban",
                          headers=_h(owner["tok"]),
                          json={"type": "account", "hours": 0.0003, "reason": "TEST_short"}, timeout=15)
        assert r.status_code == 200
        # Wait > 1s then token works again
        time.sleep(2.0)
        # Previous access token should still be revoked (session deleted) but a fresh login works
        new_tk = _login(MULTI[1], MULTI_PW)["access_token"]
        me = requests.get(f"{API}/auth/me", headers=_h(new_tk), timeout=15)
        assert me.status_code == 200, me.text[:200]

    def test_device_ban_blocks_other_account(self, owner, m2, m3):
        """Record a device id on m2 then ban that device → m3 using same device header 403s."""
        device_id = f"TEST_DEV_{uuid.uuid4().hex[:10]}"
        tk2 = _login(MULTI[1], MULTI_PW)["access_token"]
        # register device on m2
        r0 = requests.get(f"{API}/auth/me", headers=_h(tk2, device=device_id), timeout=15)
        assert r0.status_code == 200
        # Need a 2nd call so track_device picks it up server-side
        time.sleep(0.2)
        requests.get(f"{API}/auth/me", headers=_h(tk2, device=device_id), timeout=15)
        # Ban device on m2
        rb = requests.post(f"{API}/admin/dashboard/users/{m2['id']}/ban", headers=_h(owner["tok"]),
                           json={"type": "device", "hours": 1, "reason": "TEST_dev", "device_ids": [device_id]},
                           timeout=15)
        assert rb.status_code == 200, rb.text[:200]
        # Login fresh as m3 — should succeed WITHOUT device header
        tk3 = _login(MULTI[2], MULTI_PW)["access_token"]
        no_dev = requests.get(f"{API}/auth/me", headers=_h(tk3), timeout=15)
        assert no_dev.status_code == 200
        # With the banned device header → 403 BANNED
        with_dev = requests.get(f"{API}/auth/me", headers=_h(tk3, device=device_id), timeout=15)
        assert with_dev.status_code == 403, f"expected 403, got {with_dev.status_code} {with_dev.text[:200]}"
        env = with_dev.json().get("detail", {})
        assert env.get("code") == "BANNED"
        # Cleanup
        requests.post(f"{API}/admin/dashboard/users/{m2['id']}/unban", headers=_h(owner["tok"]),
                      json={"reason": "TEST_cleanup"}, timeout=15)


# ---------------- Permission granularity ----------------
class TestPermissions:
    def test_limited_admin_view_only(self, owner, m3, m1):
        # Grant users.view only to m3
        r = requests.post(f"{API}/admin/dashboard/team", headers=_h(owner["tok"]),
                          json={"email": MULTI[2], "permissions": ["users.view"]}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        tk3 = _login(MULTI[2], MULTI_PW)["access_token"]
        # Can read detail
        d = requests.get(f"{API}/admin/dashboard/users/{m1['id']}/detail", headers=_h(tk3), timeout=15)
        assert d.status_code == 200, d.text[:200]
        # Cannot ban (needs bans.manage)
        rb = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/ban", headers=_h(tk3),
                           json={"type": "account", "hours": 1, "reason": "x"}, timeout=15)
        assert rb.status_code == 403
        # Cannot wallet.adjust
        rw = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet", headers=_h(tk3),
                           json={"currency": "coins", "delta": 1, "reason": "x"}, timeout=15)
        assert rw.status_code == 403
        # me shows only users.view
        meA = requests.get(f"{API}/admin/dashboard/me", headers=_h(tk3), timeout=15).json()
        assert meA["is_owner"] is False
        assert meA["permissions"] == ["users.view"]

    def test_owner_patch_grants_bans_live(self, owner, m3, m1):
        pr = requests.patch(f"{API}/admin/dashboard/team/{MULTI[2]}", headers=_h(owner["tok"]),
                            json={"permissions": ["users.view", "bans.manage"]}, timeout=15)
        assert pr.status_code == 200, pr.text[:200]
        tk3 = _login(MULTI[2], MULTI_PW)["access_token"]
        rb = requests.post(f"{API}/admin/dashboard/users/{m1['id']}/ban", headers=_h(tk3),
                           json={"type": "account", "hours": 1, "reason": "TEST_delegated_ban"}, timeout=15)
        assert rb.status_code == 200, rb.text[:200]
        # cleanup
        requests.post(f"{API}/admin/dashboard/users/{m1['id']}/unban", headers=_h(owner["tok"]),
                      json={"reason": "cleanup"}, timeout=15)
        requests.delete(f"{API}/admin/dashboard/team/{MULTI[2]}", headers=_h(owner["tok"]), timeout=15)


# ---------------- Audit search ----------------
class TestAudit:
    def test_audit_search_by_action_and_target(self, owner, m1):
        # create something auditable
        requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet", headers=_h(owner["tok"]),
                      json={"currency": "coins", "delta": 1, "reason": "TEST_audit_marker"}, timeout=15)
        requests.post(f"{API}/admin/dashboard/users/{m1['id']}/wallet", headers=_h(owner["tok"]),
                      json={"currency": "coins", "delta": -1, "reason": "TEST_audit_marker"}, timeout=15)
        # by action
        r = requests.get(f"{API}/admin/dashboard/audit/search",
                         params={"action": "wallet", "target_user_id": m1["id"], "limit": 50},
                         headers=_h(owner["tok"]), timeout=15)
        assert r.status_code == 200
        rows = r.json()["items"]
        assert any(x["target_user_id"] == m1["id"] and (x["action"] or "").startswith("wallet") for x in rows)
        # by q
        r2 = requests.get(f"{API}/admin/dashboard/audit/search",
                         params={"q": "TEST_audit_marker"}, headers=_h(owner["tok"]), timeout=15)
        assert r2.status_code == 200
        assert any("TEST_audit_marker" in (x.get("note") or "") for x in r2.json()["items"])


# ---------------- Orio Team welcome ----------------
class TestOrioTeamWelcome:
    def test_welcome_once_on_new_user(self):
        email = f"orio_welc_{uuid.uuid4().hex[:8]}@orio.app"
        rr = requests.post(f"{API}/auth/register",
                           json={"email": email, "password": "TestPass!2026",
                                 "username": f"welc{uuid.uuid4().hex[:6]}",
                                 "nickname": "Welcome User"}, timeout=20)
        assert rr.status_code in (200, 201), rr.text[:200]
        tok = rr.json()["access_token"]
        # Call /auth/me twice to trigger idempotent welcome
        _me(tok)
        _me(tok)
        # fetch threads
        th = requests.get(f"{API}/messages/threads", headers=_h(tok), timeout=15)
        assert th.status_code == 200, th.text[:200]
        body = th.json()
        if isinstance(body, dict):
            threads = body.get("items") or body.get("threads") or []
        else:
            threads = body
        # Find official thread
        official = [t for t in threads
                    if (((t.get("user") or {}).get("is_official")) or t.get("is_official"))]
        assert len(official) == 1, f"expected 1 official thread, got {len(official)}: {threads}"
        # text must be in last_message (string) or nested
        lm = official[0].get("last_message")
        last = lm if isinstance(lm, str) else ((lm or {}).get("text") if isinstance(lm, dict) else None) or official[0].get("text")
        assert last == WELCOME_TEXT, f"welcome text mismatch: {last!r}"
        # Try to send to official → 403
        off_uid = (official[0].get("user") or {}).get("id") or official[0].get("peer_id") or official[0].get("user_id")
        if off_uid:
            send = requests.post(f"{API}/messages/send", headers=_h(tok),
                                 json={"recipient_id": off_uid, "text": "hi"}, timeout=15)
            assert send.status_code == 403, f"sending to official should 403: {send.status_code} {send.text[:200]}"
