"""
Iter-117 backend tests — media upload, posts (images/video/hashtags),
report with media, referral status/redeem flow, and tasks heartbeat.

Run:
  pytest /app/backend/tests/test_iter117_media_referral_posts.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results_iter117.xml
"""

import base64
import io
import os
import time
import uuid
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not BASE_URL:
    # Load frontend .env
    for line in open("/app/frontend/.env").read().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")
API = f"{BASE_URL}/api"


# --------------------------- helpers ---------------------------

def _hdr(tok): return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _register(email: str, password: str = "demo1234", username: str | None = None, nickname: str | None = None):
    username = username or ("tst" + uuid.uuid4().hex[:8])
    nickname = nickname or username
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "username": username, "nickname": nickname,
    }, timeout=30)
    if r.status_code == 200 or r.status_code == 201:
        return r.json()
    # fallback: existing → login
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


def _login(email: str, password: str = "demo1234"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


def _tok(auth: dict) -> str:
    return auth.get("access_token") or auth.get("token") or auth.get("accessToken")


def _me(tok: str):
    r = requests.get(f"{API}/auth/me", headers=_hdr(tok), timeout=30)
    r.raise_for_status()
    return r.json()


def _make_png_bytes(size=(32, 32)) -> bytes:
    img = Image.new("RGB", size, (120, 60, 220))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload_image(tok: str, purpose: str = "post") -> dict:
    data = _make_png_bytes()
    # init
    r = requests.post(f"{API}/media/upload/init", headers=_hdr(tok), json={
        "kind": "image", "mime": "image/png", "size": len(data), "purpose": purpose,
        "total_chunks": 1,
    }, timeout=30)
    assert r.status_code == 200, f"init failed: {r.status_code} {r.text}"
    upload_id = r.json()["upload_id"]
    # chunk
    b64 = base64.b64encode(data).decode()
    r = requests.post(f"{API}/media/upload/chunk", headers=_hdr(tok), json={
        "upload_id": upload_id, "index": 0, "data": b64,
    }, timeout=30)
    assert r.status_code == 200, f"chunk failed: {r.status_code} {r.text}"
    # complete
    r = requests.post(f"{API}/media/upload/complete", headers=_hdr(tok), json={"upload_id": upload_id}, timeout=120)
    assert r.status_code == 200, f"complete failed: {r.status_code} {r.text}"
    return r.json()


# --------------------------- fixtures ---------------------------

@pytest.fixture(scope="module")
def demo_tok():
    return _tok(_login("demo@voiceup.app"))


@pytest.fixture(scope="module")
def multi1_tok():
    return _tok(_login("multiacct1@orio.app"))


@pytest.fixture(scope="module")
def multi2_tok():
    return _tok(_login("multiacct2@orio.app"))


# --------------------------- media upload ---------------------------

class TestMediaUpload:
    def test_upload_image_post_public(self, demo_tok):
        res = _upload_image(demo_tok, "post")
        assert res["kind"] == "image"
        assert res["url"].startswith("/api/media/files/")
        file_id = res["id"]
        # public — no auth needed
        r = requests.get(f"{BASE_URL}{res['url']}", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        # Range header
        r = requests.get(f"{BASE_URL}{res['url']}", headers={"Range": "bytes=0-10"}, timeout=30)
        assert r.status_code == 206
        assert "Content-Range" in r.headers

    def test_upload_image_report_private(self, demo_tok):
        res = _upload_image(demo_tok, "report")
        # no auth → 403
        r = requests.get(f"{BASE_URL}{res['url']}", timeout=30)
        assert r.status_code == 403
        # with Bearer → 200
        r = requests.get(f"{BASE_URL}{res['url']}", headers={"Authorization": f"Bearer {demo_tok}"}, timeout=30)
        assert r.status_code == 200
        # with ?t= → 200
        r = requests.get(f"{BASE_URL}{res['url']}?t={demo_tok}", timeout=30)
        assert r.status_code == 200

    def test_upload_bad_mime(self, demo_tok):
        r = requests.post(f"{API}/media/upload/init", headers=_hdr(demo_tok), json={
            "kind": "image", "mime": "video/mp4", "size": 1000, "purpose": "post", "total_chunks": 1,
        }, timeout=30)
        assert r.status_code == 400

    def test_upload_video_too_long(self, demo_tok):
        r = requests.post(f"{API}/media/upload/init", headers=_hdr(demo_tok), json={
            "kind": "video", "mime": "video/mp4", "size": 1000, "purpose": "post",
            "total_chunks": 1, "duration": 45,
        }, timeout=30)
        assert r.status_code == 400


# --------------------------- posts ---------------------------

class TestPosts:
    def test_create_text_only(self, demo_tok):
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "TEST_iter117 text only #سفر", "hashtags": ["سفر"],
        }, timeout=30)
        assert r.status_code == 201, r.text
        data = r.json()
        assert "سفر" in data.get("hashtags", [])
        self._post_id = data["id"]

    def test_create_with_images(self, demo_tok):
        urls = [_upload_image(demo_tok, "post")["url"] for _ in range(2)]
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "TEST_iter117 with images", "images": urls, "hashtags": ["طعام"],
        }, timeout=60)
        assert r.status_code == 201, r.text
        assert r.json()["images"] == urls

    def test_images_plus_video_rejected(self, demo_tok):
        img_url = _upload_image(demo_tok, "post")["url"]
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "x", "images": [img_url], "video_url": img_url,
        }, timeout=30)
        assert r.status_code == 400

    def test_unknown_hashtag_rejected(self, demo_tok):
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "x", "hashtags": ["notallowed"],
        }, timeout=30)
        assert r.status_code == 400

    def test_too_many_images_rejected(self, demo_tok):
        urls = [_upload_image(demo_tok, "post")["url"] for _ in range(1)]
        # Try more than 5 — pydantic should reject
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "x", "images": urls * 6,
        }, timeout=30)
        assert r.status_code in (400, 422)

    def test_media_not_owned_rejected(self, demo_tok, multi1_tok):
        other_url = _upload_image(multi1_tok, "post")["url"]
        r = requests.post(f"{API}/posts", headers=_hdr(demo_tok), json={
            "text": "steal media", "images": [other_url],
        }, timeout=30)
        assert r.status_code == 400

    def test_tag_filter(self, demo_tok):
        unique_tag = "سفر"
        r = requests.get(f"{API}/posts?feed=popular&tag={unique_tag}", headers=_hdr(demo_tok), timeout=30)
        assert r.status_code == 200
        for p in r.json():
            assert unique_tag in (p.get("hashtags") or [])


# --------------------------- report with media ---------------------------

class TestReport:
    def test_report_with_media(self, demo_tok, multi1_tok):
        reporter_tok = demo_tok
        # upload report evidence
        urls = [_upload_image(reporter_tok, "report")["url"] for _ in range(2)]
        multi1_id = _me(multi1_tok)["id"]
        r = requests.post(f"{API}/users/{multi1_id}/report", headers=_hdr(reporter_tok), json={
            "reason": "insult", "details": "TEST_iter117 abuse",
            "media_urls": urls, "media_kind": "image",
        }, timeout=30)
        assert r.status_code == 201, r.text
        # notification created
        time.sleep(0.5)
        r2 = requests.get(f"{API}/notifications/system", headers=_hdr(reporter_tok), timeout=30)
        assert r2.status_code == 200
        items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        kinds = [i.get("kind") for i in items]
        assert "report_received" in kinds

    def test_report_too_many_images(self, demo_tok, multi1_tok):
        urls = [_upload_image(demo_tok, "report")["url"] for _ in range(1)]
        multi1_id = _me(multi1_tok)["id"]
        # 4 images (> 3) — pydantic max_length=3 → 422
        r = requests.post(f"{API}/users/{multi1_id}/report", headers=_hdr(demo_tok), json={
            "reason": "insult", "media_urls": urls * 4, "media_kind": "image",
        }, timeout=30)
        assert r.status_code in (400, 422)


# --------------------------- referral ---------------------------

class TestReferral:
    def test_status_shape(self, demo_tok):
        r = requests.get(f"{API}/referral/status", headers=_hdr(demo_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for key in ("code", "can_redeem", "redeem_expires_at", "status"):
            assert key in d, f"missing {key}"
        assert d["status"] in ("open", "expired", "redeemed")

    def test_redeem_own_code_400(self):
        # Fresh user so 24h window is still open — otherwise own-code check never runs (410 wins).
        auth = _register(f"test_own_{uuid.uuid4().hex[:8]}@orio.app")
        tok = _tok(auth)
        s = requests.get(f"{API}/referral/status", headers=_hdr(tok), timeout=30).json()
        assert s["status"] == "open"
        r = requests.post(f"{API}/referral/redeem", headers=_hdr(tok), json={"code": s["code"]}, timeout=30)
        assert r.status_code == 400, r.text

    def test_redeem_invalid_code_404(self):
        auth = _register(f"test_inv_{uuid.uuid4().hex[:8]}@orio.app")
        tok = _tok(auth)
        r = requests.post(f"{API}/referral/redeem", headers=_hdr(tok), json={"code": "ZZZZ999"}, timeout=30)
        assert r.status_code == 404, r.text

    def test_redeem_expired_410(self, demo_tok):
        # Demo account is older than 24h — must get 410 regardless of code.
        r = requests.post(f"{API}/referral/redeem", headers=_hdr(demo_tok), json={"code": "ANYCODE"}, timeout=30)
        assert r.status_code == 410, r.text

    def test_redeem_fresh_user_success_and_duplicate_409(self):
        # Create REFERRER first (older)
        ref_email = f"test_ref_{uuid.uuid4().hex[:8]}@orio.app"
        ref_auth = _register(ref_email)
        ref_tok = _tok(ref_auth)
        ref_code = requests.get(f"{API}/referral/status", headers=_hdr(ref_tok), timeout=30).json()["code"]
        # tiny delay so redeemer.created_at > referrer.created_at
        time.sleep(1.2)
        # Create REDEEMER (newer)
        new_email = f"test_red_{uuid.uuid4().hex[:8]}@orio.app"
        new_auth = _register(new_email)
        new_tok = _tok(new_auth)
        new_id = _me(new_tok)["id"]
        # Status before
        s = requests.get(f"{API}/referral/status", headers=_hdr(new_tok), timeout=30).json()
        assert s["can_redeem"] is True, s
        assert s["status"] == "open"
        # Redeem
        r = requests.post(f"{API}/referral/redeem", headers=_hdr(new_tok), json={"code": ref_code}, timeout=30)
        assert r.status_code == 200, r.text
        # Second time → 409
        r2 = requests.post(f"{API}/referral/redeem", headers=_hdr(new_tok), json={"code": ref_code}, timeout=30)
        assert r2.status_code == 409
        # Status now redeemed
        s2 = requests.get(f"{API}/referral/status", headers=_hdr(new_tok), timeout=30).json()
        assert s2["status"] == "redeemed"
        assert s2["can_redeem"] is False
        # Referrer got notification
        time.sleep(0.5)
        notif = requests.get(f"{API}/notifications/system", headers=_hdr(ref_tok), timeout=30).json()
        items = notif if isinstance(notif, list) else notif.get("items", [])
        assert any(i.get("kind") == "referral_reward" for i in items), f"referral_reward notif missing: kinds={[i.get('kind') for i in items]}"
        # cleanup — remove new_id entry
        pytest._iter117_new_id = new_id

    def test_redeem_ineligible_newer_referrer(self):
        """referrer must be older than redeemer; if referrer is newer → 400."""
        # Create referrer FIRST (older)
        a_email = f"test_newer_{uuid.uuid4().hex[:8]}@orio.app"
        a_auth = _register(a_email)
        time.sleep(1.2)
        b_email = f"test_older_{uuid.uuid4().hex[:8]}@orio.app"
        b_auth = _register(b_email)
        # a is older, b is newer. Have A try to redeem B's code → B newer than A → 400
        a_tok = _tok(a_auth)
        b_tok = _tok(b_auth)
        b_code = requests.get(f"{API}/referral/status", headers=_hdr(b_tok), timeout=30).json()["code"]
        r = requests.post(f"{API}/referral/redeem", headers=_hdr(a_tok), json={"code": b_code}, timeout=30)
        assert r.status_code == 400, r.text


# --------------------------- tasks heartbeat ---------------------------

class TestTasksHeartbeat:
    def test_heartbeat_not_in_room(self, demo_tok):
        # pass bogus room id — must return ok=false
        r = requests.post(f"{API}/tasks/heartbeat", headers=_hdr(demo_tok), json={"room_id": "ffffffffffffffffffffffff"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is False
        assert r.json().get("reason") == "not_in_room"


# --------------------------- rooms (one owned) ---------------------------

class TestRoomsOneOwned:
    def test_user_has_at_most_one_live_room(self, demo_tok):
        # List demo's rooms — iter117_dedupe ran on startup; assert dedupe property for ALL owners via /rooms list
        r = requests.get(f"{API}/rooms", headers=_hdr(demo_tok), timeout=30)
        assert r.status_code == 200
        rooms = r.json()
        owners: dict = {}
        for rm in rooms:
            own = (rm.get("owner") or {}).get("id") or rm.get("owner_id")
            if not own:
                continue
            owners[own] = owners.get(own, 0) + 1
        bad = [o for o, c in owners.items() if c > 1]
        assert not bad, f"owners with multiple live rooms: {bad}"
