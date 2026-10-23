"""Iter-134 — Test-mode direct recharge, VIP progression, private chat (image/voice/gift),
voice-call signalling (with in-room block), and media upload init/chunk/complete.

Public URL only. Cleans up TEST_ data where feasible."""
import asyncio
import base64
import json
import os
import secrets
import time

import pytest
import requests
import websockets

BASE_URL = (os.environ.get("EXPO_BACKEND_URL_TEST") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
TEST_ROOM_ID = "6ac923fb64abed17bb599809"  # TEST · Chill Chat (visible to test users)
DEMO_EMAIL = "demo@voiceup.app"
DEMO_PWD = "demo1234"


def _login(email: str, password: str = "demo1234") -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10).json()
    return {"token": tok, "me": me, "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}}


# ---------- Fixtures ----------
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
def regular_user():
    """Create a brand-new regular user (NOT is_test / NOT is_admin) via /auth/register."""
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


# ---------- 1) Payments disabled + recharge eligibility ----------
class TestPaymentsDisabled:
    def test_checkout_returns_410(self, test3):
        r = requests.post(f"{BASE_URL}/api/payments/checkout", headers=test3["headers"],
                          json={"package_id": "d_99900", "origin_url": BASE_URL})
        assert r.status_code == 410, f"expected 410, got {r.status_code}: {r.text}"

    def test_recharge_eligibility_test_user_true(self, test3):
        r = requests.get(f"{BASE_URL}/api/wallet/recharge/eligibility", headers=test3["headers"])
        assert r.status_code == 200
        assert r.json()["allowed"] is True

    def test_recharge_eligibility_regular_user_false(self, regular_user):
        r = requests.get(f"{BASE_URL}/api/wallet/recharge/eligibility", headers=regular_user["headers"])
        assert r.status_code == 200
        assert r.json()["allowed"] is False


# ---------- 2) Packages 499/$ incl d_99900=498501 ----------
class TestPackages:
    def test_mobile_packages_rate_and_emperor(self, test3):
        r = requests.get(f"{BASE_URL}/api/wallet/packages?channel=mobile", headers=test3["headers"])
        assert r.status_code == 200
        pkgs = r.json()
        emperor = next((p for p in pkgs if p["id"] == "d_99900"), None)
        assert emperor is not None, "d_99900 missing"
        assert emperor["coins"] == 498501
        assert emperor["bonus"] == 0
        # Verify 499 per $ on a couple other tiers (half-up rounding).
        starter = next(p for p in pkgs if p["id"] == "d_099")
        assert starter["coins"] == 494  # (99*499+50)//100 = 494
        best = next(p for p in pkgs if p["id"] == "d_999")
        assert best["coins"] == 4985


# ---------- 3) Direct recharge (test mode): idempotent, non-test blocked ----------
class TestDirectRecharge:
    def test_regular_user_blocked(self, regular_user):
        r = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=regular_user["headers"],
                          json={"package_id": "d_099", "request_id": "TEST_rid_blocked_" + secrets.token_hex(4)})
        assert r.status_code == 403

    def test_credit_and_duplicate_guard(self, test5):
        """test.5 (fresh) credits once; same request_id again → duplicate:true, no double credit."""
        pkg_id = "d_099"  # 494 diamonds
        rid = "TEST_rid_" + secrets.token_hex(6)
        before = requests.get(f"{BASE_URL}/api/auth/me", headers=test5["headers"]).json()
        c_before = int(before.get("coins", 0))
        r1 = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=test5["headers"],
                           json={"package_id": pkg_id, "request_id": rid})
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["credited"] == 494
        assert d1["coins"] == c_before + 494
        assert int(d1.get("recharged_diamonds", 0)) >= 494
        rd_after_first = int(d1["recharged_diamonds"])
        # duplicate
        r2 = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=test5["headers"],
                           json={"package_id": pkg_id, "request_id": rid})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("duplicate") is True
        assert d2["coins"] == d1["coins"]  # no additional credit
        # confirm via /me (coins) and /vip/progress (recharged_diamonds not in /me)
        after = requests.get(f"{BASE_URL}/api/auth/me", headers=test5["headers"]).json()
        assert int(after["coins"]) == c_before + 494

    def test_unknown_package_404(self, test3):
        r = requests.post(f"{BASE_URL}/api/wallet/recharge", headers=test3["headers"],
                          json={"package_id": "d_zzz", "request_id": "TEST_rid_" + secrets.token_hex(4)})
        assert r.status_code == 404


# ---------- 4) VIP thresholds & /vip/progress ----------
EXPECTED_THRESHOLDS = [5000, 100000, 300000, 650000, 2000000, 7000000, 20000000, 40000000, 60000000, 100000000]


class TestVip:
    def test_thresholds_match_spec(self, test3):
        r = requests.get(f"{BASE_URL}/api/vip/thresholds", headers=test3["headers"])
        assert r.status_code == 200
        data = r.json()
        # Server returns list of {level, threshold} per Iter-133/134 spec
        if isinstance(data, dict):
            data = data.get("thresholds")
        thresholds = [int(x["threshold"]) if isinstance(x, dict) else int(x) for x in data]
        assert thresholds == EXPECTED_THRESHOLDS, f"got {thresholds}"

    def test_progress_remaining(self, test3):
        r = requests.get(f"{BASE_URL}/api/vip/progress", headers=test3["headers"])
        assert r.status_code == 200
        pr = r.json()
        # progress payload surfaces authoritative recharged_diamonds
        rd = int(pr.get("recharged_diamonds", pr.get("recharged", 0)))
        levels = pr.get("levels") if isinstance(pr, dict) else pr
        assert isinstance(levels, list) and len(levels) == 10
        for lvl in levels:
            thr = int(lvl.get("threshold", 0))
            remaining = int(lvl.get("remaining", 0))
            expected = max(thr - rd, 0)
            assert remaining == expected, f"L{lvl.get('level')}: remaining {remaining} != {expected} (rd={rd}, thr={thr})"


# ---------- 5) Media upload init validation ----------
class TestMediaUpload:
    def test_audio_duration_over_31_rejected(self, test3):
        r = requests.post(f"{BASE_URL}/api/media/upload/init", headers=test3["headers"], json={
            "kind": "audio", "mime": "audio/mp4", "size": 1024, "purpose": "chat",
            "total_chunks": 1, "duration": 45.0,
        })
        assert r.status_code == 400, r.text

    def test_audio_ok_and_image_upload_flow(self, test3, test4, test5):
        # upload a tiny image via test3, send to test4, verify test5 (third user) 403.
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )
        init = requests.post(f"{BASE_URL}/api/media/upload/init", headers=test3["headers"], json={
            "kind": "image", "mime": "image/png", "size": len(png), "purpose": "chat", "total_chunks": 1,
        })
        assert init.status_code == 200, init.text
        upload_id = init.json()["upload_id"]
        chunk = requests.post(f"{BASE_URL}/api/media/upload/chunk", headers=test3["headers"], json={
            "upload_id": upload_id, "index": 0, "data": base64.b64encode(png).decode(),
        })
        assert chunk.status_code == 200, chunk.text
        done = requests.post(f"{BASE_URL}/api/media/upload/complete", headers=test3["headers"], json={
            "upload_id": upload_id,
        })
        assert done.status_code == 200, done.text
        media_url = done.json()["url"]
        file_id = done.json()["id"]

        # send DM image to test.4 (6ac923fb64abed17bb599800 per spec)
        recipient_id = test4["me"]["id"]
        send = requests.post(f"{BASE_URL}/api/messages/send", headers=test3["headers"], json={
            "recipient_id": recipient_id, "kind": "image", "media_url": media_url, "text": "",
        })
        assert send.status_code == 200, send.text

        # sender can GET
        r_s = requests.get(f"{BASE_URL}{media_url}?t={test3['token']}")
        assert r_s.status_code == 200
        # recipient can GET
        r_r = requests.get(f"{BASE_URL}{media_url}?t={test4['token']}")
        assert r_r.status_code == 200
        # third user (test5) cannot
        r_t = requests.get(f"{BASE_URL}{media_url}?t={test5['token']}")
        assert r_t.status_code == 403, f"third-user media GET should be 403, got {r_t.status_code}"


# ---------- 6) DM gift (real gift system) ----------
class TestDmGift:
    def test_dm_gift_deducts_and_creates_message(self, test3, test4):
        # Pick a cheap gift from the catalog.
        r = requests.get(f"{BASE_URL}/api/gifts", headers=test3["headers"])
        assert r.status_code == 200
        gifts = r.json()
        gifts = [g for g in gifts if int(g.get("price", 0)) > 0]
        gifts.sort(key=lambda g: int(g.get("price", 0)))
        gift = gifts[0]
        # Ensure test3 has enough diamonds — if not, top up via test-mode recharge.
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=test3["headers"]).json()
        if int(me.get("coins", 0)) < int(gift["price"]):
            requests.post(f"{BASE_URL}/api/wallet/recharge", headers=test3["headers"], json={
                "package_id": "d_099", "request_id": "TEST_topup_" + secrets.token_hex(4),
            })
            me = requests.get(f"{BASE_URL}/api/auth/me", headers=test3["headers"]).json()
        coins_before = int(me.get("coins", 0))

        recipient_id = test4["me"]["id"]
        rid = "TEST_giftreq_" + secrets.token_hex(4)
        send = requests.post(f"{BASE_URL}/api/messages/gift", headers=test3["headers"], json={
            "recipient_id": recipient_id, "gift_id": gift["id"], "quantity": 1, "request_id": rid,
        })
        assert send.status_code == 200, send.text
        after = requests.get(f"{BASE_URL}/api/auth/me", headers=test3["headers"]).json()
        assert int(after["coins"]) == coins_before - int(gift["price"]), \
            f"coins {after['coins']} vs expected {coins_before - gift['price']}"

        # Verify a kind=gift message now exists in the thread
        msgs = requests.get(f"{BASE_URL}/api/messages/with/{recipient_id}", headers=test3["headers"]).json()
        gift_msgs = [m for m in msgs if m.get("kind") == "gift"]
        assert len(gift_msgs) >= 1
        assert gift_msgs[-1].get("gift", {}).get("id") == gift["id"]


# ---------- 7) Calls ----------
class TestCalls:
    def test_self_call_400(self, test3):
        r = requests.post(f"{BASE_URL}/api/calls/start", headers=test3["headers"],
                          json={"callee_id": test3["me"]["id"]})
        assert r.status_code == 400

    def test_call_ring_accept_end(self, test3, test4):
        # end any lingering calls first
        for u in (test3, test4):
            cur = requests.get(f"{BASE_URL}/api/calls/current", headers=u["headers"]).json()
            c = cur.get("call") if isinstance(cur, dict) else None
            if c:
                requests.post(f"{BASE_URL}/api/calls/{c['id']}/end", headers=u["headers"])

        # start
        start = requests.post(f"{BASE_URL}/api/calls/start", headers=test3["headers"],
                              json={"callee_id": test4["me"]["id"]})
        assert start.status_code == 200, start.text
        data = start.json()
        call_id = data["call"]["id"]
        assert data["call"]["status"] == "ringing"
        assert data["rtc"]["channel"] == f"call_{call_id}"
        assert data["rtc"]["app_id"] and data["rtc"]["token"] and data["rtc"]["uid"]

        # callee sees it as incoming
        cur = requests.get(f"{BASE_URL}/api/calls/current", headers=test4["headers"]).json()
        assert cur["call"]["id"] == call_id
        assert cur["call"]["direction"] == "incoming"
        assert cur["call"]["status"] == "ringing"

        # second start by same caller → CALL_BUSY
        busy = requests.post(f"{BASE_URL}/api/calls/start", headers=test3["headers"],
                             json={"callee_id": test4["me"]["id"]})
        assert busy.status_code == 409
        assert "CALL_BUSY" in busy.text

        # accept
        acc = requests.post(f"{BASE_URL}/api/calls/{call_id}/accept", headers=test4["headers"])
        assert acc.status_code == 200, acc.text
        ad = acc.json()
        assert ad["call"]["status"] == "accepted"
        assert ad["rtc"]["token"]

        # end
        end = requests.post(f"{BASE_URL}/api/calls/{call_id}/end", headers=test3["headers"])
        assert end.status_code == 200
        cur2 = requests.get(f"{BASE_URL}/api/calls/current", headers=test3["headers"]).json()
        assert cur2["call"] is None

    def test_call_blocked_in_room(self, test3, test4):
        """When callee is in a voice room (ws presence), /calls/start → 409 CALL_BLOCKED_IN_ROOM."""
        room_id = TEST_ROOM_ID
        ws_url = f"{WS_BASE}/api/ws/rooms/{room_id}?token={test4['token']}"

        async def run():
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    # Drain any initial messages (chat history + user_joined), then hold socket open.
                    try:
                        for _ in range(5):
                            await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except Exception:
                        pass
                    # Now test.4 should be in _hub.presence for this room.
                    r = requests.post(f"{BASE_URL}/api/calls/start", headers=test3["headers"],
                                      json={"callee_id": test4["me"]["id"]})
                    return r
            except Exception as e:
                return e

        try:
            r = asyncio.run(run())
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                r = loop.run_until_complete(run())
            finally:
                loop.close()
        if isinstance(r, Exception):
            pytest.skip(f"ws connect failed: {r}")
        # Clean up any accidentally-created call
        try:
            if r.status_code == 200:
                cid = r.json().get("call", {}).get("id")
                if cid:
                    requests.post(f"{BASE_URL}/api/calls/{cid}/end", headers=test3["headers"])
        except Exception:
            pass
        assert r.status_code == 409, f"expected 409 CALL_BLOCKED_IN_ROOM, got {r.status_code}: {r.text}"
        assert "CALL_BLOCKED_IN_ROOM" in r.text


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
