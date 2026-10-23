"""Iter Batch-B — Permanent account deletion edge cases.

Covers:
- POST /api/account/deletion/request requires auth (401 w/o token)
- confirm=false → 400
- confirm=true → 200 + status=pending + scheduled_at ~72h
- after request: old access token → 401, refresh → fails
- login again inside window → cancels (deletion_cancelled=true one-shot)
- pending withdrawal (status=REQUESTED) → 409 on request
- expiry (set scheduled_at in past) → finalize_due → login 401, re-register 403,
  profile GET returns 410
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email():
    return f"TEST_del_{uuid.uuid4().hex[:12]}@oriotest.dev"


def _register(email=None, password="demo1234"):
    email = email or _unique_email()
    uname = "u" + uuid.uuid4().hex[:10]
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password,
        "username": uname, "nickname": uname,
    }, timeout=20)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body and "refresh_token" in body
    return email, password, body


def _login(email, password="demo1234"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    return r


def _auth_headers(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Backend edge cases ----------


class TestDeletionRequestValidation:
    def test_requires_auth(self):
        r = requests.post(f"{API}/account/deletion/request", json={"confirm": True}, timeout=15)
        assert r.status_code == 401, r.text

    def test_confirm_false_returns_400(self):
        _, _, body = _register()
        tok = body["access_token"]
        r = requests.post(f"{API}/account/deletion/request",
                          json={"confirm": False},
                          headers=_auth_headers(tok), timeout=15)
        assert r.status_code == 400, r.text

    def test_confirm_true_returns_pending_and_72h(self):
        _, _, body = _register()
        tok = body["access_token"]
        r = requests.post(f"{API}/account/deletion/request",
                          json={"confirm": True},
                          headers=_auth_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "pending"
        sched = datetime.fromisoformat(data["scheduled_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta_h = (sched - now).total_seconds() / 3600.0
        assert 71 < delta_h < 73, f"scheduled_at not ~72h: {delta_h}"


class TestSessionRevocation:
    def test_access_401_and_refresh_fails_after_request(self):
        _, _, body = _register()
        tok, refresh = body["access_token"], body["refresh_token"]
        r = requests.post(f"{API}/account/deletion/request",
                          json={"confirm": True},
                          headers=_auth_headers(tok), timeout=15)
        assert r.status_code == 200
        # Access token for a 'pending' user is rejected by current_user
        me = requests.get(f"{API}/auth/me", headers=_auth_headers(tok), timeout=15)
        assert me.status_code == 401, me.text
        # Refresh session was revoked
        rr = requests.post(f"{API}/auth/refresh", json={"refresh_token": refresh}, timeout=15)
        assert rr.status_code in (401, 403), rr.text


class TestLoginCancelsDeletion:
    def test_login_cancels_and_flag_is_one_shot(self):
        email, pw, body = _register()
        tok = body["access_token"]
        r = requests.post(f"{API}/account/deletion/request",
                          json={"confirm": True},
                          headers=_auth_headers(tok), timeout=15)
        assert r.status_code == 200
        # Login again
        lr = _login(email, pw)
        assert lr.status_code == 200, lr.text
        new_tok = lr.json()["access_token"]
        # First /auth/me after cancel should include deletion_cancelled=true
        me1 = requests.get(f"{API}/auth/me", headers=_auth_headers(new_tok), timeout=15).json()
        assert me1.get("deletion_cancelled") is True, me1
        # Second call must NOT include it
        me2 = requests.get(f"{API}/auth/me", headers=_auth_headers(new_tok), timeout=15).json()
        assert me2.get("deletion_cancelled") in (None, False), me2


class TestPendingWithdrawalBlocks:
    """A REQUESTED withdrawal must block deletion with 409."""

    def test_pending_withdrawal_returns_409(self):
        import pymongo
        from bson import ObjectId
        _, _, body = _register()
        tok = body["access_token"]
        me = requests.get(f"{API}/auth/me", headers=_auth_headers(tok), timeout=15).json()
        uid = me.get("id") or me.get("_id") or me.get("user_id")
        assert uid, me
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "voiceup")
        cli = pymongo.MongoClient(mongo_url)
        db = cli[db_name]
        try:
            db.withdrawals.insert_one({
                "user_id": uid, "status": "REQUESTED",
                "amount_usd": 10.0, "created_at": datetime.now(timezone.utc),
                "is_test": True, "_test_tag": "batchb_deletion",
            })
            r = requests.post(f"{API}/account/deletion/request",
                              json={"confirm": True},
                              headers=_auth_headers(tok), timeout=15)
            assert r.status_code == 409, r.text
        finally:
            db.withdrawals.delete_many({"_test_tag": "batchb_deletion"})
            cli.close()


class TestFinalizeExpired:
    """Simulate expiry: set deletion_scheduled_at in the past, run finalize_due,
    verify login 401, re-register same email 403, profile GET 410."""

    def test_finalize_due_hard_deletes(self):
        import asyncio, sys
        import pymongo
        from bson import ObjectId
        sys.path.insert(0, "/app/backend")

        email, pw, body = _register()
        tok = body["access_token"]
        me = requests.get(f"{API}/auth/me", headers=_auth_headers(tok), timeout=15).json()
        uid = me["id"]
        # Start deletion
        r = requests.post(f"{API}/account/deletion/request",
                          json={"confirm": True},
                          headers=_auth_headers(tok), timeout=15)
        assert r.status_code == 200

        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "voiceup")
        cli = pymongo.MongoClient(mongo_url)
        db = cli[db_name]
        # Backdate the scheduled_at
        db.users.update_one(
            {"_id": ObjectId(uid)},
            {"$set": {"deletion_scheduled_at": datetime.now(timezone.utc) - timedelta(hours=1)}},
        )
        cli.close()

        # Run finalize_due using the backend's own motor client
        import importlib.util
        spec = importlib.util.spec_from_file_location("account_deletion", "/app/backend/account_deletion.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        from motor.motor_asyncio import AsyncIOMotorClient
        a_cli = AsyncIOMotorClient(mongo_url)
        a_db = a_cli[db_name]
        n = asyncio.get_event_loop().run_until_complete(mod.finalize_due(a_db))
        a_cli.close()
        assert n >= 1, f"finalize_due returned {n}"

        # Login must now fail
        lr = _login(email, pw)
        assert lr.status_code in (401, 403, 404), lr.text

        # Re-registering the same email within 3 days → 403
        rr = requests.post(f"{API}/auth/register", json={
            "email": email, "password": pw,
            "username": "u" + uuid.uuid4().hex[:10], "nickname": "retry",
        }, timeout=20)
        assert rr.status_code == 403, f"expected 403 for reused email: {rr.status_code} {rr.text}"

        # Profile GET returns 410
        # Need an auth token from any valid account
        _, _, viewer = _register()
        viewer_tok = viewer["access_token"]
        pr = requests.get(f"{API}/users/{uid}", headers=_auth_headers(viewer_tok), timeout=15)
        assert pr.status_code == 410, f"expected 410, got {pr.status_code}: {pr.text}"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
