"""
Iter-138 backend coverage.

Covers:
- Room layout: POST /api/rooms num_seats must be in {8,15,20}; 25 → 400.
- Room layout patch: PATCH /api/rooms/{id}/layout only accepts {8,15,20}; owner/mod only.
- VIP5 gating on cover:
    * PATCH /users/me with cover_url → 403 VIP5_REQUIRED (route is explicitly gated).
    * PATCH /users/me/gallery with background_url → 403 for non-VIP5.
    * POST /media/upload/init purpose='cover' → 403 for non-VIP5.
    * PATCH /users/me/cover: non-VIP5 → 403; VIP5 user uploads image via chunked
      upload then successfully sets cover_url; bogus media id → 400 (not owned).
"""
import base64
import os
import time

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL_TEST") or "http://localhost:8001").rstrip("/")


def _login(email: str, password: str = "demo1234") -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    d = r.json()
    tok = d.get("access_token") or d.get("token")
    assert tok
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=20).json()
    return {"token": tok, "id": me.get("id") or me.get("_id"), "vip_level": me.get("vip_level", 0), "me": me}


@pytest.fixture(scope="module")
def vip5_user():
    """test.2@oriotest.dev is pre-seeded VIP5."""
    u = _login("test.2@oriotest.dev")
    assert int(u["vip_level"]) >= 5, f"test.2 should be VIP5, got {u['vip_level']}"
    return u


@pytest.fixture(scope="module")
def non_vip_user():
    """test.1 is a non-VIP test user."""
    u = _login("test.1@oriotest.dev")
    assert int(u["vip_level"]) < 5
    return u


def _h(u):
    return {"Authorization": f"Bearer {u['token']}"}


def _create_room_payload(num_seats=8, name="TEST_iter138_room"):
    return {
        "name": name,
        "description": "iter138 layout test",
        "num_seats": num_seats,
        "category": "chat",
    }


def _close_my_live_room(u):
    """Close any live room owned by `u` so a fresh POST /rooms succeeds."""
    r = requests.get(f"{BASE_URL}/api/rooms/mine", headers=_h(u), timeout=20)
    if r.status_code != 200:
        return
    data = r.json()
    rooms = data if isinstance(data, list) else data.get("owned") or data.get("rooms") or []
    for room in rooms:
        rid = room.get("id") or room.get("_id")
        if not rid:
            continue
        if room.get("is_live") is False:
            continue
        requests.post(f"{BASE_URL}/api/rooms/{rid}/close", headers=_h(u), timeout=20)


# ---------- Room layout: num_seats enforcement ----------
class TestRoomLayoutCreate:
    def test_create_room_num_seats_25_rejected(self, non_vip_user):
        _close_my_live_room(non_vip_user)
        r = requests.post(f"{BASE_URL}/api/rooms", headers=_h(non_vip_user),
                          json=_create_room_payload(num_seats=25), timeout=20)
        assert r.status_code in (400, 422), f"expected 400/422 for num_seats=25, got {r.status_code} {r.text}"

    @pytest.mark.parametrize("n", [8, 15, 20])
    def test_create_room_num_seats_valid(self, non_vip_user, n):
        _close_my_live_room(non_vip_user)
        r = requests.post(f"{BASE_URL}/api/rooms", headers=_h(non_vip_user),
                          json=_create_room_payload(num_seats=n, name=f"TEST_iter138_{n}"), timeout=20)
        # 200/201 valid, 409 if room already exists from previous test (ok)
        assert r.status_code in (200, 201), f"expected 200/201, got {r.status_code} {r.text}"
        body = r.json()
        assert body.get("num_seats") == n, f"created room num_seats mismatch: {body.get('num_seats')} != {n}"
        # host chair + numbered mic seats = n+1 total slots
        seats = body.get("seats") or []
        assert len(seats) == n + 1, f"expected {n+1} seats slots (host + {n} mic), got {len(seats)}"


# ---------- Room layout: PATCH /rooms/{id}/layout ----------
class TestRoomLayoutPatch:
    @pytest.fixture(scope="class")
    def owned_room(self, non_vip_user):
        _close_my_live_room(non_vip_user)
        r = requests.post(f"{BASE_URL}/api/rooms", headers=_h(non_vip_user),
                          json=_create_room_payload(num_seats=8, name="TEST_iter138_layout_patch"), timeout=20)
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_patch_layout_25_rejected(self, non_vip_user, owned_room):
        rid = owned_room["id"]
        r = requests.patch(f"{BASE_URL}/api/rooms/{rid}/layout", headers=_h(non_vip_user),
                           json={"num_seats": 25}, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_patch_layout_20_accepted(self, non_vip_user, owned_room):
        rid = owned_room["id"]
        r = requests.patch(f"{BASE_URL}/api/rooms/{rid}/layout", headers=_h(non_vip_user),
                           json={"num_seats": 20}, timeout=20)
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        body = r.json()
        assert body.get("num_seats") == 20

        # Verify persisted via GET
        g = requests.get(f"{BASE_URL}/api/rooms/{rid}", headers=_h(non_vip_user), timeout=20)
        assert g.status_code == 200
        assert g.json().get("num_seats") == 20
        seats = g.json().get("seats") or []
        assert len(seats) == 21  # 1 host + 20 mics

    def test_patch_layout_15_accepted(self, non_vip_user, owned_room):
        rid = owned_room["id"]
        r = requests.patch(f"{BASE_URL}/api/rooms/{rid}/layout", headers=_h(non_vip_user),
                           json={"num_seats": 15}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("num_seats") == 15

    def test_patch_layout_non_owner_rejected(self, owned_room, vip5_user):
        rid = owned_room["id"]
        # vip5_user is NOT owner of owned_room (owner is test.1)
        r = requests.patch(f"{BASE_URL}/api/rooms/{rid}/layout", headers=_h(vip5_user),
                           json={"num_seats": 8}, timeout=20)
        assert r.status_code in (403, 404), f"non-owner must be forbidden, got {r.status_code}"


# ---------- VIP5 cover gating ----------
class TestVip5CoverGating:
    def test_patch_me_with_cover_url_forbidden(self, non_vip_user):
        r = requests.patch(f"{BASE_URL}/api/users/me", headers=_h(non_vip_user),
                           json={"cover_url": "/api/media/files/ffffffffffffffffffffffff"}, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        assert "VIP5_REQUIRED" in r.text

    def test_patch_me_with_cover_url_forbidden_even_for_vip5(self, vip5_user):
        """PATCH /users/me ALWAYS rejects cover_url (per server.py:942-943).
        VIP5 users must use the dedicated /users/me/cover endpoint."""
        r = requests.patch(f"{BASE_URL}/api/users/me", headers=_h(vip5_user),
                           json={"cover_url": "/api/media/files/ffffffffffffffffffffffff"}, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_gallery_background_non_vip5_forbidden(self, non_vip_user):
        r = requests.patch(f"{BASE_URL}/api/users/me/gallery", headers=_h(non_vip_user),
                           json={"background_url": "https://example.com/x.jpg"}, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        assert "VIP5_REQUIRED" in r.text

    def test_media_upload_init_cover_non_vip5_forbidden(self, non_vip_user):
        r = requests.post(f"{BASE_URL}/api/media/upload/init", headers=_h(non_vip_user), json={
            "kind": "image", "mime": "image/jpeg", "size": 1024,
            "purpose": "cover", "total_chunks": 1,
        }, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        assert "VIP5_REQUIRED" in r.text

    def test_patch_cover_non_vip5_forbidden(self, non_vip_user):
        r = requests.patch(f"{BASE_URL}/api/users/me/cover", headers=_h(non_vip_user),
                           json={"cover_url": "/api/media/files/ffffffffffffffffffffffff"}, timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        assert "VIP5_REQUIRED" in r.text

    def test_patch_cover_vip5_bogus_media_rejected(self, vip5_user):
        r = requests.patch(f"{BASE_URL}/api/users/me/cover", headers=_h(vip5_user),
                           json={"cover_url": "/api/media/files/ffffffffffffffffffffffff"}, timeout=20)
        # Not owned / not found → 400
        assert r.status_code in (400, 404), f"expected 400/404, got {r.status_code} {r.text}"


# ---------- End-to-end: VIP5 upload + set cover ----------
_TINY_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n"
    b"\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a"
    b"\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
    b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00"
    b"\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07\"q\x142"
    b"\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a"
    b"%&'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a"
    b"\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa"
    b"\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca"
    b"\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea"
    b"\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa"
    b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd0\xff\xd9"
)


class TestVip5CoverUploadAndSet:
    def test_upload_and_set_cover_for_vip5(self, vip5_user):
        data = _TINY_JPEG
        # 1) init
        init = requests.post(f"{BASE_URL}/api/media/upload/init", headers=_h(vip5_user), json={
            "kind": "image", "mime": "image/jpeg", "size": len(data),
            "purpose": "cover", "total_chunks": 1,
        }, timeout=20)
        assert init.status_code == 200, f"init failed: {init.status_code} {init.text}"
        upload_id = init.json()["upload_id"]

        # 2) chunk
        chunk = requests.post(f"{BASE_URL}/api/media/upload/chunk", headers=_h(vip5_user), json={
            "upload_id": upload_id,
            "index": 0,
            "data": base64.b64encode(data).decode(),
        }, timeout=20)
        assert chunk.status_code == 200, f"chunk failed: {chunk.status_code} {chunk.text}"

        # 3) complete
        comp = requests.post(f"{BASE_URL}/api/media/upload/complete", headers=_h(vip5_user), json={
            "upload_id": upload_id,
        }, timeout=20)
        assert comp.status_code == 200, f"complete failed: {comp.status_code} {comp.text}"
        media_url = comp.json()["url"]
        assert media_url.startswith("/api/media/files/")

        # 4) PATCH /users/me/cover
        patch = requests.patch(f"{BASE_URL}/api/users/me/cover", headers=_h(vip5_user),
                               json={"cover_url": media_url}, timeout=20)
        assert patch.status_code == 200, f"patch cover failed: {patch.status_code} {patch.text}"
        updated = patch.json()
        assert updated.get("cover_url") == media_url, f"cover_url not set, got {updated.get('cover_url')}"

        # 5) GET /auth/me → cover_url reflected
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(vip5_user), timeout=20).json()
        assert me.get("cover_url") == media_url, f"persisted cover_url mismatch: {me.get('cover_url')}"
