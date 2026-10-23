"""
Iter-87 — Admin Owner Google session endpoint tests.

Uses httpx ASGITransport so the FastAPI app runs in-process with the test —
this is required so we can patch `server._httpx` to simulate the Emergent
Google session exchange without a real external call.

Covers:
  • Owner Google email → access_token/refresh_token issued, profile_completed=true, no onboarding.
  • Non-owner Google email → 403.
  • Invalid session_id (upstream 401) → 401.
  • Normal /api/auth/google/session is unchanged — still creates onboarding users.
  • Owner google tokens let the Owner call admin team endpoints.
"""
import os
import uuid
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("ADMIN_OWNER_EMAIL", "orioowner@gmail.com")

# Import after env is set.
import server  # noqa: E402
from server import app  # noqa: E402

OWNER_EMAIL = "orioowner@gmail.com"
pytestmark = pytest.mark.asyncio


class _FakeEmergentResponse:
    def __init__(self, status: int, payload: dict):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


def _fake_client(email: str, name: str = "ORIO Owner", picture: str | None = None, status: int = 200):
    class _FakeClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw):
            return _FakeEmergentResponse(status, {"email": email, "name": name, "picture": picture})
    return _FakeClient


@pytest_asyncio.fixture
async def client():
    # Run against the ASGI app with lifespan so app.state.db is initialised.
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


# -----------------------------------------------------------------------------
# 1. Owner Google email → admin session issued, profile_completed=true
# -----------------------------------------------------------------------------
async def test_owner_google_session_grants_admin_access(client: AsyncClient):
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(OWNER_EMAIL)
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "fake_valid_" + uuid.uuid4().hex})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("access_token")
        assert body.get("refresh_token")

        me = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {body['access_token']}"})
        assert me.status_code == 200
        u = me.json()
        assert u["email"] == OWNER_EMAIL
        assert u.get("profile_completed") is True, \
            "Owner MUST land in admin dashboard, not profile completion onboarding"
        assert u.get("admin_access", {}).get("is_owner") is True

        r2 = await client.get("/api/admin/dashboard/stats",
                                headers={"Authorization": f"Bearer {body['access_token']}"})
        assert r2.status_code == 200


# -----------------------------------------------------------------------------
# 2. Non-owner Google email → 403 (and no normal account from admin endpoint)
# -----------------------------------------------------------------------------
async def test_non_owner_google_denied_from_admin_endpoint(client: AsyncClient):
    ghost = f"ghost_{uuid.uuid4().hex[:6]}@gmail.com"
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(ghost)
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "fake_valid_" + uuid.uuid4().hex})
        assert r.status_code == 403, r.text
        # Error text explicitly mentions Owner so the UI can show a helpful message.
        assert "Owner" in r.text


# -----------------------------------------------------------------------------
# 3. Invalid upstream session → 401
# -----------------------------------------------------------------------------
async def test_invalid_upstream_session_returns_401(client: AsyncClient):
    class _Bad:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw):
            return _FakeEmergentResponse(401, {})
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _Bad
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "invalid_test"})
        assert r.status_code == 401


# -----------------------------------------------------------------------------
# 4. Normal /auth/google/session unchanged — onboarding for normal users
# -----------------------------------------------------------------------------
async def test_normal_google_session_unchanged(client: AsyncClient):
    normal = f"normal_{uuid.uuid4().hex[:6]}@gmail.com"
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(normal, name="Normal Person")
        r = await client.post("/api/auth/google/session",
                               json={"session_id": "fake_valid_" + uuid.uuid4().hex})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        me = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        u = me.json()
        # Normal flow leaves users in onboarding — this is what we must preserve.
        assert u.get("profile_completed") is not True
        # And they must NOT get admin access.
        assert u.get("admin_access") is None


# -----------------------------------------------------------------------------
# 5. Owner tokens from admin endpoint can touch Owner-only team endpoint
# -----------------------------------------------------------------------------
async def test_owner_google_tokens_can_manage_team(client: AsyncClient):
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(OWNER_EMAIL)
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "fake_valid_" + uuid.uuid4().hex})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        r2 = await client.get("/api/admin/dashboard/team",
                                headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 200
        assert r2.json()["owner_email"] == OWNER_EMAIL


# -----------------------------------------------------------------------------
# 6. If Owner was previously created in normal flow with profile_completed=false,
#    the admin google endpoint must MIGRATE them (set profile_completed=true).
# -----------------------------------------------------------------------------
async def test_existing_owner_user_is_upgraded(client: AsyncClient):
    """If the Owner's email already has a user record from the normal flow with
    profile_completed=false, calling /api/admin/auth/google/session must flip
    profile_completed to true so the Owner never lands in onboarding."""
    import os as _os
    # Pre-create the owner user via the normal google flow (so profile_completed=false).
    # We cannot do that cleanly since the owner_email is the test email itself.
    # Instead, do a direct Mongo poke after the first admin login.
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(OWNER_EMAIL)
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "warmup_" + uuid.uuid4().hex})
        assert r.status_code == 200

    # Reset profile_completed to false, simulating a pre-existing non-onboarded user.
    db = app.state.db
    await db.users.update_one({"email": OWNER_EMAIL}, {"$set": {"profile_completed": False}})

    # Re-run admin google exchange — it must heal the record.
    with patch.object(server, "_httpx") as m:
        m.AsyncClient = _fake_client(OWNER_EMAIL)
        r = await client.post("/api/admin/auth/google/session",
                               json={"session_id": "heal_" + uuid.uuid4().hex})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        me = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {tok}"})
        assert me.json().get("profile_completed") is True, \
            "Admin Google endpoint must flip profile_completed=true for existing Owner user"
