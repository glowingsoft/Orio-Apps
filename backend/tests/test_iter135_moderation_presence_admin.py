"""Iter-135 — Private chat presence/badges/unread, global moderation
(DMs, posts, comments, profile, room chat ws), admin-editable word list,
and preview-wide direct recharge for every account.

Public URL only. Uses `TEST_` prefix for throwaway data where feasible.
"""
import asyncio
import json
import os
import secrets

import pytest
import requests
import websockets

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL_TEST")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://audio-community-9.preview.emergentagent.com"
).rstrip("/")
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")

TEST_ROOM_ID = "6ac923fb64abed17bb599809"  # TEST · Chill Chat (visible to test users)
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PWD = "demo1234"
OWNER_EMAIL = "orioowner@gmail.com"
OWNER_PWD = "OwnerTest!2026"


def _login(email: str, password: str = "demo1234") -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10).json()
    return {"token": tok, "me": me, "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}}


@pytest.fixture(scope="session")
def test3():
    return _login("test.3@oriotest.dev")


@pytest.fixture(scope="session")
def test4():
    return _login("test.4@oriotest.dev")


@pytest.fixture(scope="session")
def test5():
    return _login("test.5@oriotest.dev")


@pytest.fixture(scope="session")
def owner():
    return _login(OWNER_EMAIL, OWNER_PWD)


@pytest.fixture(scope="session")
def regular_user():
    """Freshly registered NON-test user — Iter-135 says preview allows recharge for ALL accounts."""
    email = f"TEST_regular_{secrets.token_hex(4)}@orio-tester.dev"
    username = f"treg{secrets.token_hex(3)}"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "demo12345",
        "username": username, "nickname": "Regular Tester",
    }, timeout=15)
    assert r.status_code in (200, 201), f"register regular {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10).json()
    assert me.get("is_test") is not True
    return {"token": tok, "me": me, "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}}


# =============================================================================
# 1) Presence + threads shape (age / vip_level / wealth_level / charm_level / online / unread)
# =============================================================================
class TestPresenceAndThreads:
    def test_presence_ping_marks_online_in_threads(self, test3, test4):
        # ensure a thread exists between test3 and test4
        send = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": "hello from test3",
        })
        assert send.status_code == 200, send.text

        # test3 pings presence
        p = requests.post(f"{BASE_URL}/api/presence/ping", headers=test3["headers"])
        assert p.status_code == 200
        assert p.json().get("ok") is True

        # test4 lists threads; the thread with test3 should show online=True + badge fields + unread>=1
        r = requests.get(f"{BASE_URL}/api/messages/threads", headers=test4["headers"])
        assert r.status_code == 200
        threads = r.json()
        assert isinstance(threads, list)
        thread = next((t for t in threads if t.get("user", {}).get("id") == test3["me"]["id"]), None)
        assert thread is not None, "test3 thread missing in test4's thread list"
        u = thread["user"]
        # Online flag reflects recent presence ping
        assert u.get("online") is True, f"expected online=True for test3, got {u}"
        # Iter-135 badge fields must be present
        for key in ("age", "gender", "vip_level", "wealth_level", "charm_level"):
            assert key in u, f"missing {key} in thread user payload: {u}"
        assert int(thread.get("unread", 0)) >= 1

    def test_unread_count_and_clear_on_read(self, test3, test4):
        # fresh message test3 -> test4
        requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": "ping unread",
        })
        c = requests.get(f"{BASE_URL}/api/messages/unread-count", headers=test4["headers"])
        assert c.status_code == 200
        n_before = int(c.json().get("unread", 0))
        assert n_before >= 1

        # Opening the thread should mark incoming as read
        g = requests.get(f"{BASE_URL}/api/messages/with/{test3['me']['id']}", headers=test4["headers"])
        assert g.status_code == 200

        c2 = requests.get(f"{BASE_URL}/api/messages/unread-count", headers=test4["headers"])
        assert c2.status_code == 200
        n_after = int(c2.json().get("unread", 0))
        # The thread's unreads must have been cleared (could still have unread from other threads, but strictly < before)
        assert n_after < n_before, f"unread didn't drop after reading ({n_before} -> {n_after})"

        # Confirm per-thread unread for this thread is now zero
        tr = requests.get(f"{BASE_URL}/api/messages/threads", headers=test4["headers"]).json()
        t = next((x for x in tr if x.get("user", {}).get("id") == test3["me"]["id"]), None)
        assert t is not None
        assert int(t.get("unread", 0)) == 0


# =============================================================================
# 2) Global moderation
# =============================================================================
class TestModerationDms:
    def test_english_slur_blocked_and_not_stored(self, test3, test4):
        r = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": "you bitch",
        })
        assert r.status_code == 400, r.text
        assert "CONTENT_BLOCKED" in r.text
        # Confirm not stored (no recent message in thread with that text)
        msgs = requests.get(f"{BASE_URL}/api/messages/with/{test4['me']['id']}", headers=test3["headers"]).json()
        assert all("you bitch" not in (m.get("text") or "").lower() for m in msgs[-20:])

    def test_arabic_slur_blocked(self, test3, test4):
        r = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": "يا شرموطة",
        })
        assert r.status_code == 400, r.text
        assert "CONTENT_BLOCKED" in r.text

    def test_clean_text_ok(self, test3, test4):
        r = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": "hello friend!",
        })
        assert r.status_code == 200, r.text


class TestModerationPostsAndComments:
    def test_post_text_blocked(self, test3):
        r = requests.post(f"{BASE_URL}/api/posts", headers=test3["headers"], json={
            "text": "fuck this app",
        })
        assert r.status_code == 400, r.text
        assert "CONTENT_BLOCKED" in r.text

    def test_post_text_clean_ok_then_comment_blocked(self, test3, test4):
        clean = requests.post(f"{BASE_URL}/api/posts", headers=test3["headers"], json={
            "text": f"TEST_clean_post_{secrets.token_hex(3)}",
        })
        assert clean.status_code == 201, clean.text
        post_id = clean.json().get("id") or clean.json().get("post", {}).get("id")
        assert post_id, f"no post id returned: {clean.json()}"
        try:
            r = requests.post(f"{BASE_URL}/api/posts/{post_id}/comments", headers=test4["headers"], json={
                "text": "you asshole",
            })
            assert r.status_code == 400, r.text
            assert "CONTENT_BLOCKED" in r.text
            # Clean comment OK
            ok = requests.post(f"{BASE_URL}/api/posts/{post_id}/comments", headers=test4["headers"], json={
                "text": "nice post!",
            })
            assert ok.status_code in (200, 201), ok.text
        finally:
            requests.delete(f"{BASE_URL}/api/posts/{post_id}", headers=test3["headers"])


class TestModerationProfile:
    def test_profile_nickname_blocked(self, test3):
        r = requests.patch(f"{BASE_URL}/api/users/me", headers=test3["headers"], json={
            "nickname": "slut",
        })
        assert r.status_code == 400, r.text
        assert "CONTENT_BLOCKED" in r.text

    def test_profile_bio_blocked(self, test3):
        r = requests.patch(f"{BASE_URL}/api/users/me", headers=test3["headers"], json={
            "bio": "I am a bitch",
        })
        assert r.status_code == 400, r.text
        assert "CONTENT_BLOCKED" in r.text


class TestModerationRoomChatWs:
    def test_room_chat_blocked(self, test3):
        """ws chat 'fuck' -> receives content_blocked and nothing is inserted."""
        ws_url = f"{WS_BASE}/api/ws/rooms/{TEST_ROOM_ID}?token={test3['token']}"

        async def run():
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                # drain intro frames
                for _ in range(8):
                    try:
                        await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except Exception:
                        break
                marker = f"TEST_bad_{secrets.token_hex(3)}_fuck"
                await ws.send(json.dumps({"type": "chat", "text": marker}))
                blocked = False
                for _ in range(6):
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except Exception:
                        break
                    try:
                        d = json.loads(raw)
                    except Exception:
                        continue
                    if d.get("type") == "content_blocked" and d.get("code") == "CONTENT_BLOCKED":
                        blocked = True
                        break
                    if d.get("type") == "chat" and (d.get("text") == marker):
                        pytest.fail(f"blocked chat was broadcast anyway: {d}")
                return blocked

        loop = asyncio.new_event_loop()
        try:
            blocked = loop.run_until_complete(run())
        finally:
            loop.close()
        assert blocked, "did not receive {type:'content_blocked'} from ws"


# =============================================================================
# 3) Admin editable word list — add word, assert blocks, restore to empty
# =============================================================================
class TestAdminWords:
    def test_admin_add_custom_word_blocks_and_restore(self, owner, test3, test4):
        # Snapshot current list
        g0 = requests.get(f"{BASE_URL}/api/admin/moderation/words", headers=owner["headers"])
        assert g0.status_code == 200, g0.text
        before = list(g0.json().get("words") or [])

        custom = "TEST_zxabcdef"
        # Push the custom word
        put1 = requests.put(f"{BASE_URL}/api/admin/moderation/words", headers=owner["headers"], json={
            "words": [custom],
        })
        assert put1.status_code == 200, put1.text
        assert custom.lower() in [w.lower() for w in put1.json().get("words", [])]

        try:
            # Confirm immediate effect: /messages/send with the custom word is blocked
            r = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
                "recipient_id": test4["me"]["id"], "kind": "text", "text": f"hello {custom} world",
            })
            assert r.status_code == 400, r.text
            assert "CONTENT_BLOCKED" in r.text
        finally:
            # Restore empty list (per request)
            put2 = requests.put(f"{BASE_URL}/api/admin/moderation/words", headers=owner["headers"], json={
                "words": [],
            })
            assert put2.status_code == 200, put2.text
            assert put2.json().get("words") == []

        # Post-cleanup: same message now goes through
        r2 = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": test4["me"]["id"], "kind": "text", "text": f"after cleanup {custom}",
        })
        assert r2.status_code == 200, r2.text


# =============================================================================
# 4) Preview-wide recharge enabled for every account (Iter-135)
# =============================================================================
class TestPreviewRecharge:
    def test_regular_user_can_recharge_and_idempotent(self, regular_user):
        # eligibility true for every account in preview
        e = requests.get(f"{BASE_URL}/api/wallet/recharge/eligibility", headers=regular_user["headers"])
        assert e.status_code == 200
        assert e.json().get("allowed") is True, f"preview eligibility must be True, got {e.json()}"

        rid = "TEST_rid_" + secrets.token_hex(6)
        before = requests.get(f"{BASE_URL}/api/auth/me", headers=regular_user["headers"]).json()
        c_before = int(before.get("coins", 0))

        r1 = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=regular_user["headers"], json={
            "package_id": "d_099", "request_id": rid,
        })
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("credited") == 494 or int(d1.get("coins", 0)) == c_before + 494

        # Idempotent duplicate
        r2 = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=regular_user["headers"], json={
            "package_id": "d_099", "request_id": rid,
        })
        assert r2.status_code == 200, r2.text
        assert r2.json().get("duplicate") is True
        # No additional credit
        after = requests.get(f"{BASE_URL}/api/auth/me", headers=regular_user["headers"]).json()
        assert int(after.get("coins", 0)) == c_before + 494


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
