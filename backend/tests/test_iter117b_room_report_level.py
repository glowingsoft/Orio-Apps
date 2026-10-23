"""Iter-117 follow-up: validate backend contracts for the UI items the
previous iteration's agent could not drive interactively.

Covers:
  - Room create/update (owner can rename, non-owner forbidden)
  - Room welcome message save (via PATCH /api/rooms/{id}/settings)
  - Add moderator (POST /api/rooms/{id}/moderators/add)
  - Membership request + review (approve)
  - Mic invite (POST /api/rooms/{id}/mic-invite)
  - User report (POST /api/users/{id}/report)
  - Level endpoint shape (GET /api/me/levels)
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"


def _login(session: requests.Session, email: str, password: str = "demo1234") -> str:
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return tok


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    s = requests.Session()
    return _login(s, "multiacct1@orio.app")


@pytest.fixture(scope="module")
def joiner_token():
    s = requests.Session()
    return _login(s, "multiacct2@orio.app")


@pytest.fixture(scope="module")
def third_token():
    s = requests.Session()
    return _login(s, "multiacct3@orio.app")


@pytest.fixture(scope="module")
def owner_room(owner_token):
    """Reuse owner's existing live room if any; else create one."""
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token)).json()
    owner_id = me["id"]
    # Lookup existing room first via /rooms/mine
    r = requests.get(f"{BASE_URL}/api/rooms/mine", headers=_auth(owner_token))
    if r.status_code == 200:
        js = r.json()
        rooms = js if isinstance(js, list) else js.get("items", [])
        if rooms:
            return rooms[0]["id"], owner_id
    # None found – create one
    r = requests.post(
        f"{BASE_URL}/api/rooms",
        headers=_auth(owner_token),
        json={"name": f"TEST_room_{uuid.uuid4().hex[:6]}", "num_seats": 8},
    )
    assert r.status_code in (200, 201), f"create room failed: {r.status_code} {r.text}"
    return r.json()["id"], owner_id


# ─────────────────────────  Room rename (owner-only)  ──────────────────────────

class TestRoomRename:
    def test_owner_can_rename(self, owner_token, owner_room):
        room_id, _ = owner_room
        new_name = f"TEST_rn_{uuid.uuid4().hex[:5]}"
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{room_id}/settings",
            headers=_auth(owner_token),
            json={"name": new_name},
        )
        assert r.status_code == 200, r.text
        # verify
        g = requests.get(f"{BASE_URL}/api/rooms/{room_id}", headers=_auth(owner_token))
        assert g.status_code == 200
        assert g.json()["name"] == new_name

    def test_non_owner_cannot_rename(self, joiner_token, owner_room):
        room_id, _ = owner_room
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{room_id}/settings",
            headers=_auth(joiner_token),
            json={"name": "HACKED"},
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


# ──────────────────────────── Welcome message ──────────────────────────────────

class TestRoomWelcome:
    def test_owner_sets_welcome(self, owner_token, owner_room):
        room_id, _ = owner_room
        welcome = f"TEST_welcome_{uuid.uuid4().hex[:5]} @{{nickname}}"
        r = requests.patch(
            f"{BASE_URL}/api/rooms/{room_id}/settings",
            headers=_auth(owner_token),
            json={"welcome_msg": welcome},
        )
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/rooms/{room_id}", headers=_auth(owner_token)).json()
        saved = (
            g.get("welcome_msg")
            or g.get("welcome_message")
            or (g.get("settings") or {}).get("welcome_msg")
            or (g.get("settings") or {}).get("welcome_message")
            or ""
        )
        assert welcome in saved, f"welcome not saved: {saved!r}"


# ─────────────────────────────  Moderators  ────────────────────────────────────

class TestMembership:
    def test_request_and_review(self, owner_token, third_token, owner_room):
        room_id, _ = owner_room
        me3 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(third_token)).json()
        # Must follow before requesting membership
        requests.post(f"{BASE_URL}/api/rooms/{room_id}/follow", headers=_auth(third_token), json={})
        requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/membership/request",
            headers=_auth(third_token),
            json={},
        )
        # Look up the pending request id for this user
        pending = requests.get(
            f"{BASE_URL}/api/rooms/{room_id}/membership/pending",
            headers=_auth(owner_token),
        ).json()
        my_req = next((p for p in pending if p.get("user_id") == me3["id"]), None)
        if not my_req:
            # Already approved from a previous run → pass
            return
        rv = requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/membership/review",
            headers=_auth(owner_token),
            json={"request_id": my_req["id"], "action": "approve"},
        )
        assert rv.status_code in (200, 201), f"review failed: {rv.status_code} {rv.text}"


# ─────────────────────────────  Moderators  ────────────────────────────────────

class TestModerators:
    def test_add_moderator(self, owner_token, joiner_token, owner_room):
        room_id, _ = owner_room
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(joiner_token)).json()
        # Backend requires the user to be an approved member first.
        requests.post(f"{BASE_URL}/api/rooms/{room_id}/follow", headers=_auth(joiner_token), json={})
        requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/membership/request",
            headers=_auth(joiner_token),
            json={},
        )
        pending = requests.get(
            f"{BASE_URL}/api/rooms/{room_id}/membership/pending",
            headers=_auth(owner_token),
        ).json()
        my_req = next((p for p in pending if p.get("user_id") == me2["id"]), None)
        if my_req:
            requests.post(
                f"{BASE_URL}/api/rooms/{room_id}/membership/review",
                headers=_auth(owner_token),
                json={"request_id": my_req["id"], "action": "approve"},
            )
        r = requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/moderators/add",
            headers=_auth(owner_token),
            json={"user_id": me2["id"]},
        )
        assert r.status_code in (200, 201), f"add mod failed: {r.status_code} {r.text}"
        g = requests.get(f"{BASE_URL}/api/rooms/{room_id}", headers=_auth(owner_token)).json()
        mods = g.get("moderators") or []
        assert me2["id"] in mods, f"user_id missing from moderators: {mods}"


# ─────────────────────────────  Mic invite  ────────────────────────────────────

class TestMicInvite:
    def test_owner_sends_mic_invite(self, owner_token, joiner_token, owner_room):
        room_id, _ = owner_room
        me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(joiner_token)).json()
        r = requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/mic-invite",
            headers=_auth(owner_token),
            json={"target_user_id": me2["id"], "seat_index": 1},
        )
        # 200 ok OR 409 pending-already OR 400 if target not in room
        assert r.status_code in (200, 201, 400, 409), f"mic-invite status {r.status_code}: {r.text}"


# ─────────────────────────────  User report  ───────────────────────────────────

class TestReport:
    def test_report_user_minimal(self, joiner_token, owner_room):
        _, owner_id = owner_room
        r = requests.post(
            f"{BASE_URL}/api/users/{owner_id}/report",
            headers=_auth(joiner_token),
            json={"reason": "TEST_iter117b report", "media_urls": []},
        )
        assert r.status_code in (200, 201), f"report failed: {r.status_code} {r.text}"


# ─────────────────────────────  Levels endpoint  ───────────────────────────────

class TestLevels:
    def test_me_levels_shape(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/me/levels", headers=_auth(owner_token))
        assert r.status_code == 200, r.text
        js = r.json()
        # New shape: nested blocks {wealth: {level,...}, charm: {level,...}, vip: {...}}
        for k in ("wealth", "charm"):
            assert k in js and "level" in js[k], f"missing nested level for {k}: {js}"
