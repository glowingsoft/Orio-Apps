"""
ORIO backend regression tests — iteration 2 (NEW endpoints only).

Covers:
- GET /api/ (branding)
- GET /api/rooms/{id}/level
- GET /api/rooms/{id}/mic-requests
- POST /api/rooms/{id}/mic-requests (request/cancel/accept/reject/remove)
- POST /api/rooms/{id}/background + status + admin decision (403 non-admin)
- GET /api/emoji-packs
- GET /api/vip/heads
- GET /api/tasks, POST /api/tasks/progress, POST /api/tasks/{id}/claim
- Branding sanity on GET /api/rooms

Run:
  pytest /app/backend/tests/test_orio_iteration2_endpoints.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results_iter2.xml
"""
from __future__ import annotations

import json
import secrets
from typing import Any, Optional

import pytest
import requests


# ---------- helpers ----------

def _rand_suffix(n: int = 8) -> str:
    return secrets.token_hex(n // 2)


def _register(base_url: str) -> dict[str, Any]:
    suf = _rand_suffix(8)
    email = f"test_{suf}@voiceup.app"
    payload = {
        "email": email,
        "password": "TestPass1234",
        "username": f"testu_{suf}",
        "nickname": f"T{suf[:6]}",
    }
    r = requests.post(f"{base_url}/api/auth/register", json=payload, timeout=15)
    assert r.status_code == 201, f"register: {r.status_code} {r.text}"
    tok = r.json()
    me = requests.get(
        f"{base_url}/api/auth/me",
        headers={"Authorization": f"Bearer {tok['access_token']}"},
        timeout=15,
    )
    assert me.status_code == 200, me.text
    return {**tok, "email": email, "user_id": me.json().get("id"), "me": me.json()}


def _auth(tok: dict) -> dict:
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _get_me(base_url: str, tok: dict) -> dict:
    r = requests.get(f"{base_url}/api/auth/me", headers=_auth(tok), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_room(base_url: str, tok: dict) -> str:
    payload = {
        "name": f"IterTwo-{_rand_suffix(4)}",
        "description": "iter2 room",
        "category": "general",
        "num_seats": 8,
        "max_users": 50,
        "is_private": False,
    }
    r = requests.post(f"{base_url}/api/rooms", json=payload, headers=_auth(tok), timeout=15)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- shared fixtures ----------

@pytest.fixture(scope="module")
def owner(base_url):
    """Owner of a fresh test room."""
    return _register(base_url)


@pytest.fixture(scope="module")
def user2(base_url):
    """Second user for mic requests."""
    return _register(base_url)


@pytest.fixture(scope="module")
def user3(base_url):
    """Third user for non-owner 403 checks."""
    return _register(base_url)


@pytest.fixture(scope="module")
def room_id(base_url, owner):
    return _create_room(base_url, owner)


# =============================================================
# 1) GET /api/ branding
# =============================================================
class TestBrandingRoot:
    def test_root_returns_orio(self, base_url):
        r = requests.get(f"{base_url}/api/", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"app": "ORIO", "version": "0.2.0", "status": "ok"}, body
        assert "VoiceUp" not in r.text
        assert "Folu" not in r.text


# =============================================================
# 2) GET /api/rooms/{id}/level
# =============================================================
class TestRoomLevel:
    def test_level_fresh_room(self, base_url, owner, room_id):
        r = requests.get(f"{base_url}/api/rooms/{room_id}/level", headers=_auth(owner), timeout=10)
        assert r.status_code == 200, r.text
        b = r.json()
        # required keys
        for k in ("level", "spent", "current", "next", "remaining", "progress", "supporters"):
            assert k in b, f"missing key {k}: {b}"
        assert b["level"] == 1, b
        assert b["spent"] == 0, b
        assert b["next"] == 10_000_000, b
        assert b["progress"] == 0, b
        assert b["supporters"] == 0, b


# =============================================================
# 3-7) Mic Requests
# =============================================================
class TestMicRequests:
    def test_3_empty_list(self, base_url, owner, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json() == [], r.json()

    def test_4a_user2_requests_mic(self, base_url, user2, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "request"},
            headers=_auth(user2), timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True, r.json()

    def test_4b_pending_shows_user2(self, base_url, owner, user2, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1, arr
        assert any(x.get("user_id") == user2["user_id"] for x in arr), arr
        found = next(x for x in arr if x["user_id"] == user2["user_id"])
        assert found.get("status") == "pending", found

    def test_4c_user2_cancels(self, base_url, user2, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "cancel"},
            headers=_auth(user2), timeout=10,
        )
        assert r.status_code == 200, r.text

    def test_4d_pending_now_empty(self, base_url, owner, user2, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200
        arr = r.json()
        assert not any(x.get("user_id") == user2["user_id"] for x in arr), arr

    def test_5a_user2_requests_again(self, base_url, user2, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "request"},
            headers=_auth(user2), timeout=10,
        )
        assert r.status_code == 200, r.text

    def test_5b_owner_accepts_user2(self, base_url, owner, user2, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "accept", "user_id": user2["user_id"]},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("ok") is True and "seat_index" in b, b
        seat_index = int(b["seat_index"])
        # Verify seats show user2
        rr = requests.get(f"{base_url}/api/rooms/{room_id}", headers=_auth(owner), timeout=10)
        assert rr.status_code == 200, rr.text
        room = rr.json()
        seats = room.get("seats", [])
        assert 0 <= seat_index < len(seats), (seat_index, len(seats))
        seat_user = (seats[seat_index] or {}).get("user")
        assert seat_user is not None and seat_user.get("id") == user2["user_id"], seats[seat_index]

    def test_6_non_owner_cannot_accept(self, base_url, user2, user3, room_id):
        # user2 requests again to have a pending req for user3 to try to accept
        # Actually user2 was already accepted; register a temp requester ephemerally
        # Simpler: user3 requests mic himself, then user3 (non-owner) tries to accept his own
        # But test spec: non-owner attempting to accept another user's request → 403
        # We'll have user3 request, then user3 tries to "accept" himself as non-owner.
        rq = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "request"},
            headers=_auth(user3), timeout=10,
        )
        assert rq.status_code == 200, rq.text
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "accept", "user_id": user3["user_id"]},
            headers=_auth(user3), timeout=10,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "Only owner or moderator" in json.dumps(r.json()), r.json()

    def test_7_remove_owner_seat_forbidden(self, base_url, owner, room_id):
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/mic-requests",
            json={"action": "remove", "seat_index": 0},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "Cannot remove the owner" in json.dumps(r.json()), r.json()


# =============================================================
# 8-10) Room Background moderation
# =============================================================
class TestRoomBackground:
    sub_id: Optional[str] = None

    def test_8_owner_submits_bg(self, base_url, owner, room_id):
        # Give owner ≥5000 diamonds by having a gifter send them "diamond" gifts.
        # Pragmatic deviation from spec: use bigger recharge (d_9999) + quantity=99 gifts
        # to keep test time bounded. Recipient diamonds = max(1, total_cost // 100).
        gifter = _register(base_url)

        # Fund gifter (single big recharge; underlying endpoint already validated iter1)
        rr = requests.post(
            f"{base_url}/api/wallet/recharge",
            json={"package_id": "d_9999"},
            headers=_auth(gifter), timeout=15,
        )
        assert rr.status_code == 200, rr.text
        assert rr.json().get("coins", 0) >= 500_000, rr.json()

        owner_id = owner["user_id"]
        me_before = _get_me(base_url, owner)
        diamonds_before = int(me_before.get("diamonds", 0))

        # Send diamond gifts qty=99 (99000 coins) → recipient +990 diamonds each
        # Need at least ceil(5000/990) = 6 gifts, target ≥5000+diamonds_before.
        needed = max(0, 5000 - diamonds_before)
        gifts_sent = 0
        while gifts_sent < 12:
            rg = requests.post(
                f"{base_url}/api/gifts/send",
                json={"gift_id": "diamond", "quantity": 99, "recipient_id": owner_id},
                headers=_auth(gifter), timeout=15,
            )
            assert rg.status_code == 200, f"gift send failed: {rg.status_code} {rg.text}"
            gifts_sent += 1
            me_now = _get_me(base_url, owner)
            if int(me_now.get("diamonds", 0)) - diamonds_before >= needed:
                break
        me_after_gifts = _get_me(base_url, owner)
        assert int(me_after_gifts.get("diamonds", 0)) >= 5000, me_after_gifts

        # Submit background
        r = requests.post(
            f"{base_url}/api/rooms/{room_id}/background",
            json={"image_url": "https://example.com/bg.png"},
            headers=_auth(owner), timeout=15,
        )
        assert r.status_code == 201, f"bg submit failed: {r.status_code} {r.text}"
        b = r.json()
        assert b.get("ok") is True, b
        assert b.get("status") == "pending", b
        assert "sub_id" in b and b["sub_id"], b
        assert "Image will be reviewed" in b.get("message", ""), b
        TestRoomBackground.sub_id = b["sub_id"]

        # verify diamonds decreased by 5000
        me_final = _get_me(base_url, owner)
        assert (
            int(me_after_gifts.get("diamonds", 0)) - int(me_final.get("diamonds", 0)) == 5000
        ), (me_after_gifts, me_final)

    def test_9_bg_status_lists_pending(self, base_url, owner, room_id):
        r = requests.get(
            f"{base_url}/api/rooms/{room_id}/background/status",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1, arr
        found = next((x for x in arr if x.get("sub_id") == TestRoomBackground.sub_id), None)
        assert found is not None, arr
        assert found.get("status") == "pending", found

    def test_10_non_admin_decision_forbidden(self, base_url, owner):
        r = requests.post(
            f"{base_url}/api/admin/room-backgrounds/{TestRoomBackground.sub_id}/decision",
            json={"decision": "reject", "reason": "test"},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "Admins only" in json.dumps(r.json()), r.json()


# =============================================================
# 11) Emoji packs
# =============================================================
class TestEmojiPacks:
    def test_returns_five_packs_of_twelve(self, base_url, owner):
        r = requests.get(f"{base_url}/api/emoji-packs", headers=_auth(owner), timeout=10)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list), arr
        assert len(arr) == 5, len(arr)
        for pack in arr:
            assert "id" in pack and "name" in pack and "emojis" in pack, pack
            assert len(pack["emojis"]) == 12, pack


# =============================================================
# 12) VIP heads
# =============================================================
class TestVipHeads:
    def test_returns_seven_heads(self, base_url):
        r = requests.get(f"{base_url}/api/vip/heads", timeout=10)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list), arr
        assert len(arr) == 7, len(arr)
        for entry in arr:
            for k in ("level", "animal", "emoji", "color", "label_en", "label_ar"):
                assert k in entry, f"missing {k}: {entry}"
        animals = [e["animal"] for e in arr]
        assert animals == ["sheep", "horse", "deer", "fox", "bear", "eagle", "cheetah"], animals


# =============================================================
# 13-16) Tasks
# =============================================================
class TestTasks:
    def test_13_list_tasks(self, base_url, owner):
        r = requests.get(f"{base_url}/api/tasks", headers=_auth(owner), timeout=10)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list) and len(arr) == 9, arr
        expected_ids = {
            "enter_room", "take_mic", "mic_10m", "mic_20m", "mic_30m",
            "room_10m", "recharge", "view_10_profiles", "post_5",
        }
        got_ids = {t["id"] for t in arr}
        assert got_ids == expected_ids, got_ids
        for t in arr:
            assert t["progress"] == 0, t
            assert t["completed"] is False, t
            assert t["claimed"] is False, t

    def test_14_progress_enter_room(self, base_url, owner):
        r = requests.post(
            f"{base_url}/api/tasks/progress",
            json={"task_id": "enter_room", "increment": 1},
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("progress") == 1 and b.get("target") == 1 and b.get("completed") is True, b

    def test_15_claim_enter_room(self, base_url, owner):
        me_before = _get_me(base_url, owner)
        d_before = int(me_before.get("diamonds", 0))
        r = requests.post(
            f"{base_url}/api/tasks/enter_room/claim",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("ok") is True and b.get("reward") == 20, b
        me_after = _get_me(base_url, owner)
        assert int(me_after.get("diamonds", 0)) == d_before + 20, (d_before, me_after)

        # second claim -> 409
        r2 = requests.post(
            f"{base_url}/api/tasks/enter_room/claim",
            headers=_auth(owner), timeout=10,
        )
        assert r2.status_code == 409, f"expected 409, got {r2.status_code}: {r2.text}"

    def test_16_unknown_task_claim_404(self, base_url, owner):
        r = requests.post(
            f"{base_url}/api/tasks/nonexistent_task_xyz/claim",
            headers=_auth(owner), timeout=10,
        )
        assert r.status_code == 404, r.text


# =============================================================
# 17) Rooms listing branding sanity
# =============================================================
class TestRoomsBranding:
    def test_no_voiceup_or_folu_in_rooms(self, base_url, owner):
        r = requests.get(f"{base_url}/api/rooms", headers=_auth(owner), timeout=15)
        assert r.status_code == 200, r.text
        text = r.text
        assert "VoiceUp" not in text, "Response contains 'VoiceUp'"
        assert "Folu" not in text, "Response contains 'Folu'"
        arr = r.json()
        assert isinstance(arr, list), arr
        for room in arr:
            owner_obj = room.get("owner") or {}
            nick = owner_obj.get("nickname", "")
            # allow None nickname; check it is never VoiceUp
            assert nick != "VoiceUp", room
