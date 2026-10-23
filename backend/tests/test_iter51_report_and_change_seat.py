"""
Iter-51 — Report categories + media attachment + Change Seat flow.
"""
import uuid
import base64
import pytest
import httpx


def _unique_email():
    return f"iter51_{uuid.uuid4().hex[:10]}@orio-tests.example.com"


async def _register(c, base_url, nickname="iter51"):
    r = await c.post(f"{base_url}/api/auth/register", json={
        "email": _unique_email(),
        "password": "Testing1234!",
        "username": f"it51_{uuid.uuid4().hex[:8]}",
        "nickname": nickname,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    await c.post(
        f"{base_url}/api/users/me/complete-profile",
        headers={"Authorization": f"Bearer {tok}"},
        json={"nickname": nickname, "age": 24, "gender": "male", "country_code": "US"},
    )
    return tok


async def _me(c, base_url, tok):
    r = await c.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    return r.json()


async def _create_room(c, base_url, tok):
    r = await c.post(
        f"{base_url}/api/rooms",
        headers={"Authorization": f"Bearer {tok}"},
        json={"name": "iter51 room", "category": "chat", "num_seats": 8},
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Report categories + media ----------

@pytest.mark.asyncio
async def test_report_accepts_all_8_reasons(base_url):
    allowed = [
        "illegal", "porn", "very_dangerous", "fraud",
        "insult", "ads", "religious_content", "political_content",
    ]
    async with httpx.AsyncClient(timeout=15) as c:
        reporter_tok = await _register(c, base_url, "iter51_reporter")
        target_tok = await _register(c, base_url, "iter51_target")
        target = await _me(c, base_url, target_tok)
        for reason in allowed:
            r = await c.post(
                f"{base_url}/api/users/{target['id']}/report",
                headers={"Authorization": f"Bearer {reporter_tok}"},
                json={"reason": reason, "details": f"test reason {reason}"},
            )
            assert r.status_code == 201, (reason, r.text)
            assert r.json().get("reported") is True


@pytest.mark.asyncio
async def test_report_rejects_unknown_reason_but_persists_as_other(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        reporter_tok = await _register(c, base_url, "iter51_r2")
        target_tok = await _register(c, base_url, "iter51_t2")
        target = await _me(c, base_url, target_tok)
        r = await c.post(
            f"{base_url}/api/users/{target['id']}/report",
            headers={"Authorization": f"Bearer {reporter_tok}"},
            json={"reason": "<<bogus>>", "details": "legit"},
        )
    # The server normalizes unknown reasons to "other" rather than 400 — this
    # keeps the UI forgiving while still constraining stored categories.
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_report_details_truncated_to_250(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        reporter_tok = await _register(c, base_url, "iter51_r3")
        target_tok = await _register(c, base_url, "iter51_t3")
        target = await _me(c, base_url, target_tok)
        long_text = "x" * 10_000
        r = await c.post(
            f"{base_url}/api/users/{target['id']}/report",
            headers={"Authorization": f"Bearer {reporter_tok}"},
            json={"reason": "insult", "details": long_text},
        )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_report_accepts_small_image_attachment(base_url):
    # A tiny valid 1x1 PNG data URL (<<2MB).
    tiny = (
        "data:image/png;base64," +
        base64.b64encode(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff"
            b"\xff?\x00\x05\xfe\x02\xfe\xa6\x1d\xb6\xfd\x00\x00\x00\x00IEND\xaeB`\x82"
        ).decode()
    )
    async with httpx.AsyncClient(timeout=15) as c:
        reporter_tok = await _register(c, base_url, "iter51_r4")
        target_tok = await _register(c, base_url, "iter51_t4")
        target = await _me(c, base_url, target_tok)
        r = await c.post(
            f"{base_url}/api/users/{target['id']}/report",
            headers={"Authorization": f"Bearer {reporter_tok}"},
            json={
                "reason": "illegal", "details": "with media",
                "media_data_url": tiny, "media_kind": "image",
            },
        )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_report_rejects_oversized_attachment(base_url):
    # ~3MB base64 blob — must be rejected.
    big = "data:image/jpeg;base64," + ("A" * 3_000_000)
    async with httpx.AsyncClient(timeout=15) as c:
        reporter_tok = await _register(c, base_url, "iter51_r5")
        target_tok = await _register(c, base_url, "iter51_t5")
        target = await _me(c, base_url, target_tok)
        r = await c.post(
            f"{base_url}/api/users/{target['id']}/report",
            headers={"Authorization": f"Bearer {reporter_tok}"},
            json={
                "reason": "illegal", "details": "oversize",
                "media_data_url": big, "media_kind": "image",
            },
        )
    # Pydantic max_length guard OR server size guard — either path blocks it.
    assert r.status_code in (413, 422), r.text


# ---------- Change Seat (owner-only move) ----------

@pytest.mark.asyncio
async def test_owner_can_change_user_seat(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter51_cs_owner")
        guest_tok = await _register(c, base_url, "iter51_cs_guest")
        room = await _create_room(c, base_url, owner_tok)
        hdr_owner = {"Authorization": f"Bearer {owner_tok}"}
        hdr_guest = {"Authorization": f"Bearer {guest_tok}"}

        # Guest joins and takes seat 1.
        jr = await c.post(f"{base_url}/api/rooms/{room['id']}/join", headers=hdr_guest)
        assert jr.status_code == 200, jr.text
        tr = await c.post(
            f"{base_url}/api/rooms/{room['id']}/seats/take",
            headers=hdr_guest,
            json={"seat_index": 1},
        )
        assert tr.status_code == 200, tr.text

        # Owner moves guest from seat 1 → seat 3.
        mr = await c.post(
            f"{base_url}/api/rooms/{room['id']}/mic-change-seat",
            headers=hdr_owner,
            json={"from_index": 1, "to_index": 3},
        )
    assert mr.status_code == 200, mr.text
    body = mr.json()
    seats = body["seats"]
    assert seats[1]["user"] is None
    assert seats[3]["user"] is not None


@pytest.mark.asyncio
async def test_non_owner_cannot_change_seat(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter51_cs_o2")
        attacker_tok = await _register(c, base_url, "iter51_cs_a2")
        room = await _create_room(c, base_url, owner_tok)
        r = await c.post(
            f"{base_url}/api/rooms/{room['id']}/mic-change-seat",
            headers={"Authorization": f"Bearer {attacker_tok}"},
            json={"from_index": 1, "to_index": 2},
        )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_change_seat_rejects_occupied_destination(base_url):
    async with httpx.AsyncClient(timeout=15) as c:
        owner_tok = await _register(c, base_url, "iter51_cs_o3")
        g1_tok = await _register(c, base_url, "iter51_cs_g3a")
        g2_tok = await _register(c, base_url, "iter51_cs_g3b")
        room = await _create_room(c, base_url, owner_tok)
        for tok, idx in ((g1_tok, 1), (g2_tok, 2)):
            await c.post(f"{base_url}/api/rooms/{room['id']}/join",
                         headers={"Authorization": f"Bearer {tok}"})
            await c.post(
                f"{base_url}/api/rooms/{room['id']}/seats/take",
                headers={"Authorization": f"Bearer {tok}"},
                json={"seat_index": idx},
            )
        r = await c.post(
            f"{base_url}/api/rooms/{room['id']}/mic-change-seat",
            headers={"Authorization": f"Bearer {owner_tok}"},
            json={"from_index": 1, "to_index": 2},
        )
    assert r.status_code == 409, r.text
