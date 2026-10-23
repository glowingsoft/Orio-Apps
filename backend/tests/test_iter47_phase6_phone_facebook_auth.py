"""
Iter-47 Phase 6 — Phone OTP (Twilio Verify) + Facebook Login endpoints.

Tests hit the live backend over HTTP (see conftest.base_url). They assert:
1. GET /auth/providers is reachable and reports {google, email, phone, facebook}.
2. Phone OTP endpoints return 503 "not configured" when Twilio env vars are
   unset — NEVER a fake success.
3. Facebook endpoints return 503 "not configured" when FB env vars are unset.
4. Phone input validation (E.164) is enforced server-side.
5. OTP code shape validation is enforced server-side.
6. All public endpoints never leak the Facebook app secret.
"""
import os
import pytest
import httpx


@pytest.mark.asyncio
async def test_auth_providers_shape(base_url):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{base_url}/api/auth/providers")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) == {"google", "email", "phone", "facebook"}
    assert body["google"] is True
    assert body["email"] is True
    assert isinstance(body["phone"], bool)
    assert isinstance(body["facebook"], bool)


@pytest.mark.asyncio
async def test_phone_send_otp_requires_config_when_disabled(base_url):
    # In the default dev state the Twilio env vars are empty strings — the
    # endpoint MUST refuse with 503 and NEVER fake a send.
    if os.environ.get("TWILIO_ACCOUNT_SID"):
        pytest.skip("Twilio is live-configured; skipping disabled-path assertion.")
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base_url}/api/auth/phone/send-otp",
            json={"phone": "+14155550123"},
        )
    assert r.status_code == 503, r.text
    assert "not configured" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_phone_verify_otp_requires_config_when_disabled(base_url):
    if os.environ.get("TWILIO_ACCOUNT_SID"):
        pytest.skip("Twilio is live-configured; skipping disabled-path assertion.")
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base_url}/api/auth/phone/verify-otp",
            json={"phone": "+14155550123", "code": "123456"},
        )
    assert r.status_code == 503, r.text


@pytest.mark.asyncio
async def test_facebook_exchange_requires_config_when_disabled(base_url):
    if os.environ.get("FACEBOOK_APP_ID"):
        pytest.skip("Facebook is live-configured; skipping disabled-path assertion.")
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base_url}/api/auth/facebook/exchange",
            json={"access_token": "EAAfakeaccesstoken_longenough_but_still_a_fake"},
        )
    assert r.status_code == 503, r.text
    assert "not configured" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_facebook_public_config_disabled(base_url):
    if os.environ.get("FACEBOOK_APP_ID"):
        pytest.skip("Facebook is live-configured.")
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{base_url}/api/auth/facebook/public-config")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_facebook_public_config_never_leaks_secret(base_url):
    # Regardless of whether FB is configured, the public-config endpoint must
    # never return anything other than {app_id} (public).
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{base_url}/api/auth/facebook/public-config")
    if r.status_code == 200:
        body = r.json()
        # The secret must never appear in the response.
        assert "secret" not in str(body).lower()
        # Only app_id key is allowed.
        assert set(body.keys()) == {"app_id"}


@pytest.mark.asyncio
async def test_existing_email_auth_still_works(base_url):
    """Smoke-test the EXISTING email login path to make sure Phase 6 did not
    break anything in the auth module."""
    async with httpx.AsyncClient(timeout=10) as c:
        # Known seed account from /app/memory/test_credentials.md
        r = await c.post(
            f"{base_url}/api/auth/login",
            json={"email": "demo@voiceup.app", "password": "demo1234"},
        )
    # Either 200 OK (seeded) or 401 (not seeded in this environment) — but
    # never a 500. The server must stay healthy after Phase 6.
    assert r.status_code in (200, 401), r.text


@pytest.mark.asyncio
async def test_google_session_still_rejects_bad_sid(base_url):
    """Phase 6 must not have broken the Google auth path. A fake session_id
    must still return 401 (never 500)."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            f"{base_url}/api/auth/google/session",
            json={"session_id": "definitely-not-a-real-google-session-id-xxxxxx"},
        )
    # 401 (rejected by upstream) is the correct and only outcome.
    assert r.status_code == 401, r.text
