"""Iter-143 Batch A — report multi-reasons, rankings v2 fields, WS entrance_effect once-per-join."""
import os
import json
import asyncio
import time
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

TEST_EMAIL_1 = "test.1@oriotest.dev"
TEST_EMAIL_2 = "test.2@oriotest.dev"
TEST_EMAIL_3 = "test.3@oriotest.dev"
TEST_PWD = "demo1234"


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": TEST_PWD}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    sess = r.json()
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {sess['access_token']}"}, timeout=15)
    assert me.status_code == 200, me.text
    sess["user"] = me.json()
    return sess


@pytest.fixture(scope="module")
def tokens():
    return {
        "a": _login(TEST_EMAIL_1),
        "b": _login(TEST_EMAIL_2),
        "c": _login(TEST_EMAIL_3),
    }


def _h(sess):
    return {"Authorization": f"Bearer {sess['access_token']}", "Content-Type": "application/json"}


# ---------- Reports: posts / comments / users / rooms ----------

class TestReports:
    def test_report_user_1_to_3_reasons_ok(self, tokens):
        """User report accepts 1–3 reasons, stored as reasons[] + first-as-reason."""
        target_id = tokens["b"]["user"]["id"]
        body = {"reason": "insult", "reasons": ["insult", "ads", "fraud"], "details": "TEST_iter143 multi"}
        r = requests.post(f"{BASE_URL}/api/users/{target_id}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert r.status_code == 201, r.text
        j = r.json()
        assert j.get("reported") is True

    def test_report_user_rejects_more_than_3(self, tokens):
        """4+ reasons → 400 Bad Request."""
        target_id = tokens["b"]["user"]["id"]
        # Pydantic Field(max_length=3) → 422; our _norm_reasons also raises 400.
        body = {"reason": "insult", "reasons": ["insult", "ads", "fraud", "porn"], "details": "TEST_iter143 >3"}
        r = requests.post(f"{BASE_URL}/api/users/{target_id}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_report_user_single_reason_fallback(self, tokens):
        """Single reason (reasons unset) still accepted and stored as reasons=[reason]."""
        target_id = tokens["c"]["user"]["id"]
        body = {"reason": "ads", "details": "TEST_iter143 single"}
        r = requests.post(f"{BASE_URL}/api/users/{target_id}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert r.status_code == 201, r.text

    def test_report_post_201(self, tokens):
        """POST /api/posts/{id}/report accepts reasons[] and returns 201 with reported:true."""
        # Create a post as user B
        r = requests.post(f"{BASE_URL}/api/posts", headers=_h(tokens["b"]), json={"text": "TEST_iter143 post"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id") or r.json().get("post_id")
        assert pid, r.text
        # Report as A
        body = {"reason": "porn", "reasons": ["porn", "very_dangerous"], "details": "TEST_iter143 post report"}
        rr = requests.post(f"{BASE_URL}/api/posts/{pid}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert rr.status_code == 201, rr.text
        assert rr.json().get("reported") is True
        # Clean up: delete the test post
        try:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(tokens["b"]), timeout=10)
        except Exception:
            pass

    def test_report_post_rejects_more_than_3(self, tokens):
        r = requests.post(f"{BASE_URL}/api/posts", headers=_h(tokens["b"]), json={"text": "TEST_iter143 post2"}, timeout=15)
        pid = r.json().get("id") or r.json().get("post_id")
        body = {"reason": "porn", "reasons": ["porn", "very_dangerous", "insult", "ads"], "details": "x"}
        rr = requests.post(f"{BASE_URL}/api/posts/{pid}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert rr.status_code in (400, 422), f"expected 400/422, got {rr.status_code}: {rr.text}"
        try:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(tokens["b"]), timeout=10)
        except Exception:
            pass

    def test_report_comment_201(self, tokens):
        """POST /api/comments/{id}/report returns 201."""
        # Create a post as B then a comment as C — resolve comment id directly from MongoDB
        try:
            from pymongo import MongoClient
            import os as _os
            mcli = MongoClient(_os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            mdb = mcli[_os.environ.get("DB_NAME", "voiceup")]
        except Exception:
            pytest.skip("pymongo unavailable")
        r = requests.post(f"{BASE_URL}/api/posts", headers=_h(tokens["b"]), json={"text": "TEST_iter143 post for comment"}, timeout=15)
        pid = r.json().get("id") or r.json().get("post_id")
        rc = requests.post(f"{BASE_URL}/api/posts/{pid}/comments", headers=_h(tokens["c"]), json={"text": "TEST_iter143 bad comment"}, timeout=15)
        assert rc.status_code in (200, 201), rc.text
        c_doc = mdb.post_comments.find_one({"post_id": pid, "text": "TEST_iter143 bad comment"})
        assert c_doc, "comment not found in mongo"
        cid = str(c_doc["_id"])
        body = {"reason": "insult", "reasons": ["insult"], "details": "TEST_iter143 comment report"}
        rr = requests.post(f"{BASE_URL}/api/comments/{cid}/report", headers=_h(tokens["a"]), json=body, timeout=15)
        assert rr.status_code == 201, rr.text
        assert rr.json().get("reported") is True
        try:
            requests.delete(f"{BASE_URL}/api/posts/{pid}", headers=_h(tokens["b"]), timeout=10)
        except Exception:
            pass


# ---------- Rankings v2 — wealth/charm rows must include age/wealth_level/charm_level ----------

class TestRankingsV2:
    def test_rankings_wealth_fields(self, tokens):
        r = requests.get(f"{BASE_URL}/api/rankings/v2/wealth?period=all", headers=_h(tokens["a"]), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list), rows
        if rows:
            row = rows[0]
            # Required new fields:
            for k in ("age", "gender", "wealth_level", "charm_level"):
                assert k in row, f"row missing '{k}': {row}"
            assert "id" in row and "nickname" in row

    def test_rankings_charm_fields(self, tokens):
        r = requests.get(f"{BASE_URL}/api/rankings/v2/charm?period=all", headers=_h(tokens["a"]), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        if rows:
            row = rows[0]
            for k in ("age", "gender", "wealth_level", "charm_level"):
                assert k in row, f"row missing '{k}': {row}"


# ---------- WS: entrance_effect only on first connect after /join ----------

class TestEntranceOnce:
    @pytest.mark.asyncio
    async def test_entrance_effect_claim_once_per_join(self, tokens):
        """
        Spec: entrance plays exactly once per genuine /join. On the first WS connect
        after /join, user_joined includes entrance_effect iff user has one equipped.
        On a reconnect WITHOUT a new /join, user_joined must NOT include
        entrance_effect (claim already consumed via room_entries.entrance_played).
        """
        a = tokens["a"]
        b = tokens["b"]
        # Create a transient room owned by A
        rr = requests.post(
            f"{BASE_URL}/api/rooms",
            headers=_h(a),
            json={"name": "TEST_iter143_entrance", "category": "chat", "is_public": True},
            timeout=15,
        )
        assert rr.status_code in (200, 201), rr.text
        room_id = rr.json().get("id") or rr.json().get("room_id") or rr.json().get("_id")
        assert room_id, rr.json()
        try:
            # B joins (genuine /join → resets entrance_played=False)
            jr = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", headers=_h(b), timeout=15)
            assert jr.status_code in (200, 201), jr.text

            # Helper to open a WS and wait for its OWN user_joined (observed from A)
            async def observe_b_join():
                a_url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={a['access_token']}"
                b_url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={b['access_token']}"
                async with websockets.connect(a_url, close_timeout=5) as wa:
                    # Drain A's initial frames briefly
                    try:
                        for _ in range(10):
                            await asyncio.wait_for(wa.recv(), timeout=0.4)
                    except asyncio.TimeoutError:
                        pass
                    # Open B's WS
                    async with websockets.connect(b_url, close_timeout=5) as wb:
                        # Watch A for user_joined of B
                        deadline = time.time() + 6
                        join_evt = None
                        while time.time() < deadline:
                            try:
                                raw = await asyncio.wait_for(wa.recv(), timeout=1.0)
                            except asyncio.TimeoutError:
                                continue
                            try:
                                m = json.loads(raw)
                            except Exception:
                                continue
                            if m.get("type") == "user_joined":
                                u = m.get("user") or {}
                                if str(u.get("id")) == str(b["user"]["id"]):
                                    join_evt = m
                                    break
                        # Allow B to drain
                        try:
                            for _ in range(5):
                                await asyncio.wait_for(wb.recv(), timeout=0.3)
                        except asyncio.TimeoutError:
                            pass
                        return join_evt

            evt1 = await observe_b_join()
            # Short pause then reconnect WITHOUT a new /join
            await asyncio.sleep(0.5)
            evt2 = await observe_b_join()

            assert evt1 is not None, "did not observe B's first user_joined"
            assert evt2 is not None, "did not observe B's second user_joined"

            # The key invariant (regardless of whether B has a VIP entrance equipped):
            # evt2 must not include entrance_effect even if evt1 did.
            e1 = (evt1.get("user") or {}).get("entrance_effect")
            e2 = (evt2.get("user") or {}).get("entrance_effect")
            # If no entrance equipped, both will be absent — acceptable (claim is a no-op).
            # If entrance equipped, e1 may be set and e2 MUST be None.
            if e1:
                assert not e2, f"entrance_effect leaked on reconnect: evt2={evt2}"
            # Always: on second connect without /join, entrance_effect must be falsy.
            assert not e2, f"entrance_effect present on reconnect: {e2}"
        finally:
            # Cleanup: delete the test room (owner A)
            try:
                requests.delete(f"{BASE_URL}/api/rooms/{room_id}", headers=_h(a), timeout=10)
            except Exception:
                pass
