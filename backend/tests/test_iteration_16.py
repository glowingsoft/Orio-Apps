"""
ORIO iteration 16 backend verification.
- Rooms: /api/rooms returns only active rooms with listeners>0, no "LIVE" text field,
  and seats == num_seats+1.
- POST /api/rooms with num_seats in {8,15,20}: seats length == num_seats+1, seats[0].user.id == me.
- PATCH /api/rooms/{id}/layout for each of {8,15,20}: resizes correctly & preserves host.
- GET /api/users/{id}/gifts-received: works with 24-char ObjectId, with 8-digit numeric_id,
  and 404s on random invalid ObjectId. Sending a gift is reflected in aggregation + recent.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://audio-community-9.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@voiceup.app"
DEMO_PASSWORD = "demo1234"


# --- fixtures ---------------------------------------------------------------

@pytest.fixture(scope="session")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in login response: {body}"
    return tok


@pytest.fixture(scope="session")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def me(demo_headers):
    r = requests.get(f"{API}/auth/me", headers=demo_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def secondary_token():
    """Register a second user so we can send gifts between two distinct users."""
    email = f"test_iter16_{int(time.time())}@voiceup.app"
    payload = {
        "email": email,
        "password": "TestPass123!",
        "username": f"iter16u{int(time.time()) % 100000}",
        "nickname": "Iter16 Test User",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    if not tok:
        # try login
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": payload["password"]}, timeout=30)
        assert r2.status_code == 200, r2.text
        tok = r2.json().get("access_token") or r2.json().get("token")
    return tok, email


# --- 2) GET /api/rooms ------------------------------------------------------

def test_rooms_list_active_no_live_field_and_seat_length(demo_headers):
    r = requests.get(f"{API}/rooms", headers=demo_headers, timeout=30)
    assert r.status_code == 200, r.text
    rooms = r.json()
    assert isinstance(rooms, list) and len(rooms) > 0, "expected some active rooms"

    for room in rooms:
        # active + listeners
        assert room.get("is_live", True) is True, f"inactive room in list: {room.get('id')}"
        listeners = room.get("listeners_count", room.get("listeners", 0)) or 0
        assert listeners > 0, f"room has 0 listeners but is listed: {room.get('id')}"
        # no LIVE field of any kind (case-insensitive scan on top-level string values)
        for k, v in room.items():
            if isinstance(v, str):
                assert v.strip().upper() != "LIVE", f"room {room.get('id')} has field {k}='LIVE'"
        # seats layout
        num_seats = room.get("num_seats")
        seats = room.get("seats")
        assert isinstance(seats, list), f"room {room.get('id')} missing seats array"
        assert len(seats) == (num_seats or 0) + 1, (
            f"room {room.get('id')} seats={len(seats)} expected num_seats+1={num_seats+1 if num_seats else 'n/a'}"
        )


# --- 3) POST /rooms + PATCH /rooms/{id}/layout ------------------------------

@pytest.mark.parametrize("num_seats", [8, 15, 20])
def test_create_room_seats_len_and_owner(demo_headers, me, num_seats):
    payload = {
        "name": f"TEST iter16 room {num_seats}",
        "num_seats": num_seats,
        "room_type": "chat",
    }
    r = requests.post(f"{API}/rooms", headers=demo_headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create room failed: {r.status_code} {r.text}"
    room = r.json()
    seats = room.get("seats")
    assert isinstance(seats, list)
    assert len(seats) == num_seats + 1, f"seats len {len(seats)} != {num_seats+1}"
    # seats[0] is the host chair — belongs to caller
    seat0_user = seats[0].get("user") or {}
    assert seat0_user.get("id") == me.get("id"), (
        f"seat[0].user.id={seat0_user.get('id')} vs me.id={me.get('id')}"
    )

    # cleanup: attempt delete if endpoint exists
    rid = room.get("id")
    if rid:
        requests.delete(f"{API}/rooms/{rid}", headers=demo_headers, timeout=30)


def test_patch_layout_resizes_all_three(demo_headers, me):
    # Create baseline room with 8 numbered seats
    payload = {"name": "TEST iter16 layout room", "num_seats": 8, "room_type": "chat"}
    r = requests.post(f"{API}/rooms", headers=demo_headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    room = r.json()
    rid = room["id"]

    try:
        for n in (8, 15, 20):
            r2 = requests.patch(
                f"{API}/rooms/{rid}/layout",
                headers=demo_headers,
                json={"num_seats": n},
                timeout=30,
            )
            assert r2.status_code == 200, f"PATCH layout {n} failed: {r2.status_code} {r2.text}"
            body = r2.json()
            seats = body.get("seats")
            assert isinstance(seats, list)
            assert len(seats) == n + 1, f"layout {n}: seats len {len(seats)} != {n+1}"
            # owner preserved on host chair
            seat0_user = seats[0].get("user") or {}
            assert seat0_user.get("id") == me.get("id"), (
                f"layout {n}: seat[0].user.id={seat0_user.get('id')} vs me.id={me.get('id')}"
            )
    finally:
        requests.delete(f"{API}/rooms/{rid}", headers=demo_headers, timeout=30)


# --- 4) GET /users/{id}/gifts-received --------------------------------------

REQUIRED_KEYS = {"user", "gifts", "recent", "total_gifts", "total_value"}


def test_gifts_received_by_object_id(demo_headers, me):
    uid = me.get("id")
    assert re.match(r"^[a-fA-F0-9]{24}$", uid), f"me.id not a 24-char ObjectId: {uid}"
    r = requests.get(f"{API}/users/{uid}/gifts-received", headers=demo_headers, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = r.json()
    assert REQUIRED_KEYS.issubset(body.keys()), f"missing keys, got {list(body.keys())}"


def test_gifts_received_by_numeric_id(demo_headers, me):
    nid = me.get("numeric_id")
    assert nid, f"me has no numeric_id: {me}"
    r = requests.get(f"{API}/users/{nid}/gifts-received", headers=demo_headers, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    body = r.json()
    assert REQUIRED_KEYS.issubset(body.keys()), f"missing keys, got {list(body.keys())}"


def test_gifts_received_404_for_random_object_id(demo_headers):
    fake = "0123456789abcdef01234567"
    r = requests.get(f"{API}/users/{fake}/gifts-received", headers=demo_headers, timeout=30)
    assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# --- 5) send gift → verify aggregation --------------------------------------

def _get_first_gift(demo_headers):
    for path in ("/gifts", "/gifts/catalog"):
        r = requests.get(f"{API}{path}", headers=demo_headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items") or data.get("gifts") or []
            if items:
                return items[0]
    return None


def test_send_gift_appears_in_recipient_aggregation(demo_headers, me, secondary_token):
    sec_tok, sec_email = secondary_token
    sec_headers = {"Authorization": f"Bearer {sec_tok}", "Content-Type": "application/json"}
    r_me2 = requests.get(f"{API}/auth/me", headers=sec_headers, timeout=30)
    assert r_me2.status_code == 200, r_me2.text
    recipient = r_me2.json()
    recipient_id = recipient["id"]

    gift = _get_first_gift(demo_headers)
    if not gift:
        pytest.skip("No gifts catalog available")
    gift_id = gift.get("id") or gift.get("_id") or gift.get("gift_id")
    assert gift_id, f"gift has no id: {gift}"

    # Try known payload shape variants
    payloads = [
        {"gift_id": gift_id, "recipient_id": recipient_id, "quantity": 1},
        {"gift_id": gift_id, "to_user_id": recipient_id, "quantity": 1},
        {"gift_id": gift_id, "recipient": recipient_id, "count": 1},
    ]
    sent_ok = False
    last = None
    for p in payloads:
        r = requests.post(f"{API}/gifts/send", headers=demo_headers, json=p, timeout=30)
        last = r
        if r.status_code in (200, 201):
            sent_ok = True
            break
    if not sent_ok:
        pytest.skip(f"could not send gift, last resp: {last.status_code} {last.text if last else ''}")

    # Verify appears in aggregation & recent
    r2 = requests.get(f"{API}/users/{recipient_id}/gifts-received", headers=demo_headers, timeout=30)
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["total_gifts"] >= 1, f"expected total_gifts>=1, got {body['total_gifts']}"
    gift_ids_agg = {g.get("gift_id") for g in body.get("gifts", [])}
    assert gift_id in gift_ids_agg, f"gift {gift_id} not in aggregation {gift_ids_agg}"
    recent_gift_ids = {t.get("gift_id") for t in body.get("recent", [])}
    assert gift_id in recent_gift_ids, f"gift {gift_id} not in recent {recent_gift_ids}"
