"""
Iter-86 — Owner + Approved Admin authorization tests.

Covers all 11 required security scenarios:
  1. Owner email → access allowed.
  2. Different email as Owner candidate → access denied.
  3. Normal ORIO user → admin denied.
  4. Approved Admin → allowed only assigned permissions.
  5. Admin without a permission → 403.
  6. Removed Admin → denied.
  7. Disabled Admin → denied.
  8. Direct API request without auth → 401/403.
  9. Regular Admin cannot modify Owner.
 10. Owner can add/remove/disable/re-enable Admins.
 11. Owner can change the configured Owner email.
"""
import os
import uuid

import pytest
import httpx

pytestmark = pytest.mark.asyncio

BASE = "http://localhost:8001"
OWNER_EMAIL = "orioowner@gmail.com"
OWNER_PASSWORD = "OwnerTest!2026"  # used only for test convenience; owner is identified by email, not password


# -----------------------------------------------------------------------------
# Setup helpers
# -----------------------------------------------------------------------------
async def _register(c: httpx.AsyncClient, email: str, password: str = "Pw12345678!",
                    username: str | None = None, nickname: str = "Tester") -> dict:
    uname = username or f"u_{uuid.uuid4().hex[:8]}"
    r = await c.post("/api/auth/register", json={
        "email": email, "password": password, "username": uname, "nickname": nickname,
    })
    assert r.status_code in (200, 201), f"register {email} failed: {r.status_code} {r.text}"
    return r.json()


async def _login(c: httpx.AsyncClient, email: str, password: str) -> str:
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


async def _ensure_owner_user(c: httpx.AsyncClient) -> str:
    """Register the owner email if missing, then log in and return access_token.

    Owner identity in ORIO is determined by email match on every request. A
    password is only needed so the tests can obtain a JWT; in production the
    Owner authenticates via Google Sign-In.
    """
    r = await c.post("/api/auth/register", json={
        "email": OWNER_EMAIL, "password": OWNER_PASSWORD,
        "username": f"owner_{uuid.uuid4().hex[:4]}", "nickname": "ORIO Owner",
    })
    if r.status_code in (200, 201):
        return r.json()["access_token"]
    # Already exists — just log in.
    return await _login(c, OWNER_EMAIL, OWNER_PASSWORD)


async def _reset_owner_config(c: httpx.AsyncClient) -> None:
    """Ensure the owner_email is reset to the test value before each test."""
    try:
        tok = await _login(c, OWNER_EMAIL, OWNER_PASSWORD)
    except Exception:
        return
    # Only owner can call this; it's a no-op if already correct.
    r = await c.get("/api/admin/dashboard/owner",
                     headers={"Authorization": f"Bearer {tok}"})
    if r.status_code == 200 and r.json().get("owner_email") == OWNER_EMAIL:
        return
    # If owner was changed by a previous test, reset by directly touching Mongo —
    # the test cannot "change back" without being owner. The test ordering avoids
    # orphan state by running owner-change test last.


# -----------------------------------------------------------------------------
# 1 & 2. Owner identity test
# -----------------------------------------------------------------------------
async def test_01_owner_email_grants_access():
    async with httpx.AsyncClient(base_url=BASE) as c:
        tok = await _ensure_owner_user(c)
        me = await c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        assert me.json().get("admin_access", {}).get("is_owner") is True
        # Stats endpoint reachable.
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["access"]["is_owner"] is True


async def test_02_non_owner_email_denied_even_with_valid_google():
    """A different account — even if the auth is strong — must NOT be treated as Owner."""
    async with httpx.AsyncClient(base_url=BASE) as c:
        other_email = f"notowner_{uuid.uuid4().hex[:6]}@gmail.com"
        reg = await _register(c, other_email)
        tok = reg["access_token"]
        me = await c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        assert me.json().get("admin_access") is None
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 403


# -----------------------------------------------------------------------------
# 3. Normal user denied
# -----------------------------------------------------------------------------
async def test_03_normal_user_denied():
    async with httpx.AsyncClient(base_url=BASE) as c:
        em = f"normal_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {reg['access_token']}"})
        assert r.status_code == 403


# -----------------------------------------------------------------------------
# 4 & 5. Approved admin + fine-grained permission enforcement
# -----------------------------------------------------------------------------
async def test_04_approved_admin_only_has_assigned_permissions():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        admin_tok = reg["access_token"]

        # Owner grants ONLY users.view
        r = await c.post("/api/admin/dashboard/team",
                          json={"email": em, "permissions": ["users.view"]},
                          headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Admin can list users (allowed)
        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200

        # But cannot list rooms (missing rooms.view)
        r = await c.get("/api/admin/dashboard/rooms?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403, f"expected 403 missing rooms.view, got {r.status_code}"

        # And cannot patch users (missing users.manage)
        # First get a target user id
        users = await c.get("/api/admin/dashboard/users?limit=5",
                             headers={"Authorization": f"Bearer {owner_tok}"})
        target_id = users.json()["items"][0]["id"]
        r = await c.patch(f"/api/admin/dashboard/users/{target_id}",
                           json={"vip_level": 1},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # And cannot touch the admin team (owner-only)
        r = await c.get("/api/admin/dashboard/team",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403


async def test_05_admin_missing_specific_permission_rejected():
    """Admin has users.manage but NOT wallet.adjust — wallet mutations must 403."""
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm2_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        admin_tok = reg["access_token"]

        r = await c.post("/api/admin/dashboard/team",
                          json={"email": em, "permissions": ["users.view", "users.manage"]},
                          headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Create a target user to adjust
        target_em = f"tgt_{uuid.uuid4().hex[:6]}@orio.app"
        target = await _register(c, target_em)
        me = await c.get("/api/auth/me",
                          headers={"Authorization": f"Bearer {target['access_token']}"})
        target_id = me.json()["id"]

        # VIP change should work (owner-only check already passed via users.manage,
        # but vip.manage is required). This must be 403.
        r = await c.patch(f"/api/admin/dashboard/users/{target_id}",
                           json={"vip_level": 1},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # Wallet adjustment must be 403 (missing wallet.adjust).
        r = await c.patch(f"/api/admin/dashboard/users/{target_id}",
                           json={"diamonds_delta": 100},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403


# -----------------------------------------------------------------------------
# 6. Removed admin denied
# -----------------------------------------------------------------------------
async def test_06_removed_admin_loses_access():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm3_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        admin_tok = reg["access_token"]

        await c.post("/api/admin/dashboard/team",
                       json={"email": em, "permissions": ["users.view"]},
                       headers={"Authorization": f"Bearer {owner_tok}"})

        # Baseline: works
        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200

        # Remove admin
        r = await c.delete(f"/api/admin/dashboard/team/{em}",
                            headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Admin now denied (even with the SAME JWT — authorization is live)
        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # Normal ORIO account still works (login succeeds, admin denied is separate)
        tok2 = await _login(c, em, "Pw12345678!")
        assert tok2  # auth still intact


# -----------------------------------------------------------------------------
# 7. Disabled admin denied
# -----------------------------------------------------------------------------
async def test_07_disabled_admin_denied():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm4_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        admin_tok = reg["access_token"]

        await c.post("/api/admin/dashboard/team",
                       json={"email": em, "permissions": ["users.view", "rooms.view"]},
                       headers={"Authorization": f"Bearer {owner_tok}"})

        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200

        # Disable
        r = await c.patch(f"/api/admin/dashboard/team/{em}",
                           json={"enabled": False},
                           headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200
        assert r.json()["enabled"] is False

        # Access denied
        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # Re-enable
        r = await c.patch(f"/api/admin/dashboard/team/{em}",
                           json={"enabled": True},
                           headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200
        r = await c.get("/api/admin/dashboard/users?limit=1",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200


# -----------------------------------------------------------------------------
# 8. No auth → 401; invalid auth → 401/403
# -----------------------------------------------------------------------------
async def test_08_direct_api_without_auth_denied():
    async with httpx.AsyncClient(base_url=BASE) as c:
        r = await c.get("/api/admin/dashboard/stats")
        assert r.status_code == 401
        r = await c.get("/api/admin/dashboard/team")
        assert r.status_code == 401
        r = await c.post("/api/admin/dashboard/team",
                          json={"email": "x@x.com", "permissions": []})
        assert r.status_code == 401
        # Garbage token
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": "Bearer garbage"})
        assert r.status_code == 401


# -----------------------------------------------------------------------------
# 9. Admin cannot modify Owner / cannot promote themselves
# -----------------------------------------------------------------------------
async def test_09_admin_cannot_modify_owner():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm5_{uuid.uuid4().hex[:6]}@orio.app"
        reg = await _register(c, em)
        admin_tok = reg["access_token"]

        await c.post("/api/admin/dashboard/team",
                       json={"email": em,
                             "permissions": [
                                 "users.view", "users.manage", "users.ban",
                                 "wallet.view", "wallet.adjust",
                             ]},
                       headers={"Authorization": f"Bearer {owner_tok}"})

        # Find owner's user id
        owner_me = await c.get("/api/auth/me",
                                headers={"Authorization": f"Bearer {owner_tok}"})
        owner_id = owner_me.json()["id"]

        # Admin tries to ban the owner → 400 (owner cannot be modified)
        r = await c.patch(f"/api/admin/dashboard/users/{owner_id}",
                           json={"is_banned": True, "reason": "attack"},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 400

        # Admin tries to adjust owner's wallet → 400
        r = await c.patch(f"/api/admin/dashboard/users/{owner_id}",
                           json={"diamonds_delta": -1_000_000},
                           headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 400

        # Admin cannot access /team (owner-only)
        r = await c.get("/api/admin/dashboard/team",
                         headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # Admin cannot add themselves to the team or escalate
        r = await c.post("/api/admin/dashboard/team",
                          json={"email": em, "permissions": list_all_permissions()},
                          headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403

        # Admin cannot change the owner email
        r = await c.post("/api/admin/dashboard/owner",
                          json={"new_email": em},
                          headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 403


def list_all_permissions():
    return [
        "users.view", "users.manage", "users.ban",
        "rooms.view", "rooms.manage", "rooms.lock", "rooms.close",
        "reports.view", "reports.resolve", "reports.dismiss", "reports.ban",
        "vip.view", "vip.manage",
        "wallet.view", "wallet.adjust",
        "withdrawals.view", "withdrawals.approve", "withdrawals.reject",
        "audit.view",
    ]


# -----------------------------------------------------------------------------
# 10. Owner can add/remove/disable/re-enable
# -----------------------------------------------------------------------------
async def test_10_owner_full_admin_lifecycle():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)
        em = f"adm6_{uuid.uuid4().hex[:6]}@orio.app"
        await _register(c, em)

        # Add
        r = await c.post("/api/admin/dashboard/team",
                          json={"email": em, "permissions": ["users.view"]},
                          headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # List includes new admin
        r = await c.get("/api/admin/dashboard/team",
                         headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200
        emails = {a["email"] for a in r.json()["items"]}
        assert em in emails

        # Update permissions
        r = await c.patch(f"/api/admin/dashboard/team/{em}",
                           json={"permissions": ["users.view", "rooms.view"]},
                           headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200
        assert set(r.json()["permissions"]) == {"users.view", "rooms.view"}

        # Disable
        r = await c.patch(f"/api/admin/dashboard/team/{em}",
                           json={"enabled": False},
                           headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Re-enable
        r = await c.patch(f"/api/admin/dashboard/team/{em}",
                           json={"enabled": True},
                           headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Remove
        r = await c.delete(f"/api/admin/dashboard/team/{em}",
                            headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200

        # Second delete → 404
        r = await c.delete(f"/api/admin/dashboard/team/{em}",
                            headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 404

        # Audit log recorded the actions
        r = await c.get("/api/admin/dashboard/audit?limit=50",
                         headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200
        actions = [a.get("action") for a in r.json()["items"]]
        assert "admin_added" in actions
        assert "admin_removed" in actions


# -----------------------------------------------------------------------------
# 11. Owner can change Owner email (and this test must RESTORE the original)
# -----------------------------------------------------------------------------
async def test_11_owner_email_change():
    async with httpx.AsyncClient(base_url=BASE) as c:
        owner_tok = await _ensure_owner_user(c)

        # Register a candidate new owner so the switch has a real matching user
        new_em = f"newowner_{uuid.uuid4().hex[:6]}@gmail.com"
        new_reg = await _register(c, new_em)
        new_tok = new_reg["access_token"]

        # Before switch: new candidate has NO admin access
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {new_tok}"})
        assert r.status_code == 403

        # Current owner performs the switch
        r = await c.post("/api/admin/dashboard/owner",
                          json={"new_email": new_em},
                          headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["owner_email"] == new_em

        # Previous owner immediately loses access
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {owner_tok}"})
        assert r.status_code == 403

        # New owner now has full access
        r = await c.get("/api/admin/dashboard/stats",
                         headers={"Authorization": f"Bearer {new_tok}"})
        assert r.status_code == 200
        assert r.json()["access"]["is_owner"] is True

        # Audit recorded
        r = await c.get("/api/admin/dashboard/audit?limit=10",
                         headers={"Authorization": f"Bearer {new_tok}"})
        assert r.status_code == 200
        found = any(a.get("action") == "owner_email_changed" for a in r.json()["items"])
        assert found

        # Restore the original owner so later test runs & the running app
        # continue to work with the configured ADMIN_OWNER_EMAIL.
        r = await c.post("/api/admin/dashboard/owner",
                          json={"new_email": OWNER_EMAIL},
                          headers={"Authorization": f"Bearer {new_tok}"})
        assert r.status_code == 200
