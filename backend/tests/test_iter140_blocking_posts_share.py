"""
Iter-140 regression tests
=========================

Covers (per review request):
  * Blocks: POST /users/{id}/block → GET /users/{id} payload shape;
    POST /messages/send, /messages/gift and /calls/start → 403 BLOCKED
    in BOTH directions; DELETE /users/{id}/block restores access.
  * Posts visibility: PATCH /posts/{id}/visibility owner-only (403 otherwise);
    mutual-only posts hidden from non-mutual viewers in GET /posts and
    GET /posts/{id} → 404; GET /posts returns the author's CURRENT
    nickname/avatar after a PATCH /users/me nickname change;
    DELETE /posts/{id} owner-only; create post rejects images+video together
    and >9 images.
  * GET /users/me/mutuals returns mutual follows only.
  * POST /posts/{id}/share {recipient_ids} → DM messages kind='post' with
    post_id; skips blocked users and recipients not allowed to see a
    mutual-only post.
"""

import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL_TEST")
            or "http://localhost:8001").rstrip("/")

PASSWORD = "demo1234"


# ---------- helpers ----------
def _login(email: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    data = r.json()
    headers = {"Authorization": f"Bearer {data['access_token']}",
               "Content-Type": "application/json"}
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
    assert me.status_code == 200, me.text
    mdata = me.json()
    return {
        "id": mdata["id"],
        "nickname": mdata.get("nickname"),
        "avatar_url": mdata.get("avatar_url"),
        "token": data["access_token"],
        "headers": headers,
    }


def _ensure_follows(a: dict, b: dict):
    """Make `a` follow `b` if not already."""
    requests.post(f"{BASE_URL}/api/users/{b['id']}/follow",
                  headers=a["headers"], timeout=15)


def _unfollow(a: dict, b: dict):
    requests.delete(f"{BASE_URL}/api/users/{b['id']}/follow",
                    headers=a["headers"], timeout=15)


def _unblock(a: dict, b: dict):
    requests.delete(f"{BASE_URL}/api/users/{b['id']}/block",
                    headers=a["headers"], timeout=15)


def _delete_post(user: dict, post_id: str):
    requests.delete(f"{BASE_URL}/api/posts/{post_id}", headers=user["headers"], timeout=15)


# ---------- shared session fixture ----------
@pytest.fixture(scope="module")
def users():
    """
    Logs in 4 test accounts and makes sure block state is clean.
    test.1 (A), test.2 (B), test.3 (C), test.4 (D)
    """
    a = _login("test.1@oriotest.dev")
    b = _login("test.2@oriotest.dev")
    c = _login("test.3@oriotest.dev")
    d = _login("test.4@oriotest.dev")

    # Clean any lingering blocks between every pair (idempotent).
    pairs = [(a, b), (a, c), (a, d), (b, a), (b, c), (b, d),
             (c, a), (c, b), (c, d), (d, a), (d, b), (d, c)]
    for x, y in pairs:
        _unblock(x, y)

    yield {"a": a, "b": b, "c": c, "d": d}

    # final teardown — remove blocks and TEST_ posts/mutuals
    for x, y in pairs:
        _unblock(x, y)


# ---------- 1. Blocking ----------
class TestBlocking:
    """POST /users/{id}/block + the three endpoints that must enforce it."""

    def test_block_profile_shape(self, users):
        a, b = users["a"], users["b"]
        _ensure_follows(a, b)
        _ensure_follows(b, a)

        r = requests.post(f"{BASE_URL}/api/users/{b['id']}/block",
                          headers=a["headers"], timeout=15)
        assert r.status_code == 201, r.text
        assert r.json().get("blocked") is True

        # Blocker view
        r = requests.get(f"{BASE_URL}/api/users/{b['id']}", headers=a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("is_blocked_view") is True
        assert p.get("i_blocked") is True
        # blocked_me is False/None/absent on this side
        assert not p.get("blocked_me")
        # No stat fields leaked
        for k in ("followers", "following", "friends", "supporter_total", "is_following"):
            assert k not in p, f"blocker profile leaked field '{k}'"

        # Blocked user's view of the blocker
        r = requests.get(f"{BASE_URL}/api/users/{a['id']}", headers=b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q.get("is_blocked_view") is True
        assert q.get("blocked_me") is True
        assert not q.get("i_blocked")
        for k in ("followers", "following", "friends", "supporter_total", "is_following"):
            assert k not in q, f"blocked-user view leaked field '{k}'"

    def test_messages_send_blocked_both_ways(self, users):
        a, b = users["a"], users["b"]
        # A→B must be 403
        r1 = requests.post(f"{BASE_URL}/api/messages/send", headers=a["headers"],
                           json={"recipient_id": b["id"], "text": "TEST_iter140 blocked ping"}, timeout=15)
        assert r1.status_code == 403, r1.text
        assert "BLOCKED" in r1.text.upper()
        # B→A must also be 403 (reverse direction)
        r2 = requests.post(f"{BASE_URL}/api/messages/send", headers=b["headers"],
                           json={"recipient_id": a["id"], "text": "TEST_iter140 blocked reverse"}, timeout=15)
        assert r2.status_code == 403, r2.text
        assert "BLOCKED" in r2.text.upper()

    def test_messages_gift_blocked_both_ways(self, users):
        a, b = users["a"], users["b"]
        payload = {"recipient_id": b["id"], "gift_id": "rose", "qty": 1}
        r1 = requests.post(f"{BASE_URL}/api/messages/gift", headers=a["headers"], json=payload, timeout=15)
        assert r1.status_code == 403, r1.text
        assert "BLOCKED" in r1.text.upper()
        r2 = requests.post(f"{BASE_URL}/api/messages/gift", headers=b["headers"],
                           json={"recipient_id": a["id"], "gift_id": "rose", "qty": 1}, timeout=15)
        assert r2.status_code == 403, r2.text
        assert "BLOCKED" in r2.text.upper()

    def test_calls_start_blocked_both_ways(self, users):
        a, b = users["a"], users["b"]
        r1 = requests.post(f"{BASE_URL}/api/calls/start", headers=a["headers"],
                           json={"callee_id": b["id"], "kind": "audio"}, timeout=15)
        assert r1.status_code == 403, r1.text
        assert "BLOCKED" in r1.text.upper()
        r2 = requests.post(f"{BASE_URL}/api/calls/start", headers=b["headers"],
                           json={"callee_id": a["id"], "kind": "audio"}, timeout=15)
        assert r2.status_code == 403, r2.text
        assert "BLOCKED" in r2.text.upper()

    def test_unblock_restores(self, users):
        a, b = users["a"], users["b"]
        r = requests.delete(f"{BASE_URL}/api/users/{b['id']}/block",
                            headers=a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("blocked") is False

        # profile view now exposes full details
        r = requests.get(f"{BASE_URL}/api/users/{b['id']}", headers=a["headers"], timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert not p.get("is_blocked_view")
        assert "followers" in p or "following" in p  # stat fields back

        # DM now goes through
        r = requests.post(f"{BASE_URL}/api/messages/send", headers=a["headers"],
                          json={"recipient_id": b["id"], "text": "TEST_iter140 unblocked ping"}, timeout=15)
        assert r.status_code in (200, 201), r.text


# ---------- 2. Mutuals ----------
class TestMutuals:
    def test_mutuals_only_lists_bidirectional(self, users):
        a, b, c = users["a"], users["b"], users["c"]
        # a↔b mutual, a→c one-way (c does NOT follow back).
        _ensure_follows(a, b)
        _ensure_follows(b, a)
        _ensure_follows(a, c)
        _unfollow(c, a)  # make sure c→a is NOT present

        r = requests.get(f"{BASE_URL}/api/users/me/mutuals", headers=a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        ids = {m["id"] for m in r.json()}
        assert b["id"] in ids, "mutual (b) missing from /users/me/mutuals"
        assert c["id"] not in ids, "one-way (c) must NOT appear"


# ---------- 3. Posts: visibility, author live profile, delete, validation ----------
@pytest.fixture
def _post_cleanup():
    bag: list[tuple[dict, str]] = []
    yield bag
    for user, pid in bag:
        _delete_post(user, pid)


class TestPosts:
    def test_create_rejects_images_and_video_together(self, users, _post_cleanup):
        a = users["a"]
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"], json={
            "text": "TEST_iter140 bad",
            "images": ["https://x/1.jpg"],
            "video_url": "https://x/v.mp4",
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_create_rejects_more_than_9_images(self, users):
        a = users["a"]
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"], json={
            "text": "TEST_iter140 10imgs",
            "images": [f"https://x/{i}.jpg" for i in range(10)],
        }, timeout=15)
        # Pydantic will reject with 422; some stacks turn this into 400.
        assert r.status_code in (400, 422), r.text

    def test_visibility_owner_only_and_mutual_hidden(self, users, _post_cleanup):
        a, b, c = users["a"], users["b"], users["c"]
        # Make a↔b mutual, a and c NOT mutual.
        _ensure_follows(a, b)
        _ensure_follows(b, a)
        _unfollow(a, c)
        _unfollow(c, a)

        # a creates a public post
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"],
                          json={"text": "TEST_iter140 vis"}, timeout=15)
        assert r.status_code == 201, r.text
        post_id = r.json()["id"]
        _post_cleanup.append((a, post_id))

        # Non-owner can NOT change visibility
        r = requests.patch(f"{BASE_URL}/api/posts/{post_id}/visibility",
                           headers=b["headers"], json={"visibility": "mutual"}, timeout=15)
        assert r.status_code == 403, r.text

        # Owner CAN flip to mutual
        r = requests.patch(f"{BASE_URL}/api/posts/{post_id}/visibility",
                           headers=a["headers"], json={"visibility": "mutual"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("visibility") == "mutual"

        # Mutual (b) still sees it in list and detail
        r = requests.get(f"{BASE_URL}/api/posts?feed=latest", headers=b["headers"], timeout=15)
        assert r.status_code == 200
        assert any(p["id"] == post_id for p in r.json()), "mutual viewer should see mutual-only post"
        r = requests.get(f"{BASE_URL}/api/posts/{post_id}", headers=b["headers"], timeout=15)
        assert r.status_code == 200

        # Non-mutual (c) is hidden
        r = requests.get(f"{BASE_URL}/api/posts?feed=latest", headers=c["headers"], timeout=15)
        assert r.status_code == 200
        assert not any(p["id"] == post_id for p in r.json()), "non-mutual viewer must NOT see mutual-only post"
        r = requests.get(f"{BASE_URL}/api/posts/{post_id}", headers=c["headers"], timeout=15)
        assert r.status_code == 404, r.text

    def test_feed_shows_live_author_nickname(self, users, _post_cleanup):
        a = users["a"]
        orig_nickname = a["nickname"] or "A"
        new_nickname = f"TEST_iter140_{int(time.time()) % 100000}"

        # Create a public post
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"],
                          json={"text": "TEST_iter140 live-nick"}, timeout=15)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        _post_cleanup.append((a, pid))

        # Change nickname
        r = requests.patch(f"{BASE_URL}/api/users/me", headers=a["headers"],
                           json={"nickname": new_nickname}, timeout=15)
        assert r.status_code == 200, r.text

        try:
            # GET /posts must show new nickname on the author block
            r = requests.get(f"{BASE_URL}/api/posts?feed=latest", headers=a["headers"], timeout=15)
            assert r.status_code == 200
            mine = next((p for p in r.json() if p["id"] == pid), None)
            assert mine is not None, "my post missing from feed"
            assert (mine.get("author") or {}).get("nickname") == new_nickname, mine.get("author")
        finally:
            # Restore original nickname
            requests.patch(f"{BASE_URL}/api/users/me", headers=a["headers"],
                           json={"nickname": orig_nickname}, timeout=15)

    def test_delete_owner_only(self, users, _post_cleanup):
        a, b = users["a"], users["b"]
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"],
                          json={"text": "TEST_iter140 del"}, timeout=15)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        _post_cleanup.append((a, pid))

        # Non-owner cannot delete
        r = requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=b["headers"], timeout=15)
        assert r.status_code == 403, r.text

        # Owner can delete
        r = requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=a["headers"], timeout=15)
        assert r.status_code == 200, r.text


# ---------- 4. Share ----------
class TestShare:
    def test_share_creates_post_dms_and_respects_rules(self, users, _post_cleanup):
        a, b, c, d = users["a"], users["b"], users["c"], users["d"]

        # Setup — a↔b mutual, a↔c NON-mutual, a blocks d.
        _ensure_follows(a, b); _ensure_follows(b, a)
        _unfollow(a, c); _unfollow(c, a)
        # Clean then block d
        _unblock(a, d)
        r = requests.post(f"{BASE_URL}/api/users/{d['id']}/block",
                          headers=a["headers"], timeout=15)
        assert r.status_code == 201

        # Create a MUTUAL-only post from a
        r = requests.post(f"{BASE_URL}/api/posts", headers=a["headers"],
                          json={"text": "TEST_iter140 share",
                                "visibility": "mutual"}, timeout=15)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        _post_cleanup.append((a, pid))

        # Share to b (mutual, allowed), c (non-mutual, must be skipped), d (blocked, skipped)
        r = requests.post(f"{BASE_URL}/api/posts/{pid}/share", headers=a["headers"],
                          json={"recipient_ids": [b["id"], c["id"], d["id"]]}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert b["id"] in data.get("sent", []), f"expected b sent, got {data}"
        assert c["id"] in data.get("skipped", []), f"expected c skipped (non-mutual), got {data}"
        assert d["id"] in data.get("skipped", []), f"expected d skipped (blocked), got {data}"

        # Verify b received a kind='post' message with post_id in the DM thread
        r = requests.get(f"{BASE_URL}/api/messages/with/{a['id']}", headers=b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        msgs = r.json() if isinstance(r.json(), list) else r.json().get("messages", [])
        hit = [m for m in msgs if m.get("kind") == "post" and m.get("post_id") == pid]
        assert hit, f"no kind='post' DM with post_id={pid} in b's thread. msgs={msgs[-3:]}"

        # Teardown block
        _unblock(a, d)
