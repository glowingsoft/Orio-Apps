"""
Iter-53 — Profile Visitor Tracking ("Who viewed my profile").

Verifies:
  * POST /api/users/{id}/view is auth-gated.
  * Self-view returns {counted: False, reason: "self"} (no row created,
    lifetime counter not incremented).
  * First remote view increments the lifetime counter and creates a visitor row.
  * Immediate second view within the dedup window returns dedup and does
    NOT increment the counter or visit count.
  * GET /api/users/me/visitors returns lifetime_views + visitor list sorted
    by last_visit DESC.
  * viewer_pub carries nickname / avatar / vip_level / short_id (real 8-digit
    numeric_id when available).
  * 404 for a non-existent user_id.
"""
import uuid
import pytest
import httpx


def _unique_email():
    return f"iter53_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter53"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it53_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    data = r.json()
    tok = data["access_token"]
    # Fetch /me to get the user id + numeric_id.
    me = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200, me.text
    me_json = me.json()
    return tok, me_json


@pytest.mark.asyncio
async def test_view_requires_auth(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(f"{base_url}/api/users/000000000000000000000000/view")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_self_view_does_not_count(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        tok, me = await _register(c, base_url, "iter53_self")
        r = await c.post(
            f"{base_url}/api/users/{me['id']}/view",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["counted"] is False
        assert body["reason"] == "self"
        # Visitors list must stay empty.
        v = await c.get(
            f"{base_url}/api/users/me/visitors",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert v.status_code == 200
        assert v.json()["lifetime_views"] == 0
        assert v.json()["visitors"] == []


@pytest.mark.asyncio
async def test_remote_view_counts_once_within_window(base_url):
    async with httpx.AsyncClient(timeout=20) as c:
        target_tok, target = await _register(c, base_url, "iter53_target")
        viewer_tok, viewer = await _register(c, base_url, "iter53_viewer")

        # First view by viewer → counts.
        r1 = await c.post(
            f"{base_url}/api/users/{target['id']}/view",
            headers={"Authorization": f"Bearer {viewer_tok}"},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["counted"] is True

        # Second view within 5-min window → dedup, no re-count.
        r2 = await c.post(
            f"{base_url}/api/users/{target['id']}/view",
            headers={"Authorization": f"Bearer {viewer_tok}"},
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["counted"] is False
        assert body2["reason"] == "dedup"

        # Target reads their visitors list.
        v = await c.get(
            f"{base_url}/api/users/me/visitors",
            headers={"Authorization": f"Bearer {target_tok}"},
        )
        assert v.status_code == 200, v.text
        payload = v.json()
        assert payload["lifetime_views"] == 1  # exactly ONE counted view, not two
        assert payload.get("today_views") == 1  # today bucket matches
        assert isinstance(payload["visitors"], list)
        assert len(payload["visitors"]) == 1
        row = payload["visitors"][0]
        assert row["viewer_id"] == viewer["id"]
        assert row["visits"] == 1  # dedup must not have incremented
        # viewer_pub carries display info.
        pub = row.get("viewer_pub") or {}
        assert pub.get("nickname") == "iter53_viewer"
        assert "short_id" in pub
        # Short id is either an 8-digit numeric_id or an 8-char fallback.
        assert pub["short_id"] and len(str(pub["short_id"])) >= 6


@pytest.mark.asyncio
async def test_multiple_viewers_sorted_by_last_visit(base_url):
    async with httpx.AsyncClient(timeout=25) as c:
        target_tok, target = await _register(c, base_url, "iter53_target_sort")
        a_tok, a_me = await _register(c, base_url, "iter53_alice")
        b_tok, b_me = await _register(c, base_url, "iter53_bob")

        # Alice views first.
        r1 = await c.post(
            f"{base_url}/api/users/{target['id']}/view",
            headers={"Authorization": f"Bearer {a_tok}"},
        )
        assert r1.status_code == 200
        # Bob views second.
        r2 = await c.post(
            f"{base_url}/api/users/{target['id']}/view",
            headers={"Authorization": f"Bearer {b_tok}"},
        )
        assert r2.status_code == 200

        v = await c.get(
            f"{base_url}/api/users/me/visitors",
            headers={"Authorization": f"Bearer {target_tok}"},
        )
        assert v.status_code == 200, v.text
        payload = v.json()
        assert payload["lifetime_views"] == 2
        assert payload.get("today_views") == 2
        visitors = payload["visitors"]
        assert len(visitors) == 2
        # Most recent (Bob) first.
        assert visitors[0]["viewer_id"] == b_me["id"]
        assert visitors[1]["viewer_id"] == a_me["id"]


@pytest.mark.asyncio
async def test_view_404_for_bad_user(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        tok, _ = await _register(c, base_url, "iter53_404")
        # Well-formed but non-existent ObjectId.
        r = await c.post(
            f"{base_url}/api/users/000000000000000000000000/view",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 404
        # Malformed id also returns 404.
        r2 = await c.post(
            f"{base_url}/api/users/notanid/view",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r2.status_code == 404
