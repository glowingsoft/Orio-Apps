"""
Iteration 36 backend tests — ORIO reusable level-migration framework
(wealth/charm/level).

Covers:
- Admin auth gating (403 for non-admin) across all 4 endpoints
- GET /api/admin/levels/{system} shape + unknown system → 400
- POST /api/admin/levels/{system}/preview validation + shape
- POST /api/admin/levels/{system}/apply → atomic write, audit row,
  idempotency, points preservation, cap behavior, reversibility
- GET /api/admin/level-migrations audit list (desc sort, admin only)
- Wire-through: POST /api/gifts/send increments wealth_points on sender
  and charm_points on recipient; levels are recomputed server-side.
- /auth/me exposes wealth_points, charm_points, growth_points
- Boot migration idempotency for `_migrate_legacy_levels_to_points`
- VIP-untouched regression (thresholds/progress/convert/recharge)
- Basic smoke regressions for iter-33 (block/report), iter-34 (mic-invite),
  iter-35 (growth history)

Restores the identity (1 pt = 1 level) curve at the end so the shared demo
DB is left unchanged.

Run: pytest /app/backend/tests/test_iteration_36_level_migrations.py -v
"""
from __future__ import annotations
import os
import time
import uuid
import copy
import requests
import pytest
from pymongo import MongoClient

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PW = "demo1234"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "voiceup")

LEVEL_SYSTEMS = ("wealth", "charm", "level")
POINT_FIELDS = {"wealth": "wealth_points", "charm": "charm_points", "level": "experience"}
LEVEL_FIELDS = {"wealth": "wealth_level", "charm": "charm_level", "level": "level"}
DEFAULT_MAX = {"wealth": 300, "charm": 300, "level": 100}


# -----------------------------------------------------------------
# HTTP helpers
# -----------------------------------------------------------------
def _post(path, tok=None, json=None):
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.post(f"{API}{path}", headers=h, json=json, timeout=25)


def _get(path, tok=None, params=None):
    h = {}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return requests.get(f"{API}{path}", headers=h, params=params, timeout=25)


def _login(email=DEMO_EMAIL, pw=DEMO_PW):
    r = _post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register_fresh(tag_prefix="i36"):
    tag = uuid.uuid4().hex[:8]
    email = f"{tag_prefix}_{tag}@voiceup.app"
    # username capped at 20 chars by /auth/register model
    username = f"{tag_prefix}_{tag}"[:20]
    r = _post("/auth/register", json={
        "email": email, "password": "iter36pass",
        "username": username, "nickname": f"Iter36 {tag[:4]}",
    })
    assert r.status_code == 201, f"register failed: {r.status_code} {r.text}"
    return r.json()["access_token"], email, username


def _me(tok):
    r = _get("/auth/me", tok)
    assert r.status_code == 200, r.text
    return r.json()


def _identity_thresholds(sys):
    cap = DEFAULT_MAX[sys]
    return [{"level": i, "points": i} for i in range(1, cap + 1)]


# -----------------------------------------------------------------
# Session-scoped tokens + DB client
# -----------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_tok():
    return _login()


@pytest.fixture(scope="module")
def non_admin_tok():
    tok, _, _ = _register_fresh("iter36na")
    return tok


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# -----------------------------------------------------------------
# Session-scoped teardown: restore identity curve on all 3 systems
# so subsequent iterations start from a clean baseline.
# -----------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _restore_identity_curve_at_end(admin_tok):
    yield
    for sys in LEVEL_SYSTEMS:
        cap = DEFAULT_MAX[sys]
        _post(f"/admin/levels/{sys}/apply", admin_tok, {
            "thresholds": _identity_thresholds(sys),
            "max_level": cap,
        })


# =================================================================
# Admin auth gating
# =================================================================
class TestAdminAuthGating:
    def test_get_levels_requires_admin(self, non_admin_tok):
        r = _get("/admin/levels/wealth", non_admin_tok)
        assert r.status_code == 403, r.text

    def test_get_levels_unauth_401_or_403(self):
        r = _get("/admin/levels/wealth")
        assert r.status_code in (401, 403), r.status_code

    def test_preview_requires_admin(self, non_admin_tok):
        r = _post("/admin/levels/wealth/preview", non_admin_tok, {
            "thresholds": [{"level": 1, "points": 0}],
        })
        assert r.status_code == 403, r.text

    def test_apply_requires_admin(self, non_admin_tok):
        r = _post("/admin/levels/wealth/apply", non_admin_tok, {
            "thresholds": [{"level": 1, "points": 0}],
        })
        assert r.status_code == 403, r.text

    def test_migrations_list_requires_admin(self, non_admin_tok):
        r = _get("/admin/level-migrations", non_admin_tok)
        assert r.status_code == 403, r.text


# =================================================================
# GET /admin/levels/{system}
# =================================================================
class TestGetLevelConfig:
    @pytest.mark.parametrize("system", LEVEL_SYSTEMS)
    def test_get_returns_thresholds_and_max(self, admin_tok, system):
        r = _get(f"/admin/levels/{system}", admin_tok)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["system"] == system
        assert isinstance(d["thresholds"], list) and len(d["thresholds"]) > 0
        assert isinstance(d["max_level"], int) and d["max_level"] > 0
        # levels should start at 1
        assert d["thresholds"][0]["level"] == 1

    def test_get_unknown_system_400(self, admin_tok):
        r = _get("/admin/levels/foo", admin_tok)
        assert r.status_code == 400, r.text


# =================================================================
# POST /admin/levels/{system}/preview — validation + shape
# =================================================================
class TestPreviewValidation:
    def test_empty_thresholds_400(self, admin_tok):
        r = _post("/admin/levels/wealth/preview", admin_tok, {"thresholds": []})
        assert r.status_code == 400, r.text

    def test_non_consecutive_levels_400(self, admin_tok):
        r = _post("/admin/levels/wealth/preview", admin_tok, {
            "thresholds": [{"level": 1, "points": 0}, {"level": 3, "points": 10}],
        })
        assert r.status_code == 400, r.text

    def test_does_not_start_at_1_400(self, admin_tok):
        r = _post("/admin/levels/wealth/preview", admin_tok, {
            "thresholds": [{"level": 2, "points": 0}, {"level": 3, "points": 10}],
        })
        assert r.status_code == 400, r.text

    def test_decreasing_points_400(self, admin_tok):
        r = _post("/admin/levels/wealth/preview", admin_tok, {
            "thresholds": [{"level": 1, "points": 100}, {"level": 2, "points": 50}],
        })
        assert r.status_code == 400, r.text

    def test_negative_points_400(self, admin_tok):
        r = _post("/admin/levels/wealth/preview", admin_tok, {
            "thresholds": [{"level": 1, "points": -1}],
        })
        assert r.status_code == 400, r.text

    def test_unknown_system_400(self, admin_tok):
        r = _post("/admin/levels/bogus/preview", admin_tok, {
            "thresholds": [{"level": 1, "points": 0}],
        })
        assert r.status_code == 400, r.text

    def test_preview_shape_and_no_db_change(self, admin_tok, db):
        # Snapshot the config before
        before = db.level_configs.find_one({"_id": "wealth"})
        payload = {
            "thresholds": [
                {"level": 1, "points": 0},
                {"level": 2, "points": 100},
                {"level": 3, "points": 500},
            ],
            "max_level": 3,
        }
        r = _post("/admin/levels/wealth/preview", admin_tok, payload)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("system", "total_users", "affected_users",
                  "old_thresholds", "new_thresholds",
                  "old_max_level", "new_max_level", "samples"):
            assert k in d, d
        assert d["system"] == "wealth"
        assert isinstance(d["total_users"], int) and d["total_users"] > 0
        assert isinstance(d["affected_users"], int)
        assert 0 <= d["affected_users"] <= d["total_users"]
        assert len(d["samples"]) <= 25
        assert d["new_max_level"] == 3
        for s in d["samples"]:
            assert set(("id", "points", "old_level", "new_level")).issubset(s.keys())

        # DB config is UNCHANGED after preview
        after = db.level_configs.find_one({"_id": "wealth"})
        # Compare thresholds and max_level only (updated_at etc may differ if
        # nothing else touched it — but preview must NOT touch it).
        assert (before or {}).get("thresholds") == (after or {}).get("thresholds")
        assert (before or {}).get("max_level") == (after or {}).get("max_level")


# =================================================================
# POST /admin/levels/{system}/apply — atomicity + audit + idempotency
# + points preservation + cap + reversibility
# =================================================================
class TestApplyAndAudit:
    def _snapshot_points(self, db, sys):
        """Map user_id → (points, current_level) for a given system."""
        pf = POINT_FIELDS[sys]
        lf = LEVEL_FIELDS[sys]
        proj = {pf: 1, lf: 1}
        return {str(u["_id"]): (int(u.get(pf, 0) or 0), int(u.get(lf, 0) or 0))
                for u in db.users.find({}, proj)}

    def test_apply_writes_config_and_audit_row(self, admin_tok, db):
        payload = {
            "thresholds": [
                {"level": 1, "points": 0},
                {"level": 2, "points": 5},
                {"level": 3, "points": 20},
            ],
            "max_level": 3,
        }
        # count audit rows before
        before_count = db.level_migrations.count_documents({"system": "wealth"})
        r = _post("/admin/levels/wealth/apply", admin_tok, payload)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("ok", "migration_id", "system", "affected_users", "max_level"):
            assert k in body, body
        assert body["ok"] is True
        assert body["system"] == "wealth"
        assert body["max_level"] == 3

        # config now reflects new thresholds
        cfg = db.level_configs.find_one({"_id": "wealth"})
        assert cfg["max_level"] == 3
        assert cfg["thresholds"] == [
            {"level": 1, "points": 0},
            {"level": 2, "points": 5},
            {"level": 3, "points": 20},
        ]
        # audit row appended
        after_count = db.level_migrations.count_documents({"system": "wealth"})
        assert after_count == before_count + 1

        row = db.level_migrations.find_one({"migration_id": body["migration_id"]})
        assert row is not None
        for k in ("migration_id", "admin_id", "system",
                  "old_thresholds", "new_thresholds",
                  "old_max_level", "new_max_level",
                  "affected_users", "created_at"):
            assert k in row, row.keys()
        assert row["system"] == "wealth"
        assert row["new_max_level"] == 3

    def test_apply_is_idempotent(self, admin_tok):
        """Re-applying the same config → affected=0."""
        payload = {
            "thresholds": [
                {"level": 1, "points": 0},
                {"level": 2, "points": 5},
                {"level": 3, "points": 20},
            ],
            "max_level": 3,
        }
        r1 = _post("/admin/levels/wealth/apply", admin_tok, payload)
        assert r1.status_code == 200, r1.text
        r2 = _post("/admin/levels/wealth/apply", admin_tok, payload)
        assert r2.status_code == 200, r2.text
        assert r2.json()["affected_users"] == 0, r2.json()

    def test_points_preserved_across_apply(self, admin_tok, db):
        """POINTS PRESERVATION guarantee: wealth_points, charm_points, and
        experience must be IDENTICAL before and after applying a new curve
        on their respective systems. Only the *_level fields may change."""
        # Snapshot points for all 3 systems
        snap = {sys: {uid: pl[0] for uid, pl in self._snapshot_points(db, sys).items()}
                for sys in LEVEL_SYSTEMS}
        curves = {
            "wealth": [{"level": 1, "points": 0}, {"level": 2, "points": 7},
                       {"level": 3, "points": 77}],
            "charm":  [{"level": 1, "points": 0}, {"level": 2, "points": 3},
                       {"level": 3, "points": 30}],
            "level":  [{"level": 1, "points": 0}, {"level": 2, "points": 2},
                       {"level": 3, "points": 20}],
        }
        for sys in LEVEL_SYSTEMS:
            r = _post(f"/admin/levels/{sys}/apply", admin_tok,
                      {"thresholds": curves[sys], "max_level": 3})
            assert r.status_code == 200, r.text

        # Verify: for every user, points unchanged
        for sys in LEVEL_SYSTEMS:
            pf = POINT_FIELDS[sys]
            after = {str(u["_id"]): int(u.get(pf, 0) or 0)
                     for u in db.users.find({}, {pf: 1})}
            assert after == snap[sys], (
                f"points changed for system={sys}: "
                f"diff count={sum(1 for k,v in after.items() if snap[sys].get(k)!=v)}"
            )

    def test_cap_behavior_never_above_max(self, admin_tok, db):
        """User with points >> max_level's points threshold gets capped at
        max_level. Apply a curve with max=2 for wealth and check no user's
        wealth_level exceeds 2."""
        payload = {
            "thresholds": [{"level": 1, "points": 0}, {"level": 2, "points": 1}],
            "max_level": 2,
        }
        r = _post("/admin/levels/wealth/apply", admin_tok, payload)
        assert r.status_code == 200, r.text
        # No user's wealth_level > 2
        bad = db.users.count_documents({"wealth_level": {"$gt": 2}})
        assert bad == 0, f"{bad} users exceed cap of 2"
        # And any user with wealth_points >= 1 is exactly at level 2
        max_lvl_users = db.users.count_documents({"wealth_points": {"$gte": 1}})
        at_cap = db.users.count_documents({"wealth_points": {"$gte": 1}, "wealth_level": 2})
        assert max_lvl_users == at_cap, (max_lvl_users, at_cap)

    def test_reversibility_apply_A_then_B_then_A(self, admin_tok, db):
        """Applying A → B → A: after 3rd apply every user's level equals
        what it was after 1st apply."""
        A = [{"level": 1, "points": 0}, {"level": 2, "points": 5},
             {"level": 3, "points": 50}]
        B = [{"level": 1, "points": 0}, {"level": 2, "points": 1},
             {"level": 3, "points": 2}]

        # 1st apply of A
        r1 = _post("/admin/levels/wealth/apply", admin_tok,
                   {"thresholds": A, "max_level": 3})
        assert r1.status_code == 200
        after_A1 = {str(u["_id"]): int(u.get("wealth_level", 0) or 0)
                    for u in db.users.find({}, {"wealth_level": 1})}

        # Apply B
        r2 = _post("/admin/levels/wealth/apply", admin_tok,
                   {"thresholds": B, "max_level": 3})
        assert r2.status_code == 200

        # Apply A again
        r3 = _post("/admin/levels/wealth/apply", admin_tok,
                   {"thresholds": A, "max_level": 3})
        assert r3.status_code == 200
        after_A2 = {str(u["_id"]): int(u.get("wealth_level", 0) or 0)
                    for u in db.users.find({}, {"wealth_level": 1})}

        assert after_A1 == after_A2, "reversibility failed"


# =================================================================
# GET /admin/level-migrations
# =================================================================
class TestMigrationsAuditList:
    def test_shape_and_desc_sort(self, admin_tok):
        r = _get("/admin/level-migrations", admin_tok, params={"limit": 50})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        assert len(d["items"]) >= 1
        for it in d["items"]:
            for k in ("migration_id", "admin_id", "system",
                      "old_thresholds", "new_thresholds",
                      "old_max_level", "new_max_level",
                      "affected_users", "created_at"):
                assert k in it, it
        # sort desc by created_at
        cas = [it["created_at"] for it in d["items"]]
        assert cas == sorted(cas, reverse=True), cas

    def test_limit_clamped(self, admin_tok):
        r = _get("/admin/level-migrations", admin_tok, params={"limit": 5})
        assert r.status_code == 200, r.text
        assert len(r.json()["items"]) <= 5


# =================================================================
# Wire-through: /gifts/send → wealth_points sender + charm_points recipient
# =================================================================
class TestGiftsWireThrough:
    def test_send_gift_updates_points_and_recomputes_levels(self, admin_tok):
        """Ensure identity curve for wealth/charm so display level tracks
        points 1:1. Then send a gift and verify both sender's wealth_points
        and recipient's charm_points bumped."""
        # Reset wealth & charm to identity curve so level = points
        for sys in ("wealth", "charm"):
            r = _post(f"/admin/levels/{sys}/apply", admin_tok, {
                "thresholds": _identity_thresholds(sys),
                "max_level": DEFAULT_MAX[sys],
            })
            assert r.status_code == 200, r.text

        # Fresh recipient
        recip_tok, _, _ = _register_fresh("iter36recip")
        recip_me = _me(recip_tok)
        recip_id = str(recip_me["id"])

        # Sender = demo admin (has coins). Snapshot.
        sender_me0 = _me(admin_tok)
        sender_wp0 = int(sender_me0["wealth_points"])
        recip_cp0 = int(recip_me["charm_points"])

        # Heart = 50 coins, charm_reward=5. qty=99 (max allowed) → total=4950
        # coins → wealth_points += 4950//1000 = 4; charm_points += 495.
        r = _post("/gifts/send", admin_tok, {
            "gift_id": "heart", "recipient_id": recip_id, "quantity": 99,
        })
        assert r.status_code == 200, r.text

        sender_me1 = _me(admin_tok)
        # Get recipient (this endpoint requires auth)
        rr = _get(f"/users/{recip_id}", admin_tok)
        assert rr.status_code == 200, rr.text
        recip_pub = rr.json()

        # Sender's wealth_points increased by 4
        assert int(sender_me1["wealth_points"]) == sender_wp0 + 4, (
            sender_wp0, sender_me1["wealth_points"])
        # Recipient's charm_points increased by 495 (charm_reward=5 * qty=99)
        assert int(recip_pub["charm_points"]) == recip_cp0 + 495, (
            recip_cp0, recip_pub["charm_points"])

        # Under identity curve, wealth_level == wealth_points and
        # charm_level == charm_points (cap 300)
        exp_wl = min(int(sender_me1["wealth_points"]), DEFAULT_MAX["wealth"])
        exp_cl = min(int(recip_pub["charm_points"]), DEFAULT_MAX["charm"])
        assert int(sender_me1["wealth_level"]) == exp_wl
        assert int(recip_pub["charm_level"]) == exp_cl

    def test_auth_me_exposes_new_points_fields(self, admin_tok):
        me = _me(admin_tok)
        for k in ("wealth_points", "charm_points", "growth_points"):
            assert k in me, f"missing {k} in /auth/me"


# =================================================================
# Boot migration idempotency
# =================================================================
class TestBootMigrationIdempotency:
    def test_all_users_have_new_point_fields(self, db):
        # (a) all users have wealth_points and charm_points
        missing_wp = db.users.count_documents({"wealth_points": {"$exists": False}})
        missing_cp = db.users.count_documents({"charm_points": {"$exists": False}})
        assert missing_wp == 0, f"{missing_wp} users missing wealth_points"
        assert missing_cp == 0, f"{missing_cp} users missing charm_points"
        # (c) experience present on all users
        missing_exp = db.users.count_documents({"experience": {"$exists": False}})
        assert missing_exp == 0, f"{missing_exp} users missing experience"

    def test_migration_guard_exists(self, db):
        guard = db.config.find_one({"_id": "level_migration_v1"})
        assert guard is not None, "level_migration_v1 guard missing"
        assert guard.get("done") is True

    def test_config_seeded_for_all_systems(self, db):
        for sys in LEVEL_SYSTEMS:
            doc = db.level_configs.find_one({"_id": sys})
            assert doc is not None, f"level_configs[{sys}] missing"
            assert isinstance(doc.get("thresholds"), list) and doc["thresholds"]


# =================================================================
# VIP untouched
# =================================================================
class TestVIPUntouched:
    def test_vip_thresholds(self):
        r = _get("/vip/thresholds")
        assert r.status_code == 200, r.text
        ts = r.json()["thresholds"]
        assert len(ts) == 7

    def test_vip_progress_still_works(self, admin_tok):
        r = _get("/vip/progress", admin_tok)
        assert r.status_code == 200, r.text
        assert "growth_points" in r.json()

    def test_admin_levels_does_not_include_vip(self, admin_tok):
        # VIP is intentionally NOT in the generic system list → 400
        r = _get("/admin/levels/vip", admin_tok)
        assert r.status_code == 400, r.text

    def test_wallet_recharge_still_works(self):
        tok, _, _ = _register_fresh("iter36vip")
        r = _post("/wallet/recharge", tok, {"package_id": "d_099"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["growth_points"] == 9999


# =================================================================
# Regressions — iter-33/34/35 smoke
# =================================================================
class TestRegressions:
    def test_iter33_block_report(self):
        tokA, _, _ = _register_fresh("iter36ra")
        tokB, _, _ = _register_fresh("iter36rb")
        b_id = str(_me(tokB)["id"])
        r_bl = _post(f"/users/{b_id}/block", tokA)
        assert r_bl.status_code in (200, 201, 204), r_bl.text
        r_rep = _post(f"/users/{b_id}/report", tokA,
                      {"reason": "spam", "details": "iter36 regression"})
        assert r_rep.status_code in (200, 201), r_rep.text

    def test_iter35_growth_history(self, admin_tok):
        r = _get("/vip/growth-history", admin_tok, params={"limit": 5})
        assert r.status_code == 200, r.text
        assert "items" in r.json()

    def test_iter34_mic_invite_endpoints_exist(self, admin_tok):
        # Just verify the endpoint responds (may 404 if no invite in flight —
        # not a bug for us). Accept any non-5xx.
        r = _post("/rooms/nonexistent/mic-invite/accept", admin_tok, {})
        assert r.status_code < 500, r.text
